import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ClipboardList, TrendingUp, TrendingDown, Minus, Sparkles } from 'lucide-react'
import { tenantScope } from '@/lib/tenant-db'
import { getTRLLabel, getBRLLabel, getIRLLabel, getMRLLabel, formatDate } from '@/lib/utils'
import {
  movementFor,
  distribution,
  summarise,
  byCohort,
  needsAttention,
  type DimensionKey,
  type Participant,
} from '@/lib/readiness-tracker'

/**
 * Progression tracker for one readiness dimension.
 *
 * Built for Business Readiness Level and mounted at /dashboard/readiness/brl,
 * but parameterised by dimension so TRL, IRL and MRL work from the same page.
 * Programmes already choose which dimensions they run, so a page hard-coded to
 * one of them would have been the wrong shape from the start.
 *
 * This deliberately answers a different question from the assessments list.
 * That shows every score. This shows who is moving, who has stopped, and who is
 * close to the top, which is what a facilitator does something about.
 */

const VALID: DimensionKey[] = ['trl', 'brl', 'irl', 'mrl']

const LEVEL_LABEL: Record<DimensionKey, (n: number) => string> = {
  trl: getTRLLabel,
  brl: getBRLLabel,
  irl: getIRLLabel,
  mrl: getMRLLabel,
}

/** Pull the right column out of an assessment row. */
function scoreOf(
  a: { trlScore: number; brlScore: number; irlScore: number; mrlScore: number | null },
  key: DimensionKey
): number | null {
  if (key === 'trl') return a.trlScore
  if (key === 'brl') return a.brlScore
  if (key === 'irl') return a.irlScore
  return a.mrlScore
}

