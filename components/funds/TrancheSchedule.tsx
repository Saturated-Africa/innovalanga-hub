'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { Loader2, Lock, TriangleAlert, Paperclip, FileWarning } from 'lucide-react'
import { uploadTrancheProof, ProofUploadError } from '@/lib/upload-proof'

/**
 * The payment schedule, with the reason a payment cannot be made shown before
 * anybody tries.
 *
 * `canPay` and `blockedBecause` are decided on the server by the same function
 * the payment route uses, so a disabled button and a refused request always
 * agree. A screen that offers an action the server will reject teaches people
 * to distrust it.
 */

export interface TrancheRow {
  id: string
  sequence: number
  amount: number
  status: string
  plannedDate: string | null
  paidOn: string | null
  paymentReference: string | null
  conditions: string | null
  withheldReason: string | null
  approvedBy: string | null
  canPay: boolean
  blockedBecause: string[]
  warnings: string[]
  /** Proof that this tranche was paid. Empty on a paid tranche is a gap. */
  proofs: { id: string; filename: string; href: string }[]
}

export function TrancheSchedule({
  grantId,
  currency,
  rows,
  canAct,
  canPay,
}: {
  grantId: string
  currency: string
  rows: TrancheRow[]
  canAct: boolean
  canPay: boolean
}) {
  // Attaching proof of payment follows whoever may record the payment.
  const canAttachProof = canPay
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [payFor, setPayFor] = useState<TrancheRow | null>(null)
  const [attaching, setAttaching] = useState<string | null>(null)
  const [withholdFor, setWithholdFor] = useState<TrancheRow | null>(null)

  async function attachProof(trancheId: string, file: File) {
    setAttaching(trancheId)
    try {
      await uploadTrancheProof(grantId, trancheId, file)
      toast({ title: 'Proof of payment attached' })
      router.refresh()
    } catch (err) {
      toast({
        title: err instanceof ProofUploadError ? err.message : 'That did not attach.',
        variant: 'destructive',
      })
    } finally {
      setAttaching(null)
    }
  }

  async function act(trancheId: string, body: Record<string, unknown>) {
    setBusy(trancheId)
    try {
      const res = await fetch(`/api/grants/${grantId}/tranches/${trancheId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const parsed = await res.json()
      if (!res.ok) {
        throw new Error(
          typeof parsed.error === 'string' ? parsed.error : 'That could not be done.'
        )
      }
      toast({ title: 'Updated' })
      setPayFor(null)
      setWithholdFor(null)
      router.refresh()
    } catch (err) {
      toast({
        title: 'Not done',
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setBusy(null)
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No tranches on this grant.</p>
  }

  return (
    <>
      <div className="space-y-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`rounded-lg border px-4 py-3 ${
              row.status === 'Withheld' ? 'border-warning/50 bg-warning/5' : 'border-border'
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <p className="font-medium">
                  Tranche {row.sequence}
                  <span className="ml-2 tabular-nums text-muted-foreground">
                    {fmt(row.amount, currency)}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {row.paidOn
                    ? `Paid ${row.paidOn}${row.paymentReference ? ` · ${row.paymentReference}` : ''}`
                    : row.plannedDate
                      ? `Planned for ${row.plannedDate}`
                      : 'No planned date'}
                  {row.approvedBy && row.status !== 'Paid' ? ` · approved by ${row.approvedBy}` : ''}
                </p>
              </div>
              <Badge variant={badgeFor(row.status)}>{row.status}</Badge>
            </div>

            {row.conditions && (
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">Conditions: </span>
                {row.conditions}
              </p>
            )}

            {row.withheldReason && (
              <p className="mt-2 text-sm text-warning">Withheld: {row.withheldReason}</p>
            )}

            {row.status === 'Paid' && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {row.proofs.map((proof) => (
                  <a
                    key={proof.id}
                    href={proof.href}
                    className="link-brand inline-flex items-center gap-1.5 text-xs"
                  >
                    <Paperclip className="h-3 w-3" aria-hidden />
                    {proof.filename}
                  </a>
                ))}

                {row.proofs.length === 0 && (
                  // Money has left and nothing evidences it. A funder
                  // reconciling disbursements asks about exactly this, so it is
                  // stated rather than left as an absence to notice.
                  <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                    <FileWarning className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    No proof of payment on file
                  </span>
                )}

                {canAttachProof && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                    {attaching === row.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : (
                      <Paperclip className="h-3 w-3" aria-hidden />
                    )}
                    {row.proofs.length === 0 ? 'Attach proof' : 'Attach another'}
                    <input
                      type="file"
                      className="sr-only"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      disabled={attaching === row.id}
                      onChange={(ev) => {
                        const file = ev.target.files?.[0]
                        // Cleared so the same file can be picked twice.
                        ev.target.value = ''
                        if (file) void attachProof(row.id, file)
                      }}
                    />
                  </label>
                )}
              </div>
            )}

            {row.status !== 'Paid' && row.status !== 'Cancelled' && row.blockedBecause.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                <span>{row.blockedBecause.join(' ')}</span>
              </p>
            )}

            {row.canPay && row.warnings.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                <span>{row.warnings.join(' ')}</span>
              </p>
            )}

            {canAct && row.status !== 'Paid' && row.status !== 'Cancelled' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(row.status === 'Pending' || row.status === 'Withheld') && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => act(row.id, { action: 'approve' })}
                  >
                    {busy === row.id && (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                    )}
                    Approve
                  </Button>
                )}

                {canPay && row.status === 'Approved' && (
                  <Button size="sm" disabled={!row.canPay || busy !== null} onClick={() => setPayFor(row)}>
                    Record payment
                  </Button>
                )}

                {row.status !== 'Withheld' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => setWithholdFor(row)}
                  >
                    Withhold
                  </Button>
                )}

                {row.status === 'Withheld' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => act(row.id, { action: 'release' })}
                  >
                    Release
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <PayDialog
        row={payFor}
        currency={currency}
        busy={busy !== null}
        onClose={() => setPayFor(null)}
        onConfirm={(paidOn, reference) =>
          payFor && act(payFor.id, { action: 'pay', paidOn, paymentReference: reference || undefined })
        }
      />

      <WithholdDialog
        row={withholdFor}
        busy={busy !== null}
        onClose={() => setWithholdFor(null)}
        onConfirm={(reason) =>
          withholdFor && act(withholdFor.id, { action: 'withhold', reason })
        }
      />
    </>
  )
}

