'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'
import { Clock, Plus, Pencil, Trash2, Loader2, Check, X } from 'lucide-react'
import { EVENT_COLORS, DEFAULT_EVENT_COLOR } from '@/lib/event-colors'

interface EventType {
  id: string
  name: string
  slug: string
  description: string | null
  durationMins: number
  bufferBefore: number
  bufferAfter: number
  color: string
  active: boolean
}

const COLORS = EVENT_COLORS

function EventTypeForm({
  initial,
  mentorId,
  onSave,
  onCancel,
}: {
  initial?: Partial<EventType>
  mentorId: string
  onSave: (et: EventType) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [durationMins, setDurationMins] = useState(initial?.durationMins ?? 60)
  const [bufferAfter, setBufferAfter] = useState(initial?.bufferAfter ?? 15)
  const [color, setColor] = useState(initial?.color ?? DEFAULT_EVENT_COLOR)
  const [saving, setSaving] = useState(false)

  function handleNameChange(v: string) {
    setName(v)
    if (!initial?.id) {
      setSlug(v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
    }
  }

  async function handleSave() {
    if (!name.trim() || !slug.trim()) {
      toast({ title: 'Name and slug are required.', variant: 'destructive' })
      return
    }
    setSaving(true)
    const method = initial?.id ? 'PATCH' : 'POST'
    const body = initial?.id
      ? { id: initial.id, name, description, durationMins, bufferAfter, color }
      : { name, slug, description, durationMins, bufferAfter, color }

    const res = await fetch(`/api/mentors/${mentorId}/event-types`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (res.ok) {
      const saved = await res.json()
      onSave(saved)
    } else {
      const data = await res.json().catch(() => ({}))
      toast({ title: data.error ?? 'Failed to save.', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="e.g. 1-on-1 Mentorship" />
        </div>
        <div className="space-y-1.5">
          <Label>Slug (URL key)</Label>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="e.g. mentorship-60"
            disabled={!!initial?.id}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Description (optional)</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description shown to innovators" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Duration (minutes)</Label>
          <Input
            type="number"
            min={15}
            max={480}
            step={15}
            value={durationMins}
            onChange={(e) => setDurationMins(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Buffer after session (minutes)</Label>
          <Input
            type="number"
            min={0}
            max={60}
            step={5}
            value={bufferAfter}
            onChange={(e) => setBufferAfter(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Colour</Label>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-full border-2 transition-transform ${
                color === c ? 'border-foreground scale-110' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button onClick={handleSave} size="sm" disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
          {initial?.id ? 'Update' : 'Add session type'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-3.5 w-3.5 mr-1" /> Cancel
        </Button>
      </div>
    </div>
  )
}

export default function EventTypesPage() {
  const { data: session } = useSession()
  const [mentorId, setMentorId] = useState<string | null>(null)
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!session?.user?.id) return
      // Get mentor profile id
      const res = await fetch('/api/mentors/me')
      if (!res.ok) { setLoading(false); return }
      const mentor = await res.json()
      setMentorId(mentor.id)
      const etRes = await fetch(`/api/mentors/${mentor.id}/event-types`)
      if (etRes.ok) setEventTypes(await etRes.json())
      setLoading(false)
    }
    load()
  }, [session])

  async function toggleActive(et: EventType) {
    const res = await fetch(`/api/mentors/${mentorId}/event-types`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: et.id, active: !et.active }),
    })
    if (res.ok) {
      const updated = await res.json()
      setEventTypes((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
    }
  }

  async function deleteET(id: string) {
    const res = await fetch(`/api/mentors/${mentorId}/event-types?id=${id}`, { method: 'DELETE' })
    if (res.ok) setEventTypes((prev) => prev.filter((e) => e.id !== id))
  }

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
  if (!mentorId) return <p className="text-muted-foreground">Mentor profile not found. Contact an administrator.</p>

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Session Types</h1>
        <p className="text-muted-foreground mt-1">
          Define the types of sessions innovators can book with you.
        </p>
      </div>

      <div className="space-y-3">
        {eventTypes.map((et) => (
          <div key={et.id}>
            {editing === et.id ? (
              <EventTypeForm
                initial={et}
                mentorId={mentorId}
                onSave={(saved) => {
                  setEventTypes((prev) => prev.map((e) => (e.id === saved.id ? saved : e)))
                  setEditing(null)
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <Card className={!et.active ? 'opacity-60' : ''}>
                <CardContent className="flex items-center gap-3 py-3 px-4">
                  <span
                    className="h-8 w-1 rounded-full shrink-0"
                    style={{ backgroundColor: et.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{et.name}</p>
                      {!et.active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                    </div>
                    {et.description && <p className="text-xs text-muted-foreground">{et.description}</p>}
                    <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{et.durationMins} min · {et.bufferAfter} min buffer after</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleActive(et)}>
                      {et.active ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(et.id)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => deleteET(et.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ))}

        {eventTypes.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">No session types yet. Add one below.</p>
        )}
      </div>

      {adding ? (
        <EventTypeForm
          mentorId={mentorId}
          onSave={(saved) => {
            setEventTypes((prev) => [...prev, saved])
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add session type
        </Button>
      )}
    </div>
  )
}
