import { formatDate, getTRLLabel, getBRLLabel, getIRLLabel } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Lock } from 'lucide-react'
import type { Assessment } from '@prisma/client'

const PERIOD_LABELS: Record<string, string> = {
  baseline: 'Baseline',
  month_3: 'Month 3',
  month_6: 'Month 6',
  month_9: 'Month 9',
  final: 'Final',
}

interface AssessmentTimelineProps {
  assessments: Assessment[]
}

export function AssessmentTimeline({ assessments }: AssessmentTimelineProps) {
  const sorted = [...assessments].sort((a, b) => {
    const order = ['baseline', 'month_3', 'month_6', 'month_9', 'final']
    return order.indexOf(a.period) - order.indexOf(b.period)
  })

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

      <div className="space-y-6">
        {sorted.map((a, i) => {
          const prev = sorted[i - 1]
          const trlDelta = prev ? a.trlScore - prev.trlScore : null
          const brlDelta = prev ? a.brlScore - prev.brlScore : null
          const irlDelta = prev ? a.irlScore - prev.irlScore : null

          return (
            <div key={a.id} className="flex gap-4 pl-10 relative">
              {/* Dot */}
              <div className="absolute left-2.5 flex h-3 w-3 items-center justify-center">
                <div className="h-3 w-3 rounded-full border-2 border-primary bg-card" />
              </div>

              <div className="flex-1 rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{PERIOD_LABELS[a.period]}</span>
                    {a.lockedAt && (
                      <span title="Locked" className="text-muted-foreground">
                        <Lock className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {a.lockedAt ? formatDate(a.lockedAt) : formatDate(a.createdAt)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <ScoreCell label="TRL" score={a.trlScore} delta={trlDelta} sublabel={getTRLLabel(a.trlScore)} />
                  <ScoreCell label="BRL" score={a.brlScore} delta={brlDelta} sublabel={getBRLLabel(a.brlScore)} />
                  <ScoreCell label="IRL" score={a.irlScore} delta={irlDelta} sublabel={getIRLLabel(a.irlScore)} />
                </div>

                <p className="text-xs text-muted-foreground mt-2">
                  Assessed by {a.assessedBy}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ScoreCell({
  label,
  score,
  delta,
  sublabel,
}: {
  label: string
  score: number
  delta: number | null
  sublabel: string
}) {
  return (
    <div className="text-center">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold">{score}</p>
      <p className="text-[10px] text-muted-foreground leading-tight">{sublabel}</p>
      {delta !== null && (
        <span
          className={`text-xs font-medium ${
            delta > 0 ? 'text-success' : delta < 0 ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {delta > 0 ? '+' : ''}{delta}
        </span>
      )}
    </div>
  )
}
