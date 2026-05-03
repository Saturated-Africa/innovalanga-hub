import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatDate } from '@/lib/utils'

function toCsv(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const escape = (v: string | number) => {
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h] ?? '')).join(',')),
  ].join('\r\n')
}

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

  // Resolve programme
  let programmeId = session.user.programmeId ?? null
  if (!programmeId) {
    const first = await prisma.programme.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
    programmeId = first?.id ?? null
  }
  if (!programmeId) return NextResponse.json({ error: 'No programme found' }, { status: 404 })

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
