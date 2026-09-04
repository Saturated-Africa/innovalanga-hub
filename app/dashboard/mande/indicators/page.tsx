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
import { Loader2, Plus, Pencil, Trash2, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react'
import { INDICATOR_TYPE_VARIANT } from '@/lib/status-colors'
import { PageHeader } from '@/components/shared/PageHeader'

type IndicatorType = 'Output' | 'Outcome' | 'Impact' | 'Process'
type Frequency = 'Monthly' | 'Quarterly' | 'SemiAnnual' | 'Annual'

interface IndicatorRecord {
  id: string
  periodLabel: string
  periodStart: string
  periodEnd: string
  value: number
  notes?: string | null
  recordedBy: string
}

interface Indicator {
  id: string
  name: string
  description?: string | null
  type: IndicatorType
  unit: string
  baseline?: number | null
  target: number
  frequency: Frequency
  active: boolean
  records: IndicatorRecord[]
  _count: { records: number }
}

const EMPTY_FORM = {
  name: '',
  description: '',
  type: 'Output' as IndicatorType,
  unit: 'number',
  baseline: '',
  target: '',
  frequency: 'Quarterly' as Frequency,
}

const EMPTY_RECORD = {
  periodLabel: '',
  periodStart: '',
  periodEnd: '',
  value: '',
  notes: '',
}

export default function IndicatorsPage() {
  const { toast } = useToast()
  const [programmeId, setProgrammeId] = useState<string | null>(null)
  const [indicators, setIndicators] = useState<Indicator[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [recordOpen, setRecordOpen] = useState(false)
  const [activeIndicator, setActiveIndicator] = useState<Indicator | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [recordForm, setRecordForm] = useState(EMPTY_RECORD)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/programmes/me')
      if (!res.ok) return
      const { programmeId: pid } = await res.json()
      setProgrammeId(pid)
      await fetchIndicators(pid)
    }
    load()
  }, [])

  async function fetchIndicators(pid: string) {
    setLoading(true)
    const res = await fetch('/api/mande/indicators')
    if (res.ok) setIndicators(await res.json())
    setLoading(false)
  }

  async function handleSave() {
    if (!programmeId) return
    setSaving(true)
    const payload = {
      programmeId,
      name: form.name,
      description: form.description || undefined,
      type: form.type,
      unit: form.unit,
      baseline: form.baseline !== '' ? Number(form.baseline) : null,
      target: Number(form.target),
      frequency: form.frequency,
    }
    const res = await fetch('/api/mande/indicators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    if (res.ok) {
      toast({ title: 'Indicator created' })
      setOpen(false)
      setForm(EMPTY_FORM)
      await fetchIndicators(programmeId)
    } else {
      toast({ title: 'Failed to create indicator', variant: 'destructive' })
    }
  }

  async function handleToggleActive(ind: Indicator) {
    const res = await fetch(`/api/mande/indicators/${ind.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !ind.active }),
    })
    if (res.ok) {
      setIndicators((prev) => prev.map((i) => i.id === ind.id ? { ...i, active: !i.active } : i))
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/mande/indicators/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setIndicators((prev) => prev.filter((i) => i.id !== id))
      toast({ title: 'Indicator deleted' })
    } else {
      toast({ title: 'Failed to delete', variant: 'destructive' })
    }
  }

  function openRecord(ind: Indicator) {
    setActiveIndicator(ind)
    setRecordForm(EMPTY_RECORD)
    setRecordOpen(true)
  }

  async function handleSaveRecord() {
    if (!activeIndicator) return
    setSaving(true)
    const res = await fetch(`/api/mande/indicators/${activeIndicator.id}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        periodLabel: recordForm.periodLabel,
        periodStart: recordForm.periodStart,
        periodEnd: recordForm.periodEnd,
        value: Number(recordForm.value),
        notes: recordForm.notes || undefined,
      }),
    })
    setSaving(false)
    if (res.ok) {
      toast({ title: 'Data point recorded' })
      setRecordOpen(false)
      if (programmeId) await fetchIndicators(programmeId)
    } else {
      toast({ title: 'Failed to record data', variant: 'destructive' })
    }
  }

  async function handleDeleteRecord(indicatorId: string, recordId: string) {
    const res = await fetch(`/api/mande/indicators/${indicatorId}/records?recordId=${recordId}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      setIndicators((prev) =>
        prev.map((i) =>
          i.id === indicatorId
            ? { ...i, records: i.records.filter((r) => r.id !== recordId), _count: { records: i._count.records - 1 } }
            : i
        )
      )
      toast({ title: 'Record deleted' })
    } else {
      toast({ title: 'Failed to delete record', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indicators"
        description="Track programme indicators and record periodic data"
        actions={
          <>
        <Button onClick={() => { setForm(EMPTY_FORM); setOpen(true) }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Indicator
        </Button>
          </>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : indicators.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12 gap-3">
            <TrendingUp className="h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium text-muted-foreground">No indicators yet</p>
            <Button size="sm" onClick={() => setOpen(true)}>Add your first indicator</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {indicators.map((ind) => {
            const latest = ind.records[0]
            const pct = latest && ind.target > 0
              ? Math.min(100, Math.round((latest.value / ind.target) * 100))
              : null
            const isExpanded = expandedId === ind.id

            return (
              <Card key={ind.id} className={ind.active ? '' : 'opacity-60'}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{ind.name}</span>
                        <Badge size="sm" variant={INDICATOR_TYPE_VARIANT[ind.type] ?? 'muted'}>{ind.type}</Badge>
                        <Badge variant="outline" className="text-xs py-0">{ind.frequency}</Badge>
                        {!ind.active && <Badge variant="secondary" className="text-xs py-0">Inactive</Badge>}
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        {ind.baseline != null && <span>Baseline: {ind.baseline} {ind.unit}</span>}
                        <span>Target: {ind.target} {ind.unit}</span>
                        {latest && <span>Latest: {latest.value} {ind.unit} ({latest.periodLabel})</span>}
                      </div>
                      {pct !== null && (
                        <div className="mt-2">
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden w-full max-w-xs">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{pct}% of target</p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => openRecord(ind)}>
                        <Plus className="h-3 w-3 mr-1" /> Record
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpandedId(isExpanded ? null : ind.id)}>
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleToggleActive(ind)} title={ind.active ? 'Deactivate' : 'Activate'}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(ind.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && ind.records.length > 0 && (
                    <div className="mt-3 border-t pt-3">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Data history</p>
                      <div className="space-y-1.5">
                        {ind.records.map((r) => (
                          <div key={r.id} className="flex items-center justify-between text-xs">
                            <span className="font-medium">{r.periodLabel}</span>
                            <span>{r.value} {ind.unit}</span>
                            <span className="text-muted-foreground">{r.recordedBy}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteRecord(ind.id, r.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Add indicator dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Indicator</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Number of innovators assessed" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v as IndicatorType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(['Output', 'Outcome', 'Impact', 'Process'] as const).map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={(v) => setForm((p) => ({ ...p, frequency: v as Frequency }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                    <SelectItem value="Quarterly">Quarterly</SelectItem>
                    <SelectItem value="SemiAnnual">Semi-Annual</SelectItem>
                    <SelectItem value="Annual">Annual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Input value={form.unit} onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))} placeholder="number, %, ZAR" />
              </div>
              <div className="space-y-1.5">
                <Label>Baseline</Label>
                <Input type="number" value={form.baseline} onChange={(e) => setForm((p) => ({ ...p, baseline: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Target *</Label>
                <Input type="number" value={form.target} onChange={(e) => setForm((p) => ({ ...p, target: e.target.value }))} placeholder="100" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Optional description…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim() || !form.target}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record data dialog */}
      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Data — {activeIndicator?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Period Label *</Label>
              <Input value={recordForm.periodLabel} onChange={(e) => setRecordForm((p) => ({ ...p, periodLabel: e.target.value }))} placeholder="e.g. Q1 2025, Month 3" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Period Start *</Label>
                <Input type="date" value={recordForm.periodStart} onChange={(e) => setRecordForm((p) => ({ ...p, periodStart: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Period End *</Label>
                <Input type="date" value={recordForm.periodEnd} onChange={(e) => setRecordForm((p) => ({ ...p, periodEnd: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Value ({activeIndicator?.unit}) *</Label>
              <Input type="number" value={recordForm.value} onChange={(e) => setRecordForm((p) => ({ ...p, value: e.target.value }))} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={recordForm.notes} onChange={(e) => setRecordForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional notes…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSaveRecord}
              disabled={saving || !recordForm.periodLabel || !recordForm.periodStart || !recordForm.periodEnd || !recordForm.value}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
