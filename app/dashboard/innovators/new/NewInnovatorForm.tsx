'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { Loader2, Copy, Check, KeyRound } from 'lucide-react'

interface Option {
  id: string
  name: string
}

interface Created {
  id: string
  email: string
  tempPassword: string
}

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

export function NewInnovatorForm({
  cohorts,
  regions,
}: {
  cohorts: Option[]
  regions: Option[]
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Created | null>(null)
  const [copied, setCopied] = useState(false)

  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [cohortId, setCohortId] = useState(cohorts[0]?.id ?? '')
  const [regionId, setRegionId] = useState('')
  const [phone, setPhone] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [businessSector, setBusinessSector] = useState('')
  const [bio, setBio] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const res = await fetch('/api/admin/innovators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        firstName,
        lastName,
        cohortId,
        regionId: regionId || undefined,
        phone: phone || undefined,
        idNumber: idNumber || undefined,
        businessName: businessName || undefined,
        businessSector: businessSector || undefined,
        bio: bio || undefined,
      }),
    })

    setSaving(false)

    if (res.ok) {
      setCreated(await res.json())
      toast({ title: 'Innovator added' })
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Could not add this innovator.')
    }
  }

  function copyDetails() {
    if (!created) return
    navigator.clipboard
      ?.writeText(created.email + '\n' + created.tempPassword)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => toast({ title: 'Could not copy', variant: 'destructive' }))
  }

  /*
   * The credential is shown once, here, rather than emailed. The sending domain
   * is not verified yet, so an emailed password would fail silently and the
   * facilitator would have no way to know.
   */
  if (created) {
    return (
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-volt">
              <KeyRound className="h-4 w-4 text-brand-ink" aria-hidden />
            </span>
            <div className="space-y-1">
              <p className="font-medium">Account created</p>
              <p className="text-sm text-muted-foreground">
                Give these details to {firstName}. The password is shown only now
                and cannot be retrieved later.
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/40 p-4">
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Email</span>
              <span className="font-mono">{created.email}</span>
            </div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Temporary password</span>
              <span className="font-mono">{created.tempPassword}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={copyDetails}>
              {copied ? (
                <>
                  <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Copy details
                </>
              )}
            </Button>
            <Button asChild>
              <Link href={`/dashboard/innovators/${created.id}`}>Open profile</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/dashboard/innovators">Back to list</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              This becomes their sign-in username.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cohort">Cohort</Label>
              <select
                id="cohort"
                value={cohortId}
                onChange={(e) => setCohortId(e.target.value)}
                required
                className={SELECT_CLASS}
              >
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="region">Region (optional)</Label>
              <select
                id="region"
                value={regionId}
                onChange={(e) => setRegionId(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">Not set</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+27 or 0XX"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="idNumber">SA ID number (optional)</Label>
              <Input
                id="idNumber"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                maxLength={13}
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">
                Encrypted at rest and masked everywhere after saving.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="businessName">Business name (optional)</Label>
              <Input
                id="businessName"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="businessSector">Sector (optional)</Label>
              <Input
                id="businessSector"
                value={businessSector}
                onChange={(e) => setBusinessSector(e.target.value)}
                placeholder="e.g. AgriTech, EdTech"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Notes (optional)</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                  Adding…
                </>
              ) : (
                'Add innovator'
              )}
            </Button>
            <Button type="button" variant="ghost" asChild>
              <Link href="/dashboard/innovators">Cancel</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}
