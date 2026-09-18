'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { Loader2, Lock } from 'lucide-react'

/**
 * A participant editing their own details.
 *
 * The fields here are the ones they own: how they are described. Cohort and
 * region are absent on purpose rather than disabled, because a greyed-out
 * control invites a request to enable it - those decide which intake and which
 * province their results are counted under, so they belong to staff.
 *
 * The ID number appears only when there is none on file. Once set it is shown
 * masked and locked, because a funder may have verified it and replacing it
 * quietly is the one edit here with real consequences.
 */

export interface OwnDetails {
  firstName: string
  lastName: string
  phone: string
  businessName: string
  businessSector: string
  bio: string
  /** Masked, or null when none is on file. */
  idNumberMasked: string | null
}

export function YourDetails({ details }: { details: OwnDetails }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ ...details, idNumber: '' })

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    setBusy(true)
    setErrors({})
    try {
      const res = await fetch('/api/innovator/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          phone: form.phone,
          businessName: form.businessName,
          businessSector: form.businessSector,
          bio: form.bio,
          // Only sent when the field was shown, which is only when none is set.
          idNumber: form.idNumber || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        // Per-field messages go next to their field; anything else is a toast.
        if (body.fields && typeof body.fields === 'object') {
          setErrors(body.fields)
          throw new Error('Some details need fixing.')
        }
        throw new Error(typeof body.error === 'string' ? body.error : 'That did not save.')
      }
      toast({ title: 'Your details are saved' })
      setForm((f) => ({ ...f, idNumber: '' }))
      router.refresh()
    } catch (err) {
      toast({ title: (err as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  function fieldError(name: string) {
    return errors[name] ? (
      <p className="text-xs text-destructive" role="alert">
        {errors[name]}
      </p>
    ) : null
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="own-first">First name</Label>
          <Input
            id="own-first"
            value={form.firstName}
            onChange={(e) => set('firstName', e.target.value)}
          />
          {fieldError('firstName')}
        </div>

        <div className="space-y-2">
          <Label htmlFor="own-last">Surname</Label>
          <Input
            id="own-last"
            value={form.lastName}
            onChange={(e) => set('lastName', e.target.value)}
          />
          {fieldError('lastName')}
        </div>

        <div className="space-y-2">
          <Label htmlFor="own-phone">Phone number</Label>
          <Input
            id="own-phone"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="082 123 4567"
          />
          {fieldError('phone')}
        </div>

        <div className="space-y-2">
          <Label htmlFor="own-id">ID number</Label>
          {details.idNumberMasked === null ? (
            <>
              <Input
                id="own-id"
                inputMode="numeric"
                value={form.idNumber}
                onChange={(e) => set('idNumber', e.target.value)}
                placeholder="13 digits"
              />
              {fieldError('idNumber')}
              <p className="text-xs text-muted-foreground">
                Saved encrypted, and shown only as the last digits afterwards. You can set
                it once here; changing it later needs a facilitator.
              </p>
            </>
          ) : (
            <>
              <Input id="own-id" value={details.idNumberMasked} disabled />
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                Already on file. Ask a facilitator if this is wrong — a funder may have
                verified it.
              </p>
            </>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="own-business">Business name</Label>
          <Input
            id="own-business"
            value={form.businessName}
            onChange={(e) => set('businessName', e.target.value)}
          />
          {fieldError('businessName')}
        </div>

        <div className="space-y-2">
          <Label htmlFor="own-sector">Sector</Label>
          <Input
            id="own-sector"
            value={form.businessSector}
            onChange={(e) => set('businessSector', e.target.value)}
            placeholder="Agriculture, manufacturing, services…"
          />
          {fieldError('businessSector')}
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="own-bio">About your business</Label>
          <Textarea
            id="own-bio"
            rows={4}
            value={form.bio}
            onChange={(e) => set('bio', e.target.value)}
            placeholder="What you do, who you serve, where you are trying to get to."
          />
          {fieldError('bio')}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Your cohort and region are set by your programme, so they are not shown here.
        </p>
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
          Save changes
        </Button>
      </div>
    </div>
  )
}
