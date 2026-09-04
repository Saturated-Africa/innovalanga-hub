'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/hooks/use-toast'
import { Trash2, Plus, Loader2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface Override {
  id: string
  date: Date | string
  available: boolean
  reason?: string | null
}

interface Blackout {
  id: string
  startDate: Date | string
  endDate: Date | string
  reason?: string | null
}

interface AvailabilityExceptionsProps {
  mentorId: string
  overrides: Override[]
  blackouts: Blackout[]
}

export function AvailabilityExceptions({
  mentorId,
  overrides: initialOverrides,
  blackouts: initialBlackouts,
}: AvailabilityExceptionsProps) {
  const router = useRouter()
  const [overrides, setOverrides] = useState(initialOverrides)
  const [blackouts, setBlackouts] = useState(initialBlackouts)

  // Override form state
  const [overrideDate, setOverrideDate] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [addingOverride, setAddingOverride] = useState(false)

  // Blackout form state
  const [blackoutStart, setBlackoutStart] = useState('')
  const [blackoutEnd, setBlackoutEnd] = useState('')
  const [blackoutReason, setBlackoutReason] = useState('')
  const [addingBlackout, setAddingBlackout] = useState(false)

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function addOverride() {
    if (!overrideDate) return
    setAddingOverride(true)
    const res = await fetch(`/api/mentors/${mentorId}/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: overrideDate, available: false, reason: overrideReason || undefined }),
    })
    setAddingOverride(false)
    if (res.ok) {
      const override = await res.json()
      setOverrides((prev) => [...prev, override].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()))
      setOverrideDate('')
      setOverrideReason('')
      toast({ title: 'Date marked unavailable' })
      router.refresh()
    } else {
      toast({ title: 'Failed to add override', variant: 'destructive' })
    }
  }

  async function deleteOverride(id: string) {
    setDeletingId(id)
    const res = await fetch(`/api/mentors/${mentorId}/overrides/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    if (res.ok) {
      setOverrides((prev) => prev.filter((o) => o.id !== id))
      router.refresh()
    } else {
      toast({ title: 'Failed to remove', variant: 'destructive' })
    }
  }

  async function addBlackout() {
    if (!blackoutStart || !blackoutEnd) return
    setAddingBlackout(true)
    const res = await fetch(`/api/mentors/${mentorId}/blackouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: blackoutStart, endDate: blackoutEnd, reason: blackoutReason || undefined }),
    })
    setAddingBlackout(false)
    if (res.ok) {
      const blackout = await res.json()
      setBlackouts((prev) => [...prev, blackout].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()))
      setBlackoutStart('')
      setBlackoutEnd('')
      setBlackoutReason('')
      toast({ title: 'Blackout period added' })
      router.refresh()
    } else {
      const body = await res.json().catch(() => ({}))
      toast({ title: 'Failed to add blackout', description: body.error, variant: 'destructive' })
    }
  }

  async function deleteBlackout(id: string) {
    setDeletingId(id)
    const res = await fetch(`/api/mentors/${mentorId}/blackouts/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    if (res.ok) {
      setBlackouts((prev) => prev.filter((b) => b.id !== id))
      router.refresh()
    } else {
      toast({ title: 'Failed to remove', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6">
      {/* Date Overrides */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Unavailable Dates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Mark specific dates as unavailable. These override your weekly recurring availability.
          </p>

          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={overrideDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setOverrideDate(e.target.value)}
                className="h-9 w-40"
              />
            </div>
            <div className="space-y-1 flex-1 min-w-40">
              <Label className="text-xs">Reason (optional)</Label>
              <Input
                type="text"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. Public holiday"
                className="h-9"
              />
            </div>
            <Button size="sm" onClick={addOverride} disabled={addingOverride || !overrideDate}>
              {addingOverride ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Plus className="h-3.5 w-3.5 mr-1" />Add</>}
            </Button>
          </div>

          {overrides.length > 0 && (
            <div className="divide-y divide-border rounded-md border">
              {overrides.map((o) => (
                <div key={o.id} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs border-destructive/25 text-destructive bg-destructive/10">Unavailable</Badge>
                    <span className="text-sm font-medium">{formatDate(o.date)}</span>
                    {o.reason && <span className="text-xs text-muted-foreground">{o.reason}</span>}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => deleteOverride(o.id)}
                    disabled={deletingId === o.id}
                  >
                    {deletingId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {overrides.length === 0 && (
            <p className="text-xs text-muted-foreground">No date overrides set.</p>
          )}
        </CardContent>
      </Card>

      {/* Blackout Periods */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Blackout Periods</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Block out a date range — e.g. annual leave, conferences. No bookings can be made during these periods.
          </p>

          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={blackoutStart}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setBlackoutStart(e.target.value)}
                className="h-9 w-40"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={blackoutEnd}
                min={blackoutStart || new Date().toISOString().split('T')[0]}
                onChange={(e) => setBlackoutEnd(e.target.value)}
                className="h-9 w-40"
              />
            </div>
            <div className="space-y-1 flex-1 min-w-40">
              <Label className="text-xs">Reason (optional)</Label>
              <Input
                type="text"
                value={blackoutReason}
                onChange={(e) => setBlackoutReason(e.target.value)}
                placeholder="e.g. Annual leave"
                className="h-9"
              />
            </div>
            <Button size="sm" onClick={addBlackout} disabled={addingBlackout || !blackoutStart || !blackoutEnd}>
              {addingBlackout ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Plus className="h-3.5 w-3.5 mr-1" />Add</>}
            </Button>
          </div>

          {blackouts.length > 0 && (
            <div className="divide-y divide-border rounded-md border">
              {blackouts.map((b) => (
                <div key={b.id} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs border-warning/25 text-warning bg-warning/10">Blackout</Badge>
                    <span className="text-sm font-medium">
                      {formatDate(b.startDate)} – {formatDate(b.endDate)}
                    </span>
                    {b.reason && <span className="text-xs text-muted-foreground">{b.reason}</span>}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => deleteBlackout(b.id)}
                    disabled={deletingId === b.id}
                  >
                    {deletingId === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {blackouts.length === 0 && (
            <p className="text-xs text-muted-foreground">No blackout periods set.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
