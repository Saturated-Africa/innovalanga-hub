import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { objectsToCsv as toCsv } from '@/lib/csv'
import { formatDate } from '@/lib/utils'
import { resolveProgrammeId } from '@/lib/scope'
import { tenantScope } from '@/lib/tenant-db'

// CSV building lives in lib/csv.ts. The local version here escaped only the
// RFC 4180 delimiters, so a cell beginning `=` or `@` was still executed as
// a formula by whoever opened the file - and these files go to funders.

/**
 * GET /api/mande/export?type=indicators|milestones|beneficiaries
 */
export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator', 'funder_viewer'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'indicators'

  // Through the shared resolver rather than a copy of it. Two implementations
  // of "which programme is this caller on" is one more than the number that can
  // be kept correct.
  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  let csv = ''
  let filename = 'mande-export.csv'

  if (type === 'indicators') {
    const indicators = await prisma.indicator.findMany({
      where: { programmeId },
      include: { records: { orderBy: { periodStart: 'asc' } } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    })
    const rows: Record<string, string | number>[] = []
    for (const ind of indicators) {
      if (ind.records.length === 0) {
        rows.push({
          'Indicator': ind.name,
          'Type': ind.type,
          'Unit': ind.unit,
          'Baseline': ind.baseline ?? '',
          'Target': ind.target,
          'Period': '',
          'Period Start': '',
          'Period End': '',
          'Value': '',
          'Notes': '',
          'Recorded By': '',
        })
      } else {
        for (const r of ind.records) {
          rows.push({
            'Indicator': ind.name,
            'Type': ind.type,
            'Unit': ind.unit,
            'Baseline': ind.baseline ?? '',
            'Target': ind.target,
            'Period': r.periodLabel,
            'Period Start': formatDate(r.periodStart),
            'Period End': formatDate(r.periodEnd),
            'Value': r.value,
            'Notes': r.notes ?? '',
            'Recorded By': r.recordedBy,
          })
        }
      }
    }
    csv = toCsv(rows)
    filename = 'mande-indicators.csv'
  } else if (type === 'milestones') {
    const milestones = await prisma.milestoneTracker.findMany({
      where: { programmeId },
      orderBy: { targetDate: 'asc' },
    })
    const rows = milestones.map((m) => ({
      'Title': m.title,
      'Description': m.description ?? '',
      'Status': m.status,
      'Target Date': formatDate(m.targetDate),
      'Completed Date': m.completedDate ? formatDate(m.completedDate) : '',
      'Notes': m.notes ?? '',
    }))
    csv = toCsv(rows)
    filename = 'mande-milestones.csv'
  } else if (type === 'beneficiaries') {
    const counts = await prisma.beneficiaryCount.findMany({
      where: { programmeId },
      orderBy: { periodStart: 'desc' },
    })
    const rows = counts.map((c) => ({
      'Period': c.periodLabel,
      'Period Start': formatDate(c.periodStart),
      'Period End': formatDate(c.periodEnd),
      'Direct': c.direct,
      'Indirect': c.indirect,
      'Female': c.female,
      'Youth (<35)': c.youth,
      'PWD': c.pwd,
      'Notes': c.notes ?? '',
      'Recorded By': c.recordedBy,
    }))
    csv = toCsv(rows)
    filename = 'mande-beneficiaries.csv'
  } else {
    return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
