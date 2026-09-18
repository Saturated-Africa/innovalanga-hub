'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { Loader2, Plus, Trash2 } from 'lucide-react'

/**
 * The figures the funder's workbook asks for that no bank line supplies.
 *
 * Everything here is optional on the way in and saved together on the way out.
 * A quarter is assembled over weeks - the transfer lands before the bank
 * statement closes, and the approver signs last - so a form that refused to
 * save until it was complete would simply not be used.
 */

export interface IncomeLine {
  label: string
  budget: string
  actual: string
}

export interface ReconciliationValues {
  amountTransferred: string
  fundingBudgeted: string
  balanceBroughtForward: string
  bankBalance: string
  invoiceNumber: string
  preparedByName: string
  preparedOn: string
  approvedByName: string
  approvedOn: string
  incomeLines: IncomeLine[]
}

/** Empty stays empty. A blank figure is "not yet known", which is not zero. */
function toNumber(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed.replace(/[\s,]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function PeriodReconciliation({
  periodId,
  locked,
  initial,
}: {
  periodId: string
  locked: boolean
  initial: ReconciliationValues
}) {
  const router = useRouter()
  const [values, setValues] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (key: keyof ReconciliationValues, value: string) =>
    setValues((v) => ({ ...v, [key]: value }))

  const setLine = (index: number, key: keyof IncomeLine, value: string) =>
    setValues((v) => ({
      ...v,
      incomeLines: v.incomeLines.map((l, i) => (i === index ? { ...l, [key]: value } : l)),
    }))

  async function save() {
    setError('')
    setBusy(true)
    try {
      const lines = values.incomeLines
        .filter((l) => l.label.trim() !== '')
        .map((l) => ({
          label: l.label.trim(),
          budget: toNumber(l.budget) ?? 0,
          actual: toNumber(l.actual) ?? 0,
        }))

      const res = await fetch(`/api/finance/periods/${periodId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountTransferred: toNumber(values.amountTransferred),
          fundingBudgeted: toNumber(values.fundingBudgeted),
          balanceBroughtForward: toNumber(values.balanceBroughtForward),
          bankBalance: toNumber(values.bankBalance),
          invoiceNumber: values.invoiceNumber.trim() || null,
          preparedByName: values.preparedByName.trim() || null,
          preparedOn: values.preparedOn || null,
          approvedByName: values.approvedByName.trim() || null,
          approvedOn: values.approvedOn || null,
          incomeLines: lines,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not save.')

      toast({ title: 'Saved', description: 'The workbook will export with these figures.' })
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bank and cash reconciliation</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Money
            id="amountTransferred"
            label="Amount transferred by the funder"
            hint="What actually landed in the account this quarter."
            value={values.amountTransferred}
            onChange={(v) => set('amountTransferred', v)}
            disabled={locked}
          />
          <Money
            id="fundingBudgeted"
            label="Funding budgeted for the quarter"
            hint="What the agreement said would come. Reported separately from the transfer."
            value={values.fundingBudgeted}
            onChange={(v) => set('fundingBudgeted', v)}
            disabled={locked}
          />
          <Money
            id="balanceBroughtForward"
            label="Balance brought forward"
            hint="The surplus or deficit carried from the previous quarter."
            value={values.balanceBroughtForward}
            onChange={(v) => set('balanceBroughtForward', v)}
            disabled={locked}
          />
          <Money
            id="bankBalance"
            label="Closing bank and cash balance"
            hint="As it reads on the bank statement at the end of the period."
            value={values.bankBalance}
            onChange={(v) => set('bankBalance', v)}
            disabled={locked}
          />
          <div className="space-y-2">
            <Label htmlFor="invoiceNumber">Invoice number</Label>
            <Input
              id="invoiceNumber"
              value={values.invoiceNumber}
              onChange={(e) => set('invoiceNumber', e.target.value)}
              disabled={locked}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Other income</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="max-w-prose text-sm text-muted-foreground">
            Interest, refunds and anything else that came in that is not the funder&rsquo;s
            transfer. The sheet gives four rows and its totals are fixed to them, so four
            is the limit.
          </p>

          {values.incomeLines.map((line, index) => (
            <div key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <Input
                aria-label={`Income line ${index + 1} description`}
                placeholder="Interest"
                value={line.label}
                onChange={(e) => setLine(index, 'label', e.target.value)}
                disabled={locked}
              />
              <Input
                aria-label={`Income line ${index + 1} budget`}
                placeholder="Budget"
                inputMode="decimal"
                className="text-right tabular-nums"
                value={line.budget}
                onChange={(e) => setLine(index, 'budget', e.target.value)}
                disabled={locked}
              />
              <Input
                aria-label={`Income line ${index + 1} actual`}
                placeholder="Actual"
                inputMode="decimal"
                className="text-right tabular-nums"
                value={line.actual}
                onChange={(e) => setLine(index, 'actual', e.target.value)}
                disabled={locked}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={locked}
                aria-label={`Remove income line ${index + 1}`}
                onClick={() =>
                  setValues((v) => ({
                    ...v,
                    incomeLines: v.incomeLines.filter((_, i) => i !== index),
                  }))
                }
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ))}

          {values.incomeLines.length < 4 && !locked && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setValues((v) => ({
                  ...v,
                  incomeLines: [...v.incomeLines, { label: '', budget: '', actual: '' }],
                }))
              }
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Add a line
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Declaration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="max-w-prose text-sm text-muted-foreground">
            The funder prints a declaration at the foot of the quarterly sheet. Until
            these are filled in, the exported file carries whatever the template was last
            saved with.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="preparedByName">Prepared by</Label>
              <Input
                id="preparedByName"
                value={values.preparedByName}
                onChange={(e) => set('preparedByName', e.target.value)}
                disabled={locked}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="preparedOn">Date prepared</Label>
              <Input
                id="preparedOn"
                type="date"
                value={values.preparedOn}
                onChange={(e) => set('preparedOn', e.target.value)}
                disabled={locked}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="approvedByName">Approved by</Label>
              <Input
                id="approvedByName"
                value={values.approvedByName}
                onChange={(e) => set('approvedByName', e.target.value)}
                disabled={locked}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="approvedOn">Date approved</Label>
              <Input
                id="approvedOn"
                type="date"
                value={values.approvedOn}
                onChange={(e) => set('approvedOn', e.target.value)}
                disabled={locked}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {!locked && (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Save figures
          </Button>
          <span className="text-xs text-muted-foreground">
            Saved figures appear on the next export. Nothing is stored as a file.
          </span>
        </div>
      )}
    </div>
  )
}

function Money({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  id: string
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        placeholder="Not recorded"
        className="text-right tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}
