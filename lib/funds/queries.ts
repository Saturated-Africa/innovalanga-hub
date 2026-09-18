import type { PrismaClient } from '@prisma/client'
import {
  toCents,
  fundBalances,
  grantBalances,
  managementFee,
  type FundBalances,
  type GrantBalances,
  type FeeBasis,
} from './rules'

/**
 * Turning rows into the positions the rules reason about.
 *
 * The arithmetic lives in rules.ts and is tested there. This module's only job
 * is to fetch the right rows and convert them to cents once, at the boundary,
 * so nothing downstream handles currency as a float.
 *
 * Funds are read on the owning connection because they sit above programmes.
 * Grants are read on the caller's tenant connection. The two are kept in
 * separate functions rather than one that takes a flag, so a call site cannot
 * accidentally read fund-wide figures through a programme-scoped connection and
 * silently get a subset.
 */

const cents = (d: { toString(): string } | null | undefined): number =>
  d === null || d === undefined ? 0 : toCents(Number(d.toString()))

export interface FundSummary {
  id: string
  name: string
  reference: string | null
  funderName: string
  currency: string
  status: string
  startDate: Date
  endDate: Date
  balances: FundBalances
  /** Fee earned to date, in cents. Zero when the fund carries no fee. */
  feeEarned: number
  feeRate: number | null
  feeBasis: FeeBasis | null
  programmeCount: number
  grantCount: number
}

/**
 * Every fund, with its position.
 *
 * Deliberately one query per aggregate rather than one clever join: the
 * groupBy results are small, and a join across receipts, allocations, grants
 * and tranches multiplies rows in a way that silently double counts. Getting
 * that wrong overstates a funder's disbursements, which is the one number
 * nobody may be wrong about.
 */
