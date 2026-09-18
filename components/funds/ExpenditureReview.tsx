'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { Loader2, MessageCircleQuestion } from 'lucide-react'

/**
 * Reviewing what a participant reported spending.
 *
 * Accepting an item is what converts money paid out into money accounted for,
 * so this is the screen that moves the figure a funder asks about. Querying
 * exists because most problems are a thin description or a missing receipt
 * rather than a bad expense, and rejecting those outright teaches people to stop
 * reporting.
 *
 * A query or a rejection has to carry a note. The server requires it too; it is
 * asked for here so the requirement is visible at the moment of the decision
 * rather than as an error afterwards.
 */

export interface ExpenditureRow {
  id: string
  spentOn: string
  supplier: string
  description: string
  amount: string
  category: string
  status: string
  reviewedBy: string | null
  reviewNote: string | null
}

type Action = 'accept' | 'query' | 'reject'

const NEEDS_NOTE: Action[] = ['query', 'reject']

export function ExpenditureReview({
  grantId,
  rows,
  canReview,
}: {
  grantId: string
  rows: ExpenditureRow[]
  canReview: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<{ row: ExpenditureRow; action: Action } | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  async function act(id: string, action: Action, withNote?: string) {
    setBusy(id)
    setError('')
    try {
      const res = await fetch(`/api/grants/${grantId}/expenditures/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: withNote || undefined }),
      })
      const parsed = await res.json()
      if (!res.ok) {
        throw new Error(
          typeof parsed.error === 'string' ? parsed.error : 'That could not be done.'
        )
      }
      toast({ title: `Marked ${String(parsed.status).toLowerCase()}` })
      setNoteFor(null)
      setNote('')
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
      if (!noteFor) toast({ title: (err as Error).message, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  function start(row: ExpenditureRow, action: Action) {
    setError('')
    if (NEEDS_NOTE.includes(action)) {
      setNote('')
      setNoteFor({ row, action })
      return
    }
    void act(row.id, action)
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing reported yet. Money paid out stays unaccounted for until the participant
        submits what it was spent on.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {rows.map((e) => (
        <div
          key={e.id}
          className="space-y-2 border-b border-border pb-3 text-sm last:border-0 last:pb-0"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="min-w-0">
              <span className="font-medium">{e.supplier}</span>
              <span className="text-muted-foreground"> · {e.description}</span>
            </span>
            <span className="flex items-center gap-4">
              <span className="text-xs text-muted-foreground">{e.spentOn}</span>
              <Badge
                variant={
                  e.status === 'Accepted'
                    ? 'default'
                    : e.status === 'Rejected'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {e.status}
              </Badge>
              <span className="tabular-nums">{e.amount}</span>
            </span>
          </div>

          {e.reviewNote && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <MessageCircleQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {e.reviewNote}
                {e.reviewedBy ? ` — ${e.reviewedBy}` : ''}
              </span>
            </p>
          )}

          {canReview && (
            <div className="flex flex-wrap gap-2">
              {e.status !== 'Accepted' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === e.id}
                  onClick={() => start(e, 'accept')}
                >
                  {busy === e.id && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  )}
                  Accept
                </Button>
              )}
              {e.status !== 'Queried' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === e.id}
                  onClick={() => start(e, 'query')}
                >
                  Query
                </Button>
              )}
              {e.status !== 'Rejected' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={busy === e.id}
                  onClick={() => start(e, 'reject')}
                >
                  Reject
                </Button>
              )}
            </div>
          )}
        </div>
      ))}

      <Dialog open={noteFor !== null} onOpenChange={(o) => !o && setNoteFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {noteFor?.action === 'query' ? 'Query this expense' : 'Reject this expense'}
            </DialogTitle>
            <DialogDescription>
              {noteFor?.action === 'query'
                ? 'The participant sees this and can answer it. Say what is missing.'
                : 'The participant sees this. Say why it cannot be accepted.'}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="review-note">Note</Label>
            <Textarea
              id="review-note"
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              rows={4}
              placeholder={
                noteFor?.action === 'query'
                  ? 'For example: please attach the invoice for this amount.'
                  : 'For example: this is outside what the grant was awarded for.'
              }
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNoteFor(null)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              disabled={busy !== null || note.trim() === ''}
              onClick={() => noteFor && act(noteFor.row.id, noteFor.action, note.trim())}
            >
              {busy !== null && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
              )}
              {noteFor?.action === 'query' ? 'Send the query' : 'Reject it'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
