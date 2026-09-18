'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { Loader2, Plus } from 'lucide-react'

/**
 * Adding a fund.
 *
 * The funder is a name rather than a picker: funders are few and long-lived,
 * and an existing one is matched on the way in, so making the operator create
 * one first would be a step with no decision in it.
 *
 * The fee is entered as a percentage because that is how agreements are
 * written, and converted to a rate here. Storing 7.5 where 0.075 is meant would
 * invoice a funder for seven and a half times their own fund, so the conversion
 * happens once, at the edge, rather than being left to whoever reads it next.
 */
export function NewFundDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    funderName: '',
    name: '',
    reference: '',
    committedAmount: '',
    startDate: '',
    endDate: '',
    feePercent: '',
    feeBasis: '',
  })

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    setError('')
    const committed = Number(form.committedAmount.replace(/[\s,]/g, ''))
    if (!Number.isFinite(committed) || committed < 0) {
      setError('The committed amount has to be a number.')
      return
    }

    const percent = form.feePercent.trim()
    if (percent !== '' && !form.feeBasis) {
      setError('A fee needs a basis: is it charged on the commitment or on what goes out?')
      return
    }
    const rate = percent === '' ? null : Number(percent) / 100
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 1)) {
      setError('The fee percentage has to be between 0 and 100.')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/funds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          funderName: form.funderName.trim(),
          name: form.name.trim(),
          reference: form.reference.trim() || undefined,
          committedAmount: committed,
          startDate: form.startDate,
          endDate: form.endDate,
          status: 'Active',
          managementFeeRate: rate,
          managementFeeBasis: rate === null ? null : form.feeBasis,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Check the fields and try again.'
        )
      }
      toast({ title: 'Fund added' })
      setOpen(false)
      setForm({
        funderName: '', name: '', reference: '', committedAmount: '',
        startDate: '', endDate: '', feePercent: '', feeBasis: '',
      })
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Add a fund
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a fund</DialogTitle>
          <DialogDescription>
            Capital committed by a funder. Allocate it to programmes once it exists.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="funderName">Funder</Label>
            <Input
              id="funderName"
              placeholder="Technology Innovation Agency"
              value={form.funderName}
              onChange={(e) => set('funderName', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              An existing funder with this name is reused.
            </p>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="fundName">Fund name</Label>
            <Input
              id="fundName"
              placeholder="TIA Seed Fund 2026"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reference">Agreement number</Label>
            <Input
              id="reference"
              value={form.reference}
              onChange={(e) => set('reference', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="committed">Committed amount</Label>
            <Input
              id="committed"
              inputMode="decimal"
              className="text-right tabular-nums"
              placeholder="5000000"
              value={form.committedAmount}
              onChange={(e) => set('committedAmount', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="startDate">Starts</Label>
            <Input
              id="startDate"
              type="date"
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="endDate">Ends</Label>
            <Input
              id="endDate"
              type="date"
              value={form.endDate}
              onChange={(e) => set('endDate', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feePercent">Management fee</Label>
            <div className="flex items-center gap-2">
              <Input
                id="feePercent"
                inputMode="decimal"
                className="text-right tabular-nums"
                placeholder="7.5"
                value={form.feePercent}
                onChange={(e) => set('feePercent', e.target.value)}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <p className="text-xs text-muted-foreground">Leave blank if there is no fee.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feeBasis">Charged on</Label>
            <Select value={form.feeBasis} onValueChange={(v) => set('feeBasis', v)}>
              <SelectTrigger id="feeBasis">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Commitment">The commitment</SelectItem>
                <SelectItem value="Disbursement">What is disbursed</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              On commitment, the fee is earned whether or not money moves.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Add fund
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