export async function fundSummaries(db: PrismaClient): Promise<FundSummary[]> {
  const funds = await db.fund.findMany({
    include: { funder: { select: { name: true } } },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  })
  if (funds.length === 0) return []

  const ids = funds.map((f) => f.id)

  const [receipts, allocations, grants, paid] = await Promise.all([
    db.fundReceipt.groupBy({
      by: ['fundId'],
      where: { fundId: { in: ids } },
      _sum: { amount: true },
    }),
    db.fundAllocation.groupBy({
      by: ['fundId'],
      where: { fundId: { in: ids } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.grant.groupBy({
      by: ['fundId'],
      // A cancelled grant is not a commitment against the fund.
      where: { fundId: { in: ids }, status: { not: 'Cancelled' } },
      _sum: { awardedAmount: true },
      _count: { _all: true },
    }),
    db.grantTranche.groupBy({
      by: ['grantId'],
      where: { status: 'Paid', grant: { fundId: { in: ids } } },
      _sum: { amount: true },
    }),
  ])

  // Paid tranches group by grant, so they are folded back to their fund.
  const grantToFund = new Map(
    (
      await db.grant.findMany({
        where: { fundId: { in: ids } },
        select: { id: true, fundId: true },
      })
    ).map((g) => [g.id, g.fundId])
  )
  const disbursedByFund = new Map<string, number>()
  for (const row of paid) {
    const fundId = grantToFund.get(row.grantId)
    if (!fundId) continue
    disbursedByFund.set(fundId, (disbursedByFund.get(fundId) ?? 0) + cents(row._sum.amount))
  }

  const receiptByFund = new Map(receipts.map((r) => [r.fundId, cents(r._sum.amount)]))
  const allocByFund = new Map(allocations.map((a) => [a.fundId, cents(a._sum.amount)]))
  const allocCount = new Map(allocations.map((a) => [a.fundId, a._count._all]))
  const awardByFund = new Map(grants.map((g) => [g.fundId, cents(g._sum.awardedAmount)]))
  const grantCount = new Map(grants.map((g) => [g.fundId, g._count._all]))

  return funds.map((fund) => {
    const position = {
      committed: cents(fund.committedAmount),
      received: receiptByFund.get(fund.id) ?? 0,
      allocated: allocByFund.get(fund.id) ?? 0,
      awarded: awardByFund.get(fund.id) ?? 0,
      disbursed: disbursedByFund.get(fund.id) ?? 0,
    }
    const rate = fund.managementFeeRate === null ? null : Number(fund.managementFeeRate)
    const basis = (fund.managementFeeBasis as FeeBasis | null) ?? null

    return {
      id: fund.id,
      name: fund.name,
      reference: fund.reference,
      funderName: fund.funder.name,
      currency: fund.currency,
      status: fund.status,
      startDate: fund.startDate,
      endDate: fund.endDate,
      balances: fundBalances(position),
      feeEarned: managementFee(position, rate, basis),
      feeRate: rate,
      feeBasis: basis,
      programmeCount: allocCount.get(fund.id) ?? 0,
      grantCount: grantCount.get(fund.id) ?? 0,
    }
  })
}

/** One fund's position, or null when it does not exist. */
export async function fundSummary(
  db: PrismaClient,
  fundId: string
): Promise<FundSummary | null> {
  const all = await fundSummaries(db)
  return all.find((f) => f.id === fundId) ?? null
}

export interface GrantSummary {
  id: string
  reference: string | null
  entityName: string
  entityType: string
  participant: string
  fundName: string
  status: string
  balances: GrantBalances
  trancheCount: number
  /** Tranches approved and waiting to be paid. */
  payableCount: number
  /** Spend reported and not yet reviewed, in cents. */
  unreviewed: number
}

/**
 * Grants in the caller's programme, with their positions.
 *
 * `db` must be the tenant connection. Row-level security confines it to one
 * programme, so no programme filter is written here - a second statement of the
 * same thing that could drift from the first.
 */
export async function grantSummaries(db: PrismaClient): Promise<GrantSummary[]> {
  const grants = await db.grant.findMany({
    include: {
      fund: { select: { name: true } },
      innovator: { select: { firstName: true, lastName: true } },
      tranches: { select: { amount: true, status: true } },
      expenditures: { select: { amount: true, status: true } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  })

  return grants.map((g) => {
    const paid = g.tranches.filter((t) => t.status === 'Paid')
    const reported = g.expenditures.filter((e) => e.status !== 'Rejected')
    const accepted = g.expenditures.filter((e) => e.status === 'Accepted')
    const unreviewed = g.expenditures.filter((e) => e.status === 'Submitted')

    return {
      id: g.id,
      reference: g.reference,
      entityName: g.entityName,
      entityType: g.entityType,
      participant: `${g.innovator.firstName} ${g.innovator.lastName}`,
      fundName: g.fund.name,
      status: g.status,
      balances: grantBalances({
        awarded: cents(g.awardedAmount),
        paid: paid.reduce((t, x) => t + cents(x.amount), 0),
        reported: reported.reduce((t, x) => t + cents(x.amount), 0),
        accepted: accepted.reduce((t, x) => t + cents(x.amount), 0),
      }),
      trancheCount: g.tranches.filter((t) => t.status !== 'Cancelled').length,
      payableCount: g.tranches.filter((t) => t.status === 'Approved').length,
      unreviewed: unreviewed.reduce((t, x) => t + cents(x.amount), 0),
    }
  })
}

/**
 * What a programme has been allocated across all funds, and what it has awarded.
 *
 * Read on the tenant connection: the allocation rows carry a programme, so
 * row-level security already confines this to the caller's own.
 */
export async function programmeAllocation(db: PrismaClient): Promise<{
  allocated: number
  awarded: number
  remaining: number
  funds: { fundId: string; fundName: string; allocated: number; awarded: number }[]
}> {
  const [allocations, grants] = await Promise.all([
    db.fundAllocation.findMany({ include: { fund: { select: { name: true } } } }),
    db.grant.groupBy({
      by: ['fundId'],
      where: { status: { not: 'Cancelled' } },
      _sum: { awardedAmount: true },
    }),
  ])

  const awardedByFund = new Map(grants.map((g) => [g.fundId, cents(g._sum.awardedAmount)]))
  const funds = allocations.map((a) => ({
    fundId: a.fundId,
    fundName: a.fund.name,
    allocated: cents(a.amount),
    awarded: awardedByFund.get(a.fundId) ?? 0,
  }))

  const allocated = funds.reduce((t, f) => t + f.allocated, 0)
  const awarded = funds.reduce((t, f) => t + f.awarded, 0)
  return { allocated, awarded, remaining: allocated - awarded, funds }
}
