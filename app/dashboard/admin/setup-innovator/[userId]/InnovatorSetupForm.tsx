'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { Loader2 } from 'lucide-react'

interface Cohort {
  id: string
  name: string
  programmeId: string
  region?: { id: string; name: string } | null
}

interface Region {
  id: string
  name: string
}

interface InnovatorSetupFormProps {
  userId: string
  cohorts: Cohort[]
  defaultFirstName: string
  defaultLastName: string
}

export function InnovatorSetupForm({
  userId,
  cohorts,
  defaultFirstName,
  defaultLastName,
}: InnovatorSetupFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [firstName, setFirstName] = useState(defaultFirstName)
  const [lastName, setLastName] = useState(defaultLastName)
  const [cohortId, setCohortId] = useState(cohorts[0]?.id ?? '')
  const [regionId, setRegionId] = useState('')
  const [regions, setRegions] = useState<Region[]>([])
  const [phone, setPhone] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [businessSector, setBusinessSector] = useState('')
  const [bio, setBio] = useState('')

  // Load regions when cohort changes
  useEffect(() => {
    if (!cohortId) return
    const cohort = cohorts.find((c) => c.id === cohortId)
    if (!cohort) return
    fetch(`/api/programmes/${cohort.programmeId}/regions`)
      .then((r) => r.json())
      .then((data: Region[]) => {
        setRegions(data)
        setRegionId(data[0]?.id ?? '')
      })
      .catch(() => {})
  }, [cohortId, cohorts])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const res = await fetch('/api/admin/innovator-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        cohortId,
        regionId: regionId || undefined,
        firstName,
        lastName,
        phone: phone || undefined,
        idNumber: idNumber || undefined,
        businessName: businessName || undefined,
        businessSector: businessSector || undefined,
        bio: bio || undefined,
      }),
    })

    setSaving(false)

    if (res.ok) {
      const profile = await res.json()
      toast({ title: 'Innovator profile created' })
      router.push(`/dashboard/innovators/${profile.id}`)
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Failed to create profile.')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="pt-6 space-y-5">
          {/* Name */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>First Name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
          </div>

          {/* Cohort + Region */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Cohort</Label>
              <select
                value={cohortId}
                onChange={(e) => setCohortId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              >
                {cohorts.length === 0 && <option value="">No cohorts available</option>}
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Region (optional)</Label>
              <select
                value={regionId}
                onChange={(e) => setRegionId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— No region —</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label>Phone (optional)</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+27 / 0XX XXX XXXX"
            />
          </div>

          {/* ID Number */}
          <div className="space-y-1.5">
            <Label>ID Number (optional)</Label>
            <Input
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              placeholder="National ID number"
            />
            <p className="text-xs text-muted-foreground">
              Encrypted at rest. Masked after saving.
            </p>
          </div>

          {/* Business */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Business Name (optional)</Label>
              <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Business Sector (optional)</Label>
              <Input value={businessSector} onChange={(e) => setBusinessSector(e.target.value)} placeholder="e.g. AgriTech, EdTech" />
            </div>
          </div>

          {/* Bio */}
          <div className="space-y-1.5">
            <Label>Bio (optional)</Label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Brief description of the innovator and their venture"
              rows={3}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={saving || cohorts.length === 0}>
              {saving
                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Saving…</>
                : 'Create Profile & Go to Dashboard'}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}