function PayDialog({
  row,
  currency,
  busy,
  onClose,
  onConfirm,
}: {
  row: TrancheRow | null
  currency: string
  busy: boolean
  onClose: () => void
  onConfirm: (paidOn: string, reference: string) => void
}) {
  const [paidOn, setPaidOn] = useState('')
  const [reference, setReference] = useState('')

  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            {row
              ? `Tranche ${row.sequence}, ${fmt(row.amount, currency)}. This records that the money has left the fund.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {row && row.warnings.length > 0 && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {row.warnings.join(' ')}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="paidOn">Date paid</Label>
            <Input id="paidOn" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            <p className="text-xs text-muted-foreground">When the money moved.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="payRef">Payment reference</Label>
            <Input id="payRef" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button disabled={!paidOn || busy} onClick={() => onConfirm(paidOn, reference)}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Record payment
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function WithholdDialog({
  row,
  busy,
  onClose,
  onConfirm,
}: {
  row: TrancheRow | null
  busy: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withhold this tranche</DialogTitle>
          <DialogDescription>
            A reason is required. This is a decision about somebody&rsquo;s money and it has
            to be explicable later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="withholdReason">Reason</Label>
          <Textarea
            id="withholdReason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button disabled={reason.trim() === '' || busy} onClick={() => onConfirm(reason)}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Withhold
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function badgeFor(status: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'Paid') return 'default'
  if (status === 'Approved') return 'outline'
  if (status === 'Cancelled') return 'destructive'
  return 'secondary'
}

function fmt(amount: number, currency: string): string {
  return amount.toLocaleString('en-ZA', { style: 'currency', currency })
}