export default async function ReadinessTrackerPage(
  props: {
    params: Promise<{ dimension: string }>
  }
) {
  const params = await props.params;
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator', 'funder_viewer'].includes(session.user.role)) {
    redirect('/dashboard')
  }

  const key = params.dimension.toLowerCase() as DimensionKey
  if (!VALID.includes(key)) notFound()

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  // The programme's own name for this dimension, and whether it runs it at all.
  const dimension = await prisma.readinessDimension.findFirst({
    where: { programmeId, key },
  })
  if (!dimension || !dimension.enabled) notFound()

  const [periods, innovators] = await Promise.all([
    prisma.assessmentPeriodDef.findMany({
      where: { programmeId },
      orderBy: { order: 'asc' },
      select: { key: true, label: true },
    }),
    prisma.innovatorProfile.findMany({
      where: { cohort: { programmeId } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        cohortId: true,
        cohort: { select: { name: true } },
        assessments: {
          select: {
            period: true,
            createdAt: true,
            trlScore: true,
            brlScore: true,
            irlScore: true,
            mrlScore: true,
          },
        },
      },
      orderBy: { lastName: 'asc' },
    }),
  ])

  const periodOrder = periods.map((p) => p.key)
  const periodLabel = new Map(periods.map((p) => [p.key, p.label]))

  const participants: Participant[] = innovators.map((i) => ({
    id: i.id,
    name: `${i.firstName} ${i.lastName}`,
    cohortId: i.cohortId,
    cohortName: i.cohort?.name ?? null,
    history: i.assessments.map((a) => ({
      period: a.period,
      score: scoreOf(a, key),
      assessedAt: a.createdAt,
    })),
  }))

  const movements = participants.map((p) => movementFor(p, periodOrder))
  const summary = summarise(movements, dimension.maxScore)
  const levels = distribution(movements, dimension.minScore, dimension.maxScore)
  const cohorts = byCohort(movements)
  const attention = needsAttention(movements)
  const label = LEVEL_LABEL[key]

  // Funders see the shape of the programme, not who is struggling by name.
  const showNames = session.user.role !== 'funder_viewer'
  const peak = Math.max(1, ...levels.map((l) => l.count))

  if (innovators.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title={`${dimension.shortLabel} Tracker`} description={dimension.description ?? undefined} />
        <EmptyState
          icon={ClipboardList}
          title="No participants yet"
          description="Once participants are enrolled and assessed, their progression appears here."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${dimension.shortLabel} Tracker`}
        description={dimension.description ?? dimension.label}
      />

      {/* Headline figures. Movement first, because that is what is actionable;
          the average is context, not a target. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Advancing" value={summary.advancing} icon={TrendingUp} tone="good" />
        <Stat label="Stalled" value={summary.stalled} icon={Minus} tone="warn" />
        <Stat label="Regressed" value={summary.regressed} icon={TrendingDown} tone="bad" />
        <Stat
          label={`At ${dimension.maxScore - 1}–${dimension.maxScore}`}
          value={summary.nearReady}
          icon={Sparkles}
          tone="good"
        />
        <Stat
          label="Average"
          value={summary.average === null ? '—' : summary.average.toFixed(1)}
        />
      </div>

      {summary.notAssessed > 0 && (
        <p className="text-sm text-muted-foreground">
          {summary.assessed} of {movements.length} participants have a{' '}
          {dimension.shortLabel} score. {summary.notAssessed} have never been assessed
          and are excluded from every figure on this page.
        </p>
      )}

      {/* Distribution. A named level is far more use than a number, so both
          are shown rather than a bare axis. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where participants sit</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {levels.map(({ level, count }) => (
              <div key={level} className="flex items-center gap-3 text-sm">
                <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {level}
                </span>
                <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">
                  {label(level)}
                </span>
                <div className="flex h-5 flex-1 items-center">
                  <div
                    className="h-3 rounded-sm bg-brand-volt"
                    style={{ width: `${(count / peak) * 100}%` }}
                    aria-hidden
                  />
                </div>
                <span className="w-8 shrink-0 text-right tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By cohort</CardTitle>
          </CardHeader>
          <CardContent>
            {cohorts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing scored yet.</p>
            ) : (
              <div className="space-y-3">
                {cohorts.map((c) => (
                  <div key={c.cohortName} className="flex items-center justify-between gap-4 text-sm">
                    <span className="truncate">{c.cohortName}</span>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {c.count} assessed
                      </span>
                      <span className="tabular-nums font-medium">
                        {c.average.toFixed(1)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody has stalled or gone backwards.
              </p>
            ) : !showNames ? (
              <p className="text-sm text-muted-foreground">
                {attention.length} participant{attention.length !== 1 ? 's' : ''} have
                stalled or regressed. Individual detail is not shown in the funder view.
              </p>
            ) : (
              <div className="space-y-2">
                {attention.slice(0, 8).map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 text-sm">
                    <Link href={`/dashboard/innovators/${m.id}`} className="link-brand truncate">
                      {m.name}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {label(m.current ?? 0)}
                      </span>
                      <Badge variant={m.regressed ? 'destructive' : 'secondary'}>
                        {m.regressed ? `${m.delta}` : 'no change'}
                      </Badge>
                    </span>
                  </div>
                ))}
                {attention.length > 8 && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    and {attention.length - 8} more.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {showNames && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Every participant</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] text-sm">
                <thead className="border-y border-border bg-muted/60">
                  <tr>
                    {['Participant', 'Cohort', 'Level', 'Change', 'Last assessed'].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {movements.map((m) => (
                    <tr key={m.id} className="transition-colors hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <Link href={`/dashboard/innovators/${m.id}`} className="link-brand">
                          {m.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {m.cohortName ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {m.current === null ? (
                          <span className="text-muted-foreground">Not assessed</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <span className="tabular-nums font-medium">{m.current}</span>
                            <span className="text-xs text-muted-foreground">
                              {label(m.current)}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {m.delta === null ? (
                          <span className="text-xs text-muted-foreground">
                            {m.periodsAssessed === 1 ? 'First assessment' : '—'}
                          </span>
                        ) : m.delta > 0 ? (
                          <span className="text-success tabular-nums">+{m.delta}</span>
                        ) : m.delta < 0 ? (
                          <span className="text-destructive tabular-nums">{m.delta}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">No change</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {m.currentPeriod
                          ? (periodLabel.get(m.currentPeriod) ?? m.currentPeriod)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number | string
  icon?: React.ComponentType<{ className?: string }>
  tone?: 'good' | 'warn' | 'bad'
}) {
  const toneClass =
    tone === 'good'
      ? 'text-success'
      : tone === 'warn'
        ? 'text-warning'
        : tone === 'bad'
          ? 'text-destructive'
          : 'text-muted-foreground'

  return (
    <Card>
      <CardContent className="pt-6">
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
          {Icon ? <Icon className={`h-3.5 w-3.5 ${toneClass}`} /> : null}
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}
