import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Target, BarChart3, Users, Flag, BookOpen, FileText, Download } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { MILESTONE_STATUS, statusMeta } from '@/lib/status-colors'
import { PageHeader } from '@/components/shared/PageHeader'

/** Dot colour per milestone status, from the shared status map. */
const MILESTONE_DOT = new Proxy({} as Record<string, string>, {
  get: (_t, key: string) => statusMeta(MILESTONE_STATUS, key).dot,
})

const STATUS_LABEL: Record<string, string> = {
  NotStarted: 'Not Started',
  InProgress: 'In Progress',
  Completed: 'Completed',
  Delayed: 'Delayed',
  AtRisk: 'At Risk',
}

export default async function MandEPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator', 'funder_viewer'].includes(session.user.role)) {
    redirect('/dashboard')
  }

  // Resolve programme
  let programmeId = session.user.programmeId
  if (!programmeId) {
    const first = await prisma.programme.findFirst({ orderBy: { createdAt: 'asc' } })
    programmeId = first?.id ?? null
  }

  if (!programmeId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No programme found. Please set up a programme first.</p>
      </div>
    )
  }

  const programme = await prisma.programme.findUnique({
    where: { id: programmeId },
    select: { name: true, moduleMandEEnabled: true },
  })

  if (!programme?.moduleMandEEnabled) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-muted-foreground font-medium">M&amp;E module is not enabled for this programme.</p>
        <p className="text-sm text-muted-foreground">Enable it in Admin → Programme Settings.</p>
      </div>
    )
  }

  const [toc, logFrameCount, indicators, latestBeneficiaries, milestones] = await Promise.all([
    prisma.theoryOfChange.findUnique({ where: { programmeId } }),
    prisma.logFrameItem.count({ where: { programmeId } }),
    prisma.indicator.findMany({
      where: { programmeId, active: true },
      include: { records: { orderBy: { periodStart: 'desc' }, take: 1 } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    prisma.beneficiaryCount.findFirst({
      where: { programmeId },
      orderBy: { periodStart: 'desc' },
    }),
    prisma.milestoneTracker.findMany({
      where: { programmeId },
      orderBy: { targetDate: 'asc' },
      take: 8,
    }),
  ])

  const milestoneStats = {
    total: milestones.length,
    completed: milestones.filter((m) => m.status === 'Completed').length,
    atRisk: milestones.filter((m) => m.status === 'AtRisk' || m.status === 'Delayed').length,
  }

  const quickLinks = [
    { label: 'Theory of Change', href: '/dashboard/mande/toc', icon: BookOpen, desc: toc ? 'View & edit' : 'Not yet defined' },
    { label: 'Logframe', href: '/dashboard/mande/logframe', icon: FileText, desc: `${logFrameCount} rows` },
    { label: 'Indicators', href: '/dashboard/mande/indicators', icon: BarChart3, desc: `${indicators.length} active` },
    { label: 'Beneficiaries', href: '/dashboard/mande/beneficiaries', icon: Users, desc: latestBeneficiaries ? `Latest: ${latestBeneficiaries.direct} direct` : 'No data yet' },
    { label: 'Milestones', href: '/dashboard/mande/milestones', icon: Flag, desc: `${milestoneStats.completed}/${milestoneStats.total} complete` },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
      <PageHeader title="M&amp;E Dashboard" description={<>{programme.name} — Monitoring &amp; Evaluation</>} />
        <div className="flex gap-2">
          {(['indicators', 'milestones', 'beneficiaries'] as const).map((t) => (
            <Button key={t} variant="outline" size="sm" asChild>
              <a href={`/api/mande/export?type=${t}`} download>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </a>
            </Button>
          ))}
        </div>
      </div>

      {/* Quick nav */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {quickLinks.map((ql) => (
          <Link key={ql.href} href={ql.href}>
            <Card className="hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer h-full">
              <CardContent className="pt-4 pb-3">
                <ql.icon className="mb-2 h-5 w-5 text-brand-volt-deep" />
                <p className="text-sm font-medium">{ql.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{ql.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* KPIs */}
      {latestBeneficiaries && (
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Users className="h-4 w-4" /> Beneficiary Reach — {latestBeneficiaries.periodLabel}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: 'Direct', value: latestBeneficiaries.direct, color: 'text-info' },
              { label: 'Indirect', value: latestBeneficiaries.indirect, color: 'text-indigo-600' },
              { label: 'Female', value: latestBeneficiaries.female, color: 'text-pink-600' },
              { label: 'Youth (<35)', value: latestBeneficiaries.youth, color: 'text-success' },
              { label: 'PWD', value: latestBeneficiaries.pwd, color: 'text-warning' },
            ].map((kpi) => (
              <Card key={kpi.label}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Indicators summary */}
      {indicators.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" /> Indicator Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {indicators.slice(0, 6).map((ind) => {
                const latest = ind.records[0]
                const pct = latest && ind.target > 0
                  ? Math.min(100, Math.round((latest.value / ind.target) * 100))
                  : null
                return (
                  <div key={ind.id}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{ind.name}</span>
                        <Badge variant="outline" className="text-xs py-0">{ind.type}</Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {latest ? `${latest.value} ${ind.unit}` : '—'} / {ind.target} {ind.unit}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${pct ?? 0}%` }}
                      />
                    </div>
                    {pct !== null && (
                      <p className="text-xs text-muted-foreground mt-0.5">{pct}% of target</p>
                    )}
                  </div>
                )
              })}
              {indicators.length > 6 && (
                <Link href="/dashboard/mande/indicators" className="link-brand text-xs">
                  View all {indicators.length} indicators →
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Milestones */}
      {milestones.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Flag className="h-4 w-4" /> Milestones
              </CardTitle>
              <div className="flex gap-3 text-sm">
                <span className="text-success font-medium">{milestoneStats.completed} done</span>
                {milestoneStats.atRisk > 0 && (
                  <span className="text-destructive font-medium">{milestoneStats.atRisk} at risk</span>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {milestones.map((m) => (
                <div key={m.id} className="flex items-center gap-3 py-1.5 border-b last:border-0">
                  <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${MILESTONE_DOT[m.status]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{m.title}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">{formatDate(m.targetDate)}</span>
                    <Badge variant="outline" className="text-xs py-0">
                      {STATUS_LABEL[m.status]}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
            <Link href="/dashboard/mande/milestones" className="link-brand mt-3 block text-xs">
              Manage all milestones →
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!latestBeneficiaries && indicators.length === 0 && milestones.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12 gap-3">
            <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium text-muted-foreground">No M&amp;E data yet</p>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Start by defining your Theory of Change, then build a logframe and add indicators.
            </p>
            <Button asChild size="sm" className="mt-2">
              <Link href="/dashboard/mande/toc">Start with Theory of Change</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
