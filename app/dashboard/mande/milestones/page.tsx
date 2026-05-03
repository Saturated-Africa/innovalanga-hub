'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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
import { Loader2, Plus, Pencil, Trash2, Flag } from 'lucide-react'
import { formatDate } from '@/lib/utils'

type MilestoneStatus = 'NotStarted' | 'InProgress' | 'Completed' | 'Delayed' | 'AtRisk'

interface Milestone {
  id: string
  title: string
  description?: string | null
  targetDate: string
  completedDate?: string | null
  status: MilestoneStatus
  notes?: string | null
  cohort?: { name: string } | null
  innovator?: { firstName: string; lastName: string } | null
}

const STATUS_CONFIG: Record<MilestoneStatus, { label: string; color: string; dot: string }> = {
  NotStarted: { label: 'Not Started', color: 'bg-gray-100 text-gray-800', dot: 'bg-gray-400' },
  InProgress:  { label: 'In Progress', color: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500' },
  Completed:   { label: 'Completed', color: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
  Delayed:     { label: 'Delayed', color: 'bg-red-100 text-red-800', dot: 'bg-red-500' },
  AtRisk:      { label: 'At Risk', color: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500' },
}

const STATUSES = Object.keys(STATUS_CONFIG) as MilestoneStatus[]

const EMPTY_FORM = {
  title: '',
  description: '',
  targetDate: '',
  status: 'NotStarted' as MilestoneStatus,
  notes: '',
}

export default function MilestonesPage() {
  const { toast } = useToast()
  const [programmeId, setProgrammeId] = useState<string | null>(null)
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [filterStatus, setFilterStatus] = useState<MilestoneStatus | 'All'>('All')

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/programmes/me')
      if (!res.ok) return
      const { programmeId: pid } = await res.json()
      setProgrammeId(pid)
      await fetchMilestones(pid)
    }
    load()
  }, [])

  async function fetchMilestones(pid: string) {
    setLoading(true)
    const res = await fetch(`/api/mande/milestones?programmeId=${pid}`)
    if (res.ok) setMilestones(await res.json())
    setLoading(false)
  }

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setOpen(true)
  }

  function openEdit(m: Milestone) {
    setEditing(m)
    setForm({
      title: m.title,
      description: m.description ?? '',
      targetDate: m.targetDate.slice(0, 10),
      status: m.status,
      notes: m.notes ?? '',
    })
    setOpen(true)
  }

  async function handleSave() {
    if (!programmeId) return
    setSaving(true)

    if (editing) {
      const res = await fetch(`/api/mande/milestones/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          completedDate: form.status === 'Completed' && !editing.completedDate
            ? new Date().toISOString().slice(0, 10)
            : (form.status !== 'Completed' ? null : editing.completedDate),
        }),
      })
      if (res.ok) {
        const updated = await res.json()
        setMilestones((prev) => prev.map((m) => m.id === editing.id ? { ...m, ...updated } : m))
        toast({ title: 'Milestone updated' })
        setOpen(false)
      } else {
        toast({ title: 'Failed to update', variant: 'destructive' })
      }
    } else {
      const res = await fetch('/api/mande/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programmeId, ...form }),
      })
      if (res.ok) {
        const created = await res.json()
        setMilestones((prev) => [...prev, created])
        toast({ title: 'Milestone added' })
        setOpen(false)
      } else {
        toast({ title: 'Failed to add milestone', variant: 'destructive' })
      }
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/mande/milestones/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setMilestones((prev) => prev.filter((m) => m.id !== id))
      toast({ title: 'Milestone deleted' })
    } else {
      toast({ title: 'Failed to delete', variant: 'destructive' })
    }
  }

  const displayed = filterStatus === 'All'
    ? milestones
    : milestones.filter((m) => m.status === filterStatus)

  const stats = STATUSES.reduce<Record<string, number>>(
    (acc, s) => { acc[s] = milestones.filter((m) => m.status === s).length; return acc },
    {}
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Milestones</h1>
          <p className="text-muted-foreground mt-1">Track programme milestones and delivery status</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" />
          Add Milestone
        </Button>
      </div>

      {/* Status filter pills */}
      {milestones.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterStatus('All')}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filterStatus === 'All' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'}`}
          >
            All ({milestones.length})
          </button>
          {STATUSES.map((s) => stats[s] > 0 && (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filterStatus === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'}`}
            >
              <span className={`h-2 w-2 rounded-full ${STATUS_CONFIG[s].dot}`} />
              {STATUS_CONFIG[s].label} ({stats[s]})
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : displayed.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12 gap-3">
            <Flag className="h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium text-muted-foreground">
              {milestones.length === 0 ? 'No milestones yet' : 'No milestones match filter'}
            </p>
            {milestones.length === 0 && <Button size="sm" onClick={openNew}>Add first milestone</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {displayed.map((m) => {
            const cfg = STATUS_CONFIG[m.status]
            const overdue = m.status !== 'Completed' && new Date(m.targetDate) < new Date()
            return (
              <Card key={m.id}>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-start gap-3">
                    <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${cfg.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{m.title}</span>
                        <Badge className={`text-xs py-0 ${cfg.color}`}>{cfg.label}</Badge>
                        {overdue && <Badge variant="destructive" className="text-xs py-0">Overdue</Badge>}
                        {m.cohort && <Badge variant="outline" className="text-xs py-0">{m.cohort.name}</Badge>}
                        {m.innovator && (
                          <Badge variant="outline" className="text-xs py-0">
                            {m.innovator.firstName} {m.innovator.lastName}
                          </Badge>
                        )}
                      </div>
                      {m.description && <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>}
                      <p className="text-xs text-muted-foreground mt-1">
                        Target: {formatDate(new Date(m.targetDate))}
                        {m.completedDate && ` · Completed: ${formatDate(new Date(m.completedDate))}`}
                      </p>
                      {m.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">{m.notes}</p>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(m)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(m.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Milestone' : 'Add Milestone'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Complete baseline assessments" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Optional details…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Target Date *</Label>
                <Input type="date" value={form.targetDate} onChange={(e) => setForm((p) => ({ ...p, targetDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v as MilestoneStatus }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Any notes on progress or blockers…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.title.trim() || !form.targetDate}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editing ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
