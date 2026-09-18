'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'
import { Loader2, MessageCircleQuestion } from 'lucide-react'

/**
 * What the participant has reported, and what came back.
 *
 * The queried items are the point of this list. A query is a request the
 * participant has to act on, so it is shown with the reviewer's note and a way
 * to answer it - rather than as a status they cannot do anything about, which is
 * how a "Queried" badge on its own reads.
 */

export interface MyExpenditureRow {
  id: string
  spentOn: string
  supplier: string
  description: string
  amount: string
  status: string
  reviewNote: string | null
}

export function ParticipantExpenditures({
  grantId,
  rows,
}: {
  grantId: string
  rows: MyExpenditureRow[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function resubmit(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/grants/${grantId}/expenditures/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resubmit' }),
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'That could not be sent back.'
        )
      }
      toast({ title: 'Sent back for review' })
      router.refresh()
    } catch (err) {
      toast({ title: (err as Error).message, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        You have not reported any spending yet. Grant money stays unaccounted for until you
        do, which is what a funder asks about first.
      </p>
    )
  }

  return (
    <div className="space-y-3">
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
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <p className="flex items-start gap-1.5 text-xs">
                <MessageCircleQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{e.reviewNote}</span>
              </p>
              {e.status === 'Queried' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={busy === e.id}
                  onClick={() => resubmit(e.id)}
                >
                  {busy === e.id && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  )}
                  I have sorted this out
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
