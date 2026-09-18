'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { Loader2, Check, RotateCcw } from 'lucide-react'
import { SignaturePad } from '@/components/beneficiary/SignaturePad'

/**
 * Reviewing a submitted form.
 *
 * Two outcomes, and the second is the one that gets used most. Approving
 * counter-signs it, matching the acceptance block on the funder's paper form.
 * Returning sends it back for correction and voids the signature, because the
 * answers are about to change.
 *
 * Returning is offered as prominently as approving on purpose. A reviewer whose
 * only options are "approve" or "walk away" approves things they should not.
 */
export function ReviewActions({ recordId }: { recordId: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<'idle' | 'approve' | 'return'>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [acceptName, setAcceptName] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  async function post(path: string, body: unknown) {
    setError('')
    setBusy(true)
    try {
      const res = await fetch(`/api/beneficiaries/${recordId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    const ok = await post('accept', {
      acceptedByName: acceptName,
      signatureImage: signature,
      confirmed: true,
    })
    if (ok) {
      toast({ title: 'Form approved' })
      router.refresh()
    }
  }

  async function sendBack() {
    const ok = await post('return', { reason })
    if (ok) {
      toast({
        title: 'Returned for correction',
        description: 'The signature was voided. The beneficiary can now edit and sign again.',
      })
      router.refresh()
    }
  }

  return (
    <Card className="print:hidden">
      <CardContent className="space-y-5 pt-6">
        {error && (
          <p
            className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        {mode === 'idle' && (
          <div className="space-y-3">
            <div>
              <p className="font-medium">This form is awaiting your review</p>
              <p className="text-sm text-muted-foreground">
                Approving counter-signs it. Returning it voids the beneficiary&rsquo;s
                signature so they can correct and sign again.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setMode('approve')}>
                <Check className="mr-1.5 h-4 w-4" aria-hidden />
                Approve
              </Button>
              <Button variant="outline" onClick={() => setMode('return')}>
                <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />
                Return for correction
              </Button>
            </div>
          </div>
        )}

        {mode === 'approve' && (
          <div className="space-y-5">
            <div>
              <p className="font-medium">Acceptance by the centre</p>
              <p className="text-sm text-muted-foreground">
                Your counter-signature confirming this beneficiary is onboarded.
              </p>
            </div>

            <div className="max-w-sm space-y-2">
              <Label htmlFor="acceptName">Name and surname</Label>
              <Input
                id="acceptName"
                value={acceptName}
                onChange={(e) => setAcceptName(e.target.value)}
              />
            </div>

            <SignaturePad label="Signature" onChange={setSignature} />

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={approve}
                disabled={busy || !signature || acceptName.trim().length < 2}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                    Approving…
                  </>
                ) : (
                  'Approve and complete'
                )}
              </Button>
              <Button variant="ghost" onClick={() => setMode('idle')} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {mode === 'return' && (
          <div className="space-y-5">
            <div>
              <p className="font-medium">Return for correction</p>
              <p className="text-sm text-muted-foreground">
                The beneficiary sees this reason. Their signature is removed, since the
                answers are going to change.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">What needs fixing?</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="For example: the ID number does not match the name given."
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" onClick={sendBack} disabled={busy || reason.trim().length < 3}>
                {busy ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                    Returning…
                  </>
                ) : (
                  'Return to beneficiary'
                )}
              </Button>
              <Button variant="ghost" onClick={() => setMode('idle')} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
