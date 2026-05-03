'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { Loader2, Pencil, Check, X } from 'lucide-react'

interface MentorshipLogEditorProps {
  bookingId: string
  initialNotes: string | null
  initialOutcomes: string | null
  initialNextSteps: string | null
  readonly?: boolean
}

export function MentorshipLogEditor({
  bookingId,
  initialNotes,
  initialOutcomes,
  initialNextSteps,
  readonly = false,
}: MentorshipLogEditorProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [outcomes, setOutcomes] = useState(initialOutcomes ?? '')
  const [nextSteps, setNextSteps] = useState(initialNextSteps ?? '')

  // Saved values to restore on cancel
  const [saved, setSaved] = useState({ notes, outcomes, nextSteps })

  function handleCancel() {
    setNotes(saved.notes)
    setOutcomes(saved.outcomes)
    setNextSteps(saved.nextSteps)
    setEditing(false)
  }

  async function handleSave() {
    setSaving(true)
    const res = await fetch(`/api/mentorship/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes, outcomes, nextSteps }),
    })
    setSaving(false)

    if (res.ok) {
      setSaved({ notes, outcomes, nextSteps })
      setEditing(false)
      toast({ title: 'Session notes saved' })
      router.refresh()
    } else {
      toast({ title: 'Failed to save', variant: 'destructive' })
    }
  }

  const hasContent = notes || outcomes || nextSteps

  if (!editing) {
    return (
      <div className="space-y-3">
        {hasContent ? (
          <>
            {notes && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Session Notes</p>
                <p className="text-sm whitespace-pre-wrap">{notes}</p>
              </div>
            )}
            {outcomes && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Outcomes</p>
                <p className="text-sm whitespace-pre-wrap">{outcomes}</p>
              </div>
            )}
            {nextSteps && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Next Steps</p>
                <p className="text-sm whitespace-pre-wrap">{nextSteps}</p>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground italic">No notes logged yet.</p>
        )}
        {!readonly && (
          <Button variant="ghost" size="sm" className="text-xs mt-1" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            {hasContent ? 'Edit notes' : 'Add notes'}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">Session Notes</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What was discussed during the session?"
          rows={3}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">Outcomes</Label>
        <Textarea
          value={outcomes}
          onChange={(e) => setOutcomes(e.target.value)}
          placeholder="What was achieved or decided?"
          rows={2}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">Next Steps</Label>
        <Textarea
          value={nextSteps}
          onChange={(e) => setNextSteps(e.target.value)}
          placeholder="What should the innovator do before the next session?"
          rows={2}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Saving…</> : <><Check className="mr-1.5 h-3.5 w-3.5" />Save</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
          <X className="mr-1 h-3.5 w-3.5" />Cancel
        </Button>
      </div>
    </div>
  )
}
