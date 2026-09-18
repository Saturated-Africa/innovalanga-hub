'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { Loader2, Check, PenLine } from 'lucide-react'
import { SignaturePad } from '@/components/beneficiary/SignaturePad'
import {
  BeneficiaryFormFields,
  EMPTY_BENEFICIARY,
  type BeneficiaryValues,
} from '@/components/beneficiary/BeneficiaryFormFields'

/**
 * Capturing a beneficiary, in the order the paper form is completed: the
 * details, the beneficiary's signature, then the centre's acceptance.
 *
 * The three steps are separate requests on purpose. The answers are fixed at
 * the moment the beneficiary signs, and the server hashes them then; the
 * acceptance step re-hashes and refuses if anything moved in between. Saving
 * everything in one request would leave nothing to compare.
 */

type Step = 'details' | 'sign' | 'accept' | 'done'

/** The form sends 'Yes'/'No'; the API takes booleans. */
function toBool(v: string): boolean | undefined {
  if (v === 'Yes') return true
  if (v === 'No') return false
  return undefined
}

export function CaptureClient({ cohorts }: { cohorts: { id: string; name: string }[] }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('details')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recordId, setRecordId] = useState<string | null>(null)

  const [values, setValues] = useState<BeneficiaryValues>(EMPTY_BENEFICIARY)
  const [cohortId, setCohortId] = useState(cohorts[0]?.id ?? '')

  const [signedName, setSignedName] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [acceptName, setAcceptName] = useState('')
  const [acceptSignature, setAcceptSignature] = useState<string | null>(null)

  function patch(p: Partial<BeneficiaryValues>) {
    setValues((v) => ({ ...v, ...p }))
  }

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const missing = Array.isArray(data.missing) ? ` Missing: ${data.missing.join(', ')}.` : ''
      throw new Error((data.error ?? 'Something went wrong.') + missing)
    }
    return data
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const data = await post('/api/beneficiaries', {
        ...values,
        cohortId: cohortId || undefined,
        idNumber: values.idNumber || undefined,
        hasDisability: toBool(values.hasDisability),
        hasInnovativeIdea: toBool(values.hasInnovativeIdea),
        gender: values.gender || undefined,
        race: values.race || undefined,
        title: values.title || undefined,
        province: values.province || undefined,
      })
      setRecordId(data.id)
      // Pre-fill the declaration with the captured name; still editable, since
      // the person signing is the one who decides how their name is written.
      setSignedName(values.fullName)
      setStep('sign')
      toast({ title: 'Details captured' })
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
      await post(`/api/beneficiaries/${recordId}/sign`, {
        signedName,
        signatureImage: signature,
        confirmed: true,
      })
      setStep('accept')
      toast({ title: 'Signed by beneficiary' })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function accept() {
    setError('')
    setBusy(true)
    try {
      await post(`/api/beneficiaries/${recordId}/accept`, {
        acceptedByName: acceptName,
        signatureImage: acceptSignature,
        confirmed: true,
      })
      setStep('done')
      router.refresh()
      toast({ title: 'Beneficiary onboarded' })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (step === 'done' && recordId) {
    return (
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-volt">
              <Check className="h-4 w-4 text-brand-ink" aria-hidden />
            </span>
            <div>
              <p className="font-medium">Form complete</p>
              <p className="text-sm text-muted-foreground">
                Signed by {values.fullName} and accepted by {acceptName}. The record is
                now locked.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/dashboard/beneficiaries/${recordId}`}>View signed form</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/beneficiaries/new">Capture another</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/dashboard/beneficiaries">All beneficiaries</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Where we are. Three steps, in the order the paper form is filled. */}
      <ol className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        {(
          [
            ['details', 'Details'],
            ['sign', 'Beneficiary signature'],
            ['accept', 'Centre acceptance'],
          ] as const
        ).map(([key, label], i) => {
          const order: Step[] = ['details', 'sign', 'accept']
          const done = order.indexOf(step) > i
          const current = step === key
          return (
            <li
              key={key}
              className={
                current
                  ? 'font-semibold text-foreground'
                  : done
                    ? 'text-brand-volt-deep'
                    : 'text-muted-foreground'
              }
            >
              {done ? '✓ ' : `${i + 1}. `}
              {label}
            </li>
          )
        })}
      </ol>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {step === 'details' && (
        <form onSubmit={saveDetails} className="space-y-5">
          {cohorts.length > 0 && (
            <div className="max-w-sm space-y-2">
              <Label htmlFor="cohort">Cohort</Label>
              <select
                id="cohort"
                value={cohortId}
                onChange={(e) => setCohortId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Not assigned yet</option>
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

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
      )}

      {step === 'sign' && (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div>
              <p className="font-medium">Beneficiary signature</p>
              <p className="text-sm text-muted-foreground">
                Hand the device to {values.fullName || 'the beneficiary'} to sign.
              </p>
            </div>

            <div className="max-w-sm space-y-2">
              <Label htmlFor="signedName">Beneficiary name</Label>
              <Input
                id="signedName"
                value={signedName}
                onChange={(e) => setSignedName(e.target.value)}
              />
            </div>

            <SignaturePad label="Signature" onChange={setSignature} />

            <p className="max-w-prose text-xs text-muted-foreground">
              By signing, the beneficiary confirms the details above are correct and
              consents to them being processed for programme administration and funder
              reporting. The date, time and device are recorded with the signature.
            </p>

            <Button onClick={sign} disabled={busy || !signature || signedName.trim().length < 2}>
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                  Signing…
                </>
              ) : (
                <>
                  <PenLine className="mr-1.5 h-4 w-4" aria-hidden />
                  Sign
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'accept' && (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div>
              <p className="font-medium">Acceptance by the centre</p>
              <p className="text-sm text-muted-foreground">
                Counter-signature confirming the beneficiary has been onboarded.
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

            <SignaturePad label="Signature" onChange={setAcceptSignature} />

            <Button
              onClick={accept}
              disabled={busy || !acceptSignature || acceptName.trim().length < 2}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                  Accepting…
                </>
              ) : (
                'Accept and complete'
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
