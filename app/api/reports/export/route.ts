import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatDate, formatCurrency, formatDuration } from '@/lib/utils'
import { resolveProgrammeId } from '@/lib/scope'

const PERIOD_LABELS: Record<string, string> = {
  baseline: 'Baseline',
  month_3: 'Month 3',
  month_6: 'Month 6',
  month_9: 'Month 9',
  final: 'Final',
}


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
 * GET /api/reports/export?type=innovators|assessments|sessions|stipends
 */
export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator', 'funder_viewer'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'innovators'

  // Every query below used to run with no `where` at all, so a facilitator on
  // one programme exported every programme's data. Scope from the session.
  const programmeId = await resolveProgrammeId(session)
  if (!programmeId) return NextResponse.json({ error: 'No programme found' }, { status: 404 })

  // Reuse the same predicate the rest of the app uses: InnovatorProfile has no
  // programmeId of its own, so it scopes through the cohort.
  const innovatorScope = { cohort: { programmeId } }

  // CLAUDE.md states funders see no PII. Every one of these exports is
  // person-level: names, and for stipends individual amounts and payment dates.
  if (session.user.role === 'funder_viewer') {
    return NextResponse.json(
      {
        error:
          'Funder access is aggregate only. These exports contain personal information.',
      },
      { status: 403 }
    )
  }

  let csv = ''
  let filename = 'export.csv'

  if (type === 'innovators') {
    const data = await prisma.innovatorProfile.findMany({
      where: innovatorScope,
      include: {
        cohort: { select: { name: true } },
        region: { select: { name: true } },
        assessments: { orderBy: { createdAt: 'asc' } },
        _count: { select: { bookings: true } },
      },
      orderBy: { lastName: 'asc' },
    })

    const rows = data.map((i) => {
      const latest = i.assessments[i.assessments.length - 1]
      return {
        'First Name': i.firstName,
        'Last Name': i.lastName,
        'Business Name': i.businessName ?? '',
        'Region': i.region?.name ?? '',
        'Cohort': i.cohort.name,
        'Latest TRL': latest?.trlScore ?? '',
        'Latest BRL': latest?.brlScore ?? '',
        'Latest IRL': latest?.irlScore ?? '',
        'Latest Period': latest ? (PERIOD_LABELS[latest.period] ?? latest.period) : '',
        'Total Sessions': i._count.bookings,
      }
    })
    csv = toCsv(rows)
    filename = 'innovators.csv'
  } else if (type === 'assessments') {
    const data = await prisma.assessment.findMany({
      where: { innovator: innovatorScope },
      include: {
        innovator: { select: { firstName: true, lastName: true, businessName: true } },
      },
      orderBy: [{ innovator: { lastName: 'asc' } }, { createdAt: 'asc' }],
    })
    const rows = data.map((a) => ({
      'Innovator': `${a.innovator.firstName} ${a.innovator.lastName}`,
      'Business': a.innovator.businessName ?? '',
      'Period': PERIOD_LABELS[a.period] ?? a.period,
      'TRL': a.trlScore,
      'BRL': a.brlScore,
      'IRL': a.irlScore,
      'Assessed By': a.assessedBy,
      'Date': formatDate(a.createdAt),
    }))
    csv = toCsv(rows)
    filename = 'assessments.csv'
  } else if (type === 'sessions') {
    const data = await prisma.booking.findMany({
      where: { innovator: innovatorScope },
      include: {
        innovator: { select: { firstName: true, lastName: true } },
        mentor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { scheduledStart: 'desc' },
    })
    const rows = data.map((b) => ({
      'Innovator': `${b.innovator.firstName} ${b.innovator.lastName}`,
      'Mentor': `${b.mentor.firstName} ${b.mentor.lastName}`,
      'Scheduled Start': formatDate(b.scheduledStart),
      'Status': b.status,
      'Actual Duration': b.actualDurationMinutes ? formatDuration(b.actualDurationMinutes) : '',
    }))
    csv = toCsv(rows)
    filename = 'sessions.csv'
  } else if (type === 'stipends') {
    const data = await prisma.stipendRecord.findMany({
      where: { innovator: innovatorScope },
      include: {
        innovator: { select: { firstName: true, lastName: true, businessName: true } },
      },
      orderBy: [{ periodStart: 'desc' }, { innovator: { lastName: 'asc' } }],
    })
    const rows = data.map((s) => ({
      'Innovator': `${s.innovator.firstName} ${s.innovator.lastName}`,
      'Business': s.innovator.businessName ?? '',
      'Period Start': formatDate(s.periodStart),
      'Period End': formatDate(s.periodEnd),
      'Hours': s.hoursCompleted.toFixed(1),
      'Amount': formatCurrency(s.amount),
      'Status': s.status,
      'Paid Date': s.paidAt ? formatDate(s.paidAt) : '',
    }))
    csv = toCsv(rows)
    filename = 'stipends.csv'
  } else {
    return NextResponse.json({ error: 'Unknown export type' }, { status: 400 })
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
