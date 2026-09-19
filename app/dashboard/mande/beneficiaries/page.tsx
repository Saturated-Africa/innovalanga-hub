'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Plus, Trash2, Users } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { differences, type DerivedTally } from '@/lib/beneficiary-tally'

interface BeneficiaryCount {
  id: string
  periodLabel: string
  periodStart: string
  periodEnd: string
  direct: number
  indirect: number
  female: number
  youth: number
  pwd: number
  notes?: string | null
  recordedBy: string
  /**
   * Needed to scope the derived comparison.
   *
   * `include` returns the whole row, so this is already in the response - it was
   * simply not declared here. Without it a cohort-specific reported row would be
   * compared against every form in the programme, which is a difference this code
   * invented rather than one worth investigating.
   */
  cohortId?: string | null
  cohort?: { name: string } | null
}

const EMPTY_FORM = {
  periodLabel: '',
  periodStart: '',
  periodEnd: '',
  direct: '',
  indirect: '',
  female: '',
  youth: '',
  pwd: '',
  notes: '',
}

export default function BeneficiariesPage() {
  const { toast } = useToast()
  const [programmeId, setProgrammeId] = useState<string | null>(null)
  const [counts, setCounts] = useState<BeneficiaryCount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/programmes/me')
      if (!res.ok) return
      const { programmeId: pid } = await res.json()
      setProgrammeId(pid)
      await fetchCounts(pid)
    }
    load()
  }, [])

  /**
   * What the accepted forms say for each reported period.
   *
   * Shown beside the reported figures rather than replacing them. A reported row
   * is a number somebody has already given a funder with their name against it;
   * rewriting one from a derivation would mean disagreeing with a submitted
   * report and nobody knowing which figure moved. Where the two differ there is
   * usually a real story - forms captured after the report went out being the
   * common one - and a person is the right thing to read it.
   */
  const [derived, setDerived] = useState<Record<string, DerivedTally>>({})

  async function fetchDerived(rows: BeneficiaryCount[]) {
    const entries = await Promise.all(
      rows.map(async (c) => {
        try {
          const params = new URLSearchParams({
            start: c.periodStart.slice(0, 10),
            end: c.periodEnd.slice(0, 10),
          })
          if (c.cohortId) params.set('cohortId', c.cohortId)
          const res = await fetch(`/api/mande/beneficiaries/derived?${params}`)
          if (!res.ok) return null
          return [c.id, (await res.json()) as DerivedTally] as const
        } catch {
          // A tally that cannot be fetched simply is not shown. It is a
          // comparison, not the record.
          return null
        }
      })
    )
    setDerived(Object.fromEntries(entries.filter(Boolean) as [string, DerivedTally][]))
  }

  async function fetchCounts(pid: string) {
    setLoading(true)
    const res = await fetch('/api/mande/beneficiaries')
    if (res.ok) {
      const rows = (await res.json()) as BeneficiaryCount[]
      setCounts(rows)
      // Fetched after the reported rows, and not awaited by them: the comparison
      // is useful but the reported figures are the record, and a slow tally must
      // not hold them back.
      void fetchDerived(rows)
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!programmeId) return
    setSaving(true)
    const res = await fetch('/api/mande/beneficiaries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        programmeId,
        periodLabel: form.periodLabel,
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        direct: Number(form.direct) || 0,
        indirect: Number(form.indirect) || 0,
        female: Number(form.female) || 0,
        youth: Number(form.youth) || 0,
        pwd: Number(form.pwd) || 0,
        notes: form.notes || undefined,
      }),
    })
    setSaving(false)
    if (res.ok) {
      toast({ title: 'Beneficiary count saved' })
      setOpen(false)
      setForm(EMPTY_FORM)
      await fetchCounts(programmeId)
    } else {
      toast({ title: 'Failed to save', variant: 'destructive' })
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/mande/beneficiaries?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      setCounts((prev) => prev.filter((c) => c.id !== id))
      toast({ title: 'Record deleted' })
    } else {
      toast({ title: 'Failed to delete', variant: 'destructive' })
    }
  }

  const totals = counts.reduce(
    (acc, c) => ({
      direct: acc.direct + c.direct,
      indirect: acc.indirect + c.indirect,
      female: acc.female + c.female,
      youth: acc.youth + c.youth,
      pwd: acc.pwd + c.pwd,
    }),
    { direct: 0, indirect: 0, female: 0, youth: 0, pwd: 0 }
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Beneficiary Counts"
        description="Track direct and indirect beneficiaries by reporting period"
        actions={
          <>
        <Button onClick={() => { setForm(EMPTY_FORM); setOpen(true) }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Period
        </Button>
          </>
        }
      />

      {/* Cumulative summary */}
      {counts.length > 0 && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Total Direct', value: totals.direct, color: 'text-info' },
            { label: 'Total Indirect', value: totals.indirect, color: 'text-indigo-600' },
            { label: 'Female', value: totals.female, color: 'text-pink-600' },
            { label: 'Youth (<35)', value: totals.youth, color: 'text-success' },
            { label: 'PWD', value: totals.pwd, color: 'text-warning' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className={`text-2xl font-bold mt-0.5 ${kpi.color}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : counts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12 gap-3">
            <Users className="h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium text-muted-foreground">No beneficiary data yet</p>
            <Button size="sm" onClick={() => setOpen(true)}>Add first period</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {counts.map((c) => (
            <Card key={c.id}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{c.periodLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(new Date(c.periodStart))} – {formatDate(new Date(c.periodEnd))}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive shrink-0" onClick={() => handleDelete(c.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-5 gap-3">
                  {[
                    { label: 'Direct', value: c.direct, color: 'text-info' },
                    { label: 'Indirect', value: c.indirect, color: 'text-indigo-600' },
                    { label: 'Female', value: c.female, color: 'text-pink-600' },
                    { label: 'Youth', value: c.youth, color: 'text-success' },
                    { label: 'PWD', value: c.pwd, color: 'text-warning' },
                  ].map((stat) => (
                    <div key={stat.label} className="text-center">
                      <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  ))}
                </div>
                {derived[c.id] && (
                  <div className="mt-3 border-t pt-2">
                    <p className="text-xs font-medium">From the accepted forms</p>
                    <div className="mt-1 grid grid-cols-5 gap-3">
                      {[
                        { label: 'Direct', value: derived[c.id].direct },
                        { label: 'Indirect', value: null },
                        { label: 'Female', value: derived[c.id].female },
                        { label: 'Youth', value: derived[c.id].youth },
                        { label: 'PWD', value: derived[c.id].pwd },
                      ].map((stat) => (
                        <div key={stat.label} className="text-center">
                          <p className="text-sm font-semibold tabular-nums">
                            {stat.value === null ? '—' : stat.value}
                          </p>
                          <p className="text-xs text-muted-foreground">{stat.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Indirect is not derivable: it is a judgement about people
                        reached without being enrolled, and no record exists to
                        count. A dash says so; a zero would have looked like an
                        answer. */}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Indirect reach cannot be derived from forms.
                      {derived[c.id].ageUnknown > 0 && (
                        <>
                          {' '}
                          Youth covers {derived[c.id].ageKnown} of{' '}
                          {derived[c.id].direct} forms; {derived[c.id].ageUnknown} have no
                          date of birth captured.
                        </>
                      )}
                    </p>

                    {differences(
                      { direct: c.direct, female: c.female, youth: c.youth, pwd: c.pwd },
                      derived[c.id]
                    ).length > 0 && (
                      <p className="mt-1 text-xs text-warning">
                        Differs from what was reported:{' '}
                        {differences(
                          { direct: c.direct, female: c.female, youth: c.youth, pwd: c.pwd },
                          derived[c.id]
                        )
                          .map(
                            (d) =>
                              `${d.field} ${d.delta > 0 ? '+' : ''}${d.delta}`
                          )
                          .join(', ')}
                        . Worth a look rather than a correction — forms captured after a
                        report went out produce exactly this.
                      </p>
                    )}
                  </div>
                )}

                {c.notes && <p className="text-xs text-muted-foreground mt-2 border-t pt-2">{c.notes}</p>}
                <p className="text-xs text-muted-foreground mt-1">Recorded by {c.recordedBy}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Beneficiary Count</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Period Label *</Label>
              <Input value={form.periodLabel} onChange={(e) => setForm((p) => ({ ...p, periodLabel: e.target.value }))} placeholder="e.g. Q2 2025, Month 6" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Period Start *</Label>
                <Input type="date" value={form.periodStart} onChange={(e) => setForm((p) => ({ ...p, periodStart: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Period End *</Label>
                <Input type="date" value={form.periodEnd} onChange={(e) => setForm((p) => ({ ...p, periodEnd: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Direct</Label>
                <Input type="number" min="0" value={form.direct} onChange={(e) => setForm((p) => ({ ...p, direct: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Indirect</Label>
                <Input type="number" min="0" value={form.indirect} onChange={(e) => setForm((p) => ({ ...p, indirect: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Female</Label>
                <Input type="number" min="0" value={form.female} onChange={(e) => setForm((p) => ({ ...p, female: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Youth</Label>
                <Input type="number" min="0" value={form.youth} onChange={(e) => setForm((p) => ({ ...p, youth: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>PWD</Label>
                <Input type="number" min="0" value={form.pwd} onChange={(e) => setForm((p) => ({ ...p, pwd: e.target.value }))} placeholder="0" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.periodLabel || !form.periodStart || !form.periodEnd}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
