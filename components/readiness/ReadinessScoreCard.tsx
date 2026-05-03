import { cn, getTRLLabel, getBRLLabel, getIRLLabel } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface ScoreCardProps {
  type: 'TRL' | 'BRL' | 'IRL'
  score: number
  previousScore?: number
  className?: string
}

const TYPE_COLORS = {
  TRL: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', accent: 'bg-blue-600' },
  BRL: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', accent: 'bg-green-600' },
  IRL: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', accent: 'bg-purple-600' },
}

const TYPE_LABELS = {
  TRL: 'Technology Readiness',
  BRL: 'Business Readiness',
  IRL: 'Innovation Readiness',
}

function getLabel(type: 'TRL' | 'BRL' | 'IRL', score: number): string {
  if (type === 'TRL') return getTRLLabel(score)
  if (type === 'BRL') return getBRLLabel(score)
  return getIRLLabel(score)
}

export function ReadinessScoreCard({ type, score, previousScore, className }: ScoreCardProps) {
  const colors = TYPE_COLORS[type]
  const delta = previousScore !== undefined ? score - previousScore : null

  return (
    <div className={cn('rounded-xl border p-4', colors.bg, colors.border, className)}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className={cn('text-xs font-semibold uppercase tracking-wide', colors.text)}>{TYPE_LABELS[type]}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{type}</p>
        </div>
        {delta !== null && (
          <DeltaBadge delta={delta} />
        )}
      </div>

      {/* Score dial */}
      <div className="flex items-end gap-2 mb-2">
        <span className="text-4xl font-bold text-gray-900">{score}</span>
        <span className="text-sm text-muted-foreground mb-1">/9</span>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-white/60 overflow-hidden mb-2">
        <div
          className={cn('h-full rounded-full transition-all', colors.accent)}
          style={{ width: `${(score / 9) * 100}%` }}
        />
      </div>

      <p className={cn('text-sm font-medium', colors.text)}>{getLabel(type, score)}</p>
    </div>
  )
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <Badge variant="outline" className="gap-1 text-xs">
        <Minus className="h-3 w-3" />0
      </Badge>
    )
  }
  if (delta > 0) {
    return (
      <Badge variant="success" className="gap-1 text-xs">
        <TrendingUp className="h-3 w-3" />+{delta}
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" className="gap-1 text-xs">
      <TrendingDown className="h-3 w-3" />{delta}
    </Badge>
  )
}
