'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { Trash2, Plus, Loader2 } from 'lucide-react'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const TIME_OPTIONS: string[] = []
for (let h = 7; h <= 17; h++) {
  for (const m of ['00', '30']) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`)
  }
}

interface Slot {
  id?: string
  dayOfWeek: number
  startTime: string
  endTime: string
  bufferMins: number
}

interface AvailabilityFormProps {
  mentorId: string
  existingSlots: Slot[]
}

export function AvailabilityForm({ mentorId, existingSlots }: AvailabilityFormProps) {
  const router = useRouter()
  const [slots, setSlots] = useState<Slot[]>(existingSlots)
  const [saving, setSaving] = useState(false)

  function addSlot() {
    setSlots((prev) => [
      ...prev,
      { dayOfWeek: 1, startTime: '07:00', endTime: '09:00', bufferMins: 15 },
    ])
  }

  function removeSlot(idx: number) {
    setSlots((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateSlot(idx: number, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  async function handleSave() {
    setSaving(true)
    const res = await fetch(`/api/mentors/${mentorId}/availability`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots }),
    })
    setSaving(false)
    if (res.ok) {
      toast({ title: 'Availability saved' })
      router.refresh()
    } else {
      toast({ title: 'Failed to save', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Weekly Recurring Slots</CardTitle>
            <Button variant="outline" size="sm" onClick={addSlot}>
              <Plus className="h-4 w-4 mr-1" /> Add Slot
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {slots.length === 0 && (
            <p className="text-sm text-muted-foreground">No slots configured. Add a slot to allow innovators to book sessions.</p>
          )}
          {slots.map((slot, idx) => (
            <div key={idx} className="grid grid-cols-4 gap-3 items-end border rounded-md p-3">
              <div>
                <Label className="text-xs">Day</Label>
                <select
                  value={slot.dayOfWeek}
                  onChange={(e) => updateSlot(idx, { dayOfWeek: Number(e.target.value) })}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Start (UTC)</Label>
                <select
                  value={slot.startTime}
                  onChange={(e) => updateSlot(idx, { startTime: e.target.value })}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">End (UTC)</Label>
                <select
                  value={slot.endTime}
                  onChange={(e) => updateSlot(idx, { endTime: e.target.value })}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive"
                onClick={() => removeSlot(idx)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : 'Save Availability'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        All times are in UTC. Times are displayed as SAST (UTC+2) to innovators when booking.
      </p>
    </div>
  )
}
