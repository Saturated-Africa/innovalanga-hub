/**
 * Demonstration data for the fund management module.
 *
 *   npx tsx scripts/seed-funds.ts
 *
 * Idempotent: run it twice and nothing doubles. It creates a funder, a fund
 * with a commitment and two receipts, an allocation to the first programme, and
 * two grants whose tranche schedules are deliberately at different stages so
 * the payment gate is visible without having to set it up by hand.
 *
 * Runs on the owning connection because it creates funds, which sit above
 * programmes, and because a seed has no session to resolve a tenant from.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const programme = await prisma.programme.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!programme) throw new Error('No programme exists to allocate a fund to.')

  const innovators = await prisma.innovatorProfile.findMany({
    where: { cohort: { programmeId: programme.id } },
    select: { id: true, firstName: true, lastName: true },
    take: 2,
    orderBy: { lastName: 'asc' },
  })
  if (innovators.length < 2) throw new Error('Need at least two participants to demonstrate grants.')

  const funder = await prisma.funder.upsert({
    where: { name: 'Technology Innovation Agency' },
    create: {
      name: 'Technology Innovation Agency',
      shortName: 'TIA',
      contactName: 'Programme Officer',
      contactEmail: 'programmes@tia.org.za',
    },
    update: {},
  })

  const existing = await prisma.fund.findFirst({
    where: { funderId: funder.id, name: 'TIA Seed Fund 2026' },
  })

  const fund =
    existing ??
    (await prisma.fund.create({
      data: {
        funderId: funder.id,
        name: 'TIA Seed Fund 2026',
        reference: 'TIA/2026/SEED/014',
        committedAmount: 5_000_000,
        currency: 'ZAR',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: 'Active',
        // Seven and a half percent, held as a rate.
        managementFeeRate: 0.075,
        managementFeeBasis: 'Commitment',
        notes: 'Seed funding for early stage ventures in the Innovalanga programme.',
      },
    }))

  if (!existing) {
    await prisma.fundReceipt.createMany({
      data: [
        {
          fundId: fund.id,
          amount: 1_500_000,
          receivedOn: new Date('2026-02-03'),
          reference: 'TIA TRF 88201',
          recordedBy: 'Seed',
        },
        {
          fundId: fund.id,
          amount: 500_000,
          receivedOn: new Date('2026-06-02'),
          reference: 'TIA TRF 91744',
          recordedBy: 'Seed',
        },
      ],
    })
  }

  await prisma.fundAllocation.upsert({
    where: { fundId_programmeId: { fundId: fund.id, programmeId: programme.id } },
    create: {
      fundId: fund.id,
      programmeId: programme.id,
      amount: 2_000_000,
      note: 'First-year allocation.',
    },
    update: {},
  })

  // Two grants at different stages. The first has a paid tranche so the second
  // is payable; the second has nothing paid, so its later tranches are visibly
  // gated behind the first.
  const shapes = [
    {
      innovator: innovators[0],
      entityName: 'Sisanda Digital Solutions (Pty) Ltd',
      registration: '2023/447821/07',
      reference: 'GR-2026-001',
      purpose:
        'Product development and first market deployment of the schools application, including device procurement and teacher training.',
      award: 450_000,
      tranches: [
        { amount: 150_000, planned: '2026-03-15', status: 'Paid' as const, paidOn: '2026-03-18' },
        { amount: 180_000, planned: '2026-07-15', status: 'Approved' as const },
        { amount: 120_000, planned: '2026-10-15', status: 'Pending' as const,
          conditions: 'Quarterly report accepted and at least three schools onboarded.' },
      ],
    },
    {
      innovator: innovators[1],
      entityName: 'Khanya Agritech NPC',
      registration: '2024/119043/08',
      reference: 'GR-2026-002',
      purpose: 'Pilot of the soil sensor network across four cooperative farms.',
      award: 300_000,
      tranches: [
        { amount: 120_000, planned: '2026-04-01', status: 'Approved' as const },
        { amount: 100_000, planned: '2026-08-01', status: 'Pending' as const,
          conditions: 'Sensors installed and first season of data captured.' },
        { amount: 80_000, planned: '2026-11-01', status: 'Pending' as const },
      ],
    },
  ]

  for (const shape of shapes) {
    const already = await prisma.grant.findFirst({
      where: { fundId: fund.id, reference: shape.reference },
    })
    if (already) continue

    const grant = await prisma.grant.create({
      data: {
        programmeId: programme.id,
        fundId: fund.id,
        innovatorId: shape.innovator.id,
        entityName: shape.entityName,
        entityType: shape.entityName.includes('NPC') ? 'NPC' : 'PtyLtd',
        entityRegistrationNumber: shape.registration,
        reference: shape.reference,
        purpose: shape.purpose,
        awardedAmount: shape.award,
        status: 'Active',
        approvedBy: 'Fund Committee',
        approvedAt: new Date('2026-02-20'),
        agreementSignedAt: new Date('2026-02-27'),
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-12-31'),
        tranches: {
          create: shape.tranches.map((t, i) => ({
            sequence: i + 1,
            amount: t.amount,
            plannedDate: new Date(t.planned),
            status: t.status,
            conditions: 'conditions' in t ? t.conditions : null,
            approvedBy: t.status === 'Pending' ? null : 'Fund Committee',
            approvedAt: t.status === 'Pending' ? null : new Date('2026-03-01'),
            paidOn: 'paidOn' in t && t.paidOn ? new Date(t.paidOn) : null,
            paymentReference: 'paidOn' in t && t.paidOn ? 'EFT 4471' : null,
          })),
        },
      },
      select: { id: true },
    })

    // Some reported spend against the first grant, in three review states, so
    // the accounted-for figure is not simply zero or complete.
    if (shape.reference === 'GR-2026-001') {
      await prisma.grantExpenditure.createMany({
        data: [
          {
            grantId: grant.id,
            spentOn: new Date('2026-03-28'),
            supplier: 'Incredible Connection',
            description: 'Twelve tablets for the pilot schools',
            amount: 71_400,
            category: 'CapitalEquipment',
            status: 'Accepted',
            reviewedBy: 'Programme Finance',
            reviewedAt: new Date('2026-04-04'),
          },
          {
            grantId: grant.id,
            spentOn: new Date('2026-04-11'),
            supplier: 'Telkom',
            description: 'Connectivity for the pilot sites, six months',
            amount: 18_600,
            category: 'Operational',
            status: 'Accepted',
            reviewedBy: 'Programme Finance',
            reviewedAt: new Date('2026-04-18'),
          },
          {
            grantId: grant.id,
            spentOn: new Date('2026-05-02'),
            supplier: 'Freelance Developer',
            description: 'Offline sync feature',
            amount: 45_000,
            category: 'Personnel',
            status: 'Submitted',
          },
        ],
      })
    }
  }

  const summary = await prisma.fund.findUnique({
    where: { id: fund.id },
    include: {
      _count: { select: { grants: true, receipts: true, allocations: true } },
    },
  })

  console.log('Fund:', fund.name)
  console.log('  committed  R', Number(fund.committedAmount).toLocaleString('en-ZA'))
  console.log('  receipts  ', summary?._count.receipts)
  console.log('  allocations', summary?._count.allocations)
  console.log('  grants    ', summary?._count.grants)
  console.log('\nOpen /dashboard/funds and /dashboard/grants.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
