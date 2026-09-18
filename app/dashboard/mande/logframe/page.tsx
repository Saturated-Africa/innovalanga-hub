'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react'
import { LOGFRAME_LEVEL_VARIANT } from '@/lib/status-colors'
import { PageHeader } from '@/components/shared/PageHeader'

type LogFrameLevel = 'Input' | 'Activity' | 'Output' | 'Outcome' | 'Impact'

interface LogFrameItem {
  id: string
  level: LogFrameLevel
  order: number
  description: string
  indicators?: string | null
  verificationMeans?: string | null
  assumptions?: string | null
}

const LEVELS: LogFrameLevel[] = ['Impact', 'Outcome', 'Output', 'Activity', 'Input']

const EMPTY_FORM = {
  level: 'Output' as LogFrameLevel,
  description: '',
  indicators: '',
  verificationMeans: '',
  assumptions: '',
}

export default function LogframePage() {
  const { toast } = useToast()
  const [programmeId, setProgrammeId] = useState<string | null>(null)
  const [items, setItems] = useState<LogFrameItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<LogFrameItem | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/programmes/me')
      if (!res.ok) return
      const { programmeId: pid } = await res.json()
      setProgrammeId(pid)
      await fetchItems(pid)
    }
    load()
  }, [])

  async function fetchItems(pid: string) {
    setLoading(true)
    const res = await fetch('/api/mande/logframe')
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setOpen(true)
  }

  function openEdit(item: LogFrameItem) {
    setEditing(item)
    setForm({
      level: item.level,
      description: item.description,
      indicators: item.indicators ?? '',
      verificationMeans: item.verificationMeans ?? '',
      assumptions: item.assumptions ?? '',
    })
    setOpen(true)
  }

  async function handleSave() {
    if (!programmeId) return
    setSaving(true)
    if (editing) {
      const res = await fetch('/api/mande/logframe', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, ...form }),
      })
      if (res.ok) {
        const updated = await res.json()
        setItems((prev) => prev.map((i) => (i.id === editing.id ? updated : i)))
        toast({ title: 'Row updated' })
        setOpen(false)
      } else {
        toast({ title: 'Failed to update', variant: 'destructive' })
      }
    } else {
      const res = await fetch('/api/mande/logframe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programmeId, ...form, order: items.length }),
      })
      if (res.ok) {
        const created = await res.json()
        setItems((prev) => [...prev, created])
        toast({ title: 'Row added' })
        setOpen(false)
      } else {
        toast({ title: 'Failed to add row', variant: 'destructive' })
      }
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/mande/logframe?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id))
      toast({ title: 'Row deleted' })
    } else {
      toast({ title: 'Failed to delete', variant: 'destructive' })
    }
  }

  const grouped = LEVELS.reduce<Record<LogFrameLevel, LogFrameItem[]>>(
    (acc, level) => {
      acc[level] = items.filter((i) => i.level === level)
      return acc
    },
    { Impact: [], Outcome: [], Output: [], Activity: [], Input: [] }
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logframe"
        description="Logical Framework Matrix — inputs through impact"
        actions={
          <>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" />
          Add Row
        </Button>
          </>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {LEVELS.map((level) => (
            <Card key={level}>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">
                  <Badge variant={LOGFRAME_LEVEL_VARIANT[level] ?? 'muted'}>
                    {level}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {grouped[level].length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No {level.toLowerCase()} rows yet.</p>
                ) : (
                  <div className="space-y-3">
                    {grouped[level].map((item) => (
                      <div key={item.id} className="border rounded-lg p-3">
                        <div className="flex justify-between items-start gap-2">
                          <p className="text-sm font-medium flex-1">{item.description}</p>
                          <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {(item.indicators || item.verificationMeans || item.assumptions) && (
                          <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                            {item.indicators && (
                              <div><span className="font-medium text-foreground">Indicators:</span> {item.indicators}</div>
                            )}
                            {item.verificationMeans && (
                              <div><span className="font-medium text-foreground">MoV:</span> {item.verificationMeans}</div>
                            )}
                            {item.assumptions && (
                              <div><span className="font-medium text-foreground">Assumptions:</span> {item.assumptions}</div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Logframe Row' : 'Add Logframe Row'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Level</Label>
              <Select value={form.level} onValueChange={(v) => setForm((p) => ({ ...p, level: v as LogFrameLevel }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description *</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Describe this logframe element…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Indicators</Label>
              <Input
                value={form.indicators}
                onChange={(e) => setForm((p) => ({ ...p, indicators: e.target.value }))}
                placeholder="e.g. # of beneficiaries trained"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Means of Verification</Label>
              <Input
                value={form.verificationMeans}
                onChange={(e) => setForm((p) => ({ ...p, verificationMeans: e.target.value }))}
                placeholder="e.g. Attendance registers, survey data"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Assumptions</Label>
              <Input
                value={form.assumptions}
                onChange={(e) => setForm((p) => ({ ...p, assumptions: e.target.value }))}
                placeholder="e.g. Participants remain engaged"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.description.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editing ? 'Update' : 'Add Row'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
