import { cn, getTRLLabel, getBRLLabel, getIRLLabel, getMRLLabel } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { READINESS, type ReadinessKey } from '@/lib/readiness-colors'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

type ScoreType = 'TRL' | 'BRL' | 'IRL' | 'MRL'

interface ScoreCardProps {
  type: ScoreType
  score: number
  previousScore?: number
  className?: string
}

const LABEL_FN: Record<ScoreType, (score: number) => string> = {
  TRL: getTRLLabel,
  BRL: getBRLLabel,
  IRL: getIRLLabel,
  MRL: getMRLLabel,
}

export function ReadinessScoreCard({ type, score, previousScore, className }: ScoreCardProps) {
  const dim = READINESS[type.toLowerCase() as ReadinessKey]
  const delta = previousScore !== undefined ? score - previousScore : null

  return (
    <div className={cn('rounded-lg border bg-card p-4', dim.surface, className)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('text-xs font-semibold uppercase tracking-wide', dim.text)}>
            {dim.name.replace(' Level', '')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{dim.label}</p>
        </div>
        {delta !== null && <DeltaBadge delta={delta} />}
      </div>

      <div className="mb-2 flex items-end gap-1.5">
        <span className="text-4xl font-bold leading-none tabular-nums text-foreground">
          {score}
        </span>
        <span className="mb-0.5 text-sm text-muted-foreground">/ 9</span>
      </div>

      {/* Progress track — a solid neutral rail rather than white, so the card
          reads the same on the light canvas and the dark shell. */}
      <div
        className="mb-2 h-1.5 overflow-hidden rounded-full bg-foreground/10"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={1}
        aria-valuemax={9}
        aria-label={`${dim.label} score`}
      >
        <div
          className={cn('h-full rounded-full transition-all', dim.fill)}
          style={{ width: `${(score / 9) * 100}%` }}
        />
      </div>

      <p className={cn('text-sm font-medium', dim.text)}>{LABEL_FN[type](score)}</p>
    </div>
  )
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <Badge variant="muted" size="sm" className="shrink-0">
        <Minus className="h-3 w-3" aria-hidden />0
      </Badge>
    )
  }
  if (delta > 0) {
    return (
      <Badge variant="success" size="sm" className="shrink-0">
        <TrendingUp className="h-3 w-3" aria-hidden />+{delta}
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" size="sm" className="shrink-0">
      <TrendingDown className="h-3 w-3" aria-hidden />
      {delta}
    </Badge>
  )
}
