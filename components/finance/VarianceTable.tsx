'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'
import { Check, Loader2 } from 'lucide-react'

/**
 * Budget against actual, activity by activity, with the written reason the
 * funder asks for wherever the two differ.
 *
 * Budget and actual are both read-only here, and deliberately so. The budget
 * comes from the agreed project plan and the actual is the sum of transactions
 * coded to the activity, so a figure typed over either would be a number with
 * no evidence behind it - which is the thing this module exists to stop. To
 * change an actual, code a transaction differently; the figure follows.
 *
 * Each row saves on its own. A quarter's explanations get written across
 * several sittings by more than one person, and one long form with a single
 * save button loses somebody's work every time.
 */

export interface VarianceRow {
  activityId: string
  code: string
  details: string
  costCategory: string
  budget: number
  actual: number
  reason: string
  comment: string
}

const money = (n: number) =>
  n.toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })

const CATEGORY_LABEL: Record<string, string> = {
  Personnel: 'Personnel',
  Operational: 'Operational',
  CapitalEquipment: 'Capital equipment',
  Consumables: 'Consumables',
}

export function VarianceTable({
  periodId,
  locked,
  rows,
}: {
  periodId: string
  locked: boolean
  rows: VarianceRow[]
}) {
  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This project has no activities, so there is nothing to report against.
        </p>
      ) : (
        rows.map((row) => (
          <VarianceRowEditor key={row.activityId} periodId={periodId} locked={locked} row={row} />
        ))
      )}
    </div>
  )
}

function VarianceRowEditor({
  periodId,
  locked,
  row,
}: {
  periodId: string
  locked: boolean
  row: VarianceRow
}) {
  const router = useRouter()
  const [reason, setReason] = useState(row.reason)
  const [comment, setComment] = useState(row.comment)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  // Variance in the direction the funder's own note describes for expenditure:
  // budget less actual, so a positive number is money not yet spent.
  const variance = row.budget - row.actual
  const differs = Math.round(variance * 100) !== 0
  const dirty = reason !== row.reason || comment !== row.comment
  const needsReason = differs && reason.trim() === ''

  async function save() {
    setBusy(true)
    try {
      const res = await fetch(`/api/finance/periods/${periodId}/variance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: row.activityId, reason, comment }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not save.')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      router.refresh()
    } catch (err) {
      toast({
        title: 'Not saved',
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        needsReason ? 'border-warning/50 bg-warning/5' : 'border-border'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            <span className="tabular-nums">{row.code}</span> {row.details}
          </p>
          <Badge variant="secondary" className="mt-1">
            {CATEGORY_LABEL[row.costCategory] ?? row.costCategory}
          </Badge>
        </div>

        <dl className="flex shrink-0 gap-6 text-right text-sm tabular-nums">
          <Figure label="Budget" value={money(row.budget)} />
          <Figure label="Actual" value={money(row.actual)} />
          <Figure
            label="Variance"
            value={money(variance)}
            tone={differs ? (variance < 0 ? 'over' : 'under') : undefined}
          />
        </dl>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label
            htmlFor={`reason-${row.activityId}`}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Reason for the variance
          </label>
          <Textarea
            id={`reason-${row.activityId}`}
            rows={2}
            value={reason}
            disabled={locked}
            placeholder={differs ? 'Required by the funder where the figures differ.' : 'Not needed.'}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`comment-${row.activityId}`}
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Comment
          </label>
          <Input
            id={`comment-${row.activityId}`}
            value={comment}
            disabled={locked}
            placeholder="Anything else the funder should read."
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
      </div>

      {!locked && (
        <div className="mt-2 flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={save} disabled={busy || !dirty}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
            {saved && !dirty ? (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Saved
              </>
            ) : (
              'Save'
            )}
          </Button>
          {needsReason && (
            <span className="text-xs text-warning">
              This line exports with an empty reason.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'over' | 'under'
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={`font-medium ${
          tone === 'over' ? 'text-destructive' : tone === 'under' ? 'text-warning' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
