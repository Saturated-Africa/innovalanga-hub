import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { tenantScope } from '@/lib/tenant-db'
import { deriveTally } from '@/lib/beneficiary-tally'

/**
 * GET /api/mande/beneficiaries/derived?start=&end=&cohortId=
 *
 * What the accepted forms say, for comparison against what was reported.
 *
 * Deliberately read-only, and deliberately not a source that overwrites anything.
 * A BeneficiaryCount row is a figure somebody has already given a funder with
 * their name against it; having the platform quietly rewrite one from a
 * derivation would mean disagreeing with a submitted report and nobody knowing
 * which number moved. This route lets a person see both and decide.
 *
 * Only aggregates leave here. The rows behind them carry names, ID numbers and
 * addresses, and a count needs none of that - so the query selects the four
 * fields the tally reads and nothing else. A funder viewer may call this for the
 * same reason they may read the M&E pages: the answer is a number.
 */
const schema = z.object({
  start: z.string().date(),
  end: z.string().date(),
  cohortId: z.string().min(1).optional(),
})

const VIEWERS = ['super_admin', 'facilitator', 'funder_viewer']

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!VIEWERS.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const parsed = schema.safeParse({
    start: url.searchParams.get('start') ?? undefined,
    end: url.searchParams.get('end') ?? undefined,
    cohortId: url.searchParams.get('cohortId') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Give a start and end date as YYYY-MM-DD.' },
      { status: 400 }
    )
  }
  const { start, end, cohortId } = parsed.data

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { db: prisma } = scope

  // Only what the tally reads. No name, no ID, no address: a count does not need
  // them and this response is the wrong place for them to appear.
  const records = await prisma.beneficiaryRecord.findMany({
    where: { status: 'Accepted' },
    select: {
      acceptedAt: true,
      dateOfBirth: true,
      gender: true,
      hasDisability: true,
      cohortId: true,
    },
  })

  // End of day, so a form accepted on the last afternoon of a period is inside it.
  const periodEnd = new Date(`${end}T23:59:59.999Z`)
  const tally = deriveTally(records, {
    start: new Date(`${start}T00:00:00.000Z`),
    end: periodEnd,
    cohortId: cohortId ?? null,
  })

  return NextResponse.json(tally)
}
