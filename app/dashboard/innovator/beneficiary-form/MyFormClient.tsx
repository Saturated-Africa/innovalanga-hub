'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { Loader2, PenLine, Clock, CheckCircle2, RotateCcw } from 'lucide-react'
import { SignaturePad } from '@/components/beneficiary/SignaturePad'
import {
  BeneficiaryFormFields,
  type BeneficiaryValues,
} from '@/components/beneficiary/BeneficiaryFormFields'

/**
 * The beneficiary's own capture form.
 *
 * They fill it in, sign it, and it goes to a facilitator to approve. The funder
 * requires the signature, so the form is not submitted separately from signing:
 * signing is the submission.
 *
 * Four states, and the component is really a switch over them: nothing yet, a
 * draft being worked on, signed and waiting, or approved.
 */

type Status = 'None' | 'Draft' | 'AwaitingAcceptance' | 'Accepted' | 'Withdrawn'

function toBool(v: string): boolean | undefined {
  if (v === 'Yes') return true
  if (v === 'No') return false
  return undefined
}

export function MyFormClient({
  recordId,
  status,
  initial,
  returnedReason,
  signedAt,
  acceptedAt,
}: {
  recordId: string | null
  status: Status
  initial: BeneficiaryValues
  returnedReason: string | null
  signedAt: string | null
  acceptedAt: string | null
}) {
  const router = useRouter()
  const [values, setValues] = useState<BeneficiaryValues>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [id, setId] = useState(recordId)
  const [phase, setPhase] = useState<'edit' | 'sign'>(
    status === 'Draft' && recordId ? 'edit' : 'edit'
  )
  const [signedName, setSignedName] = useState(initial.fullName)
  const [signature, setSignature] = useState<string | null>(null)

  function patch(p: Partial<BeneficiaryValues>) {
    setValues((v) => ({ ...v, ...p }))
  }

  function payload() {
    return {
      ...values,
      idNumber: values.idNumber || undefined,
      gender: values.gender || undefined,
      race: values.race || undefined,
      title: values.title || undefined,
      province: values.province || undefined,
      hasDisability: toBool(values.hasDisability),
      hasInnovativeIdea: toBool(values.hasInnovativeIdea),
    }
  }

  async function send(url: string, method: 'POST' | 'PATCH', body: unknown) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const missing = Array.isArray(data.missing) ? ` Still needed: ${data.missing.join(', ')}.` : ''
      throw new Error((data.error ?? 'Something went wrong.') + missing)
    }
    return data
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (id) {
        await send(`/api/beneficiaries/${id}`, 'PATCH', payload())
      } else {
        const created = await send('/api/beneficiaries', 'POST', payload())
        setId(created.id)
      }
      setSignedName(values.fullName)
      setPhase('sign')
      toast({ title: 'Saved' })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function sign() {
    setError('')
    setBusy(true)
    try {
      await send(`/api/beneficiaries/${id}/sign`, 'POST', {
        signedName,
        signatureImage: signature,
        confirmed: true,
      })
      toast({ title: 'Submitted for approval' })
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ── Submitted, waiting on a facilitator ────────────────────────────────
  if (status === 'AwaitingAcceptance') {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <Clock className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <p className="font-medium">Submitted for approval</p>
              <p className="text-sm text-muted-foreground">
                You signed this form on {signedAt}. A facilitator is reviewing it. You
                will not be able to change it while it is with them.
              </p>
            </div>
          </div>
          <div className="pt-2">
            <BeneficiaryFormFields values={values} onChange={() => {}} readOnly />
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── Approved ───────────────────────────────────────────────────────────
  if (status === 'Accepted') {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-volt">
              <CheckCircle2 className="h-4 w-4 text-brand-ink" aria-hidden />
            </span>
            <div>
              <p className="font-medium">Approved</p>
              <p className="text-sm text-muted-foreground">
                Approved on {acceptedAt}. This is your record on the programme.
              </p>
            </div>
          </div>
          <div className="pt-2">
            <BeneficiaryFormFields values={values} onChange={() => {}} readOnly />
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── Draft: fill in, then sign ──────────────────────────────────────────
  return (
    <div className="space-y-6">
      {returnedReason && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Returned for correction
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{returnedReason}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Your previous signature was removed when the form was returned, because
            the answers can change. Sign again once you have corrected it.
          </p>
        </div>
      )}

      {error && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {phase === 'edit' ? (
        <form onSubmit={save} className="space-y-5">
          <BeneficiaryFormFields values={values} onChange={patch} />
          <Button type="submit" disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              'Save and continue to signature'
            )}
          </Button>
        </form>
      ) : (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div>
              <p className="font-medium">Sign your form</p>
              <p className="text-sm text-muted-foreground">
                Signing submits the form to a facilitator for approval.
              </p>
            </div>

            <div className="max-w-sm space-y-2">
              <Label htmlFor="signedName">Your name</Label>
              <Input
                id="signedName"
                value={signedName}
                onChange={(e) => setSignedName(e.target.value)}
              />
            </div>

            <SignaturePad label="Your signature" onChange={setSignature} />

            <p className="max-w-prose text-xs text-muted-foreground">
              By signing you confirm the details above are correct, and consent to them
              being processed for programme administration and funder reporting. The
              date, time and device are recorded with your signature.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={sign}
                disabled={busy || !signature || signedName.trim().length < 2}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                    Submitting…
                  </>
                ) : (
                  <>
                    <PenLine className="mr-1.5 h-4 w-4" aria-hidden />
                    Sign and submit
                  </>
                )}
              </Button>
              <Button variant="ghost" onClick={() => setPhase('edit')} disabled={busy}>
                Back to the form
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
