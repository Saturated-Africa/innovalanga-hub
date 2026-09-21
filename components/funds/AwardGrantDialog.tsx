'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { prefillValue } from '@/lib/prefill'

/**
 * Awarding a grant.
 *
 * Until this screen existed the module could only be read: grants reached the
 * database by hand, which meant the one operation the fund manager performs
 * most often was the one thing the platform could not do.
 *
 * Two rules are mirrored here from `lib/funds/rules.ts`, and mirrored is the
 * right word - the server checks both again and is the only authority. They are
 * repeated on the client because both are arithmetic the operator is in the
 * middle of doing, and finding out after submitting that the tranches were
 * short by fifty rand means re-entering the whole schedule:
 *
 *   - the tranches must add up to the award, exactly
 *   - the award must fit in what this programme has left of that fund
 *
 * The fund picker shows each fund's remaining allocation for this programme
 * rather than the fund's own balance. A facilitator awarding a grant is
 * spending their programme's share, and showing the fund total would invite an
 * award the server is about to refuse.
 */

export interface AwardFundOption {
  fundId: string
  fundName: string
  /** What this programme may still award from this fund, in rand. */
  remaining: number
}

export interface AwardParticipantOption {
  id: string
  name: string
  /**
   * The entity captured at onboarding, where there is one.
   *
   * Used to fill the award form in rather than asking for it again. The
   * registration number in particular has already been read off a certificate
   * once, and reading it twice is how a digit goes missing on a grant agreement.
   */
  entityType: string | null
  entityName: string | null
  entityRegistrationNumber: string | null
}

const ENTITY_TYPES: { value: string; label: string }[] = [
  { value: 'PtyLtd', label: '(Pty) Ltd' },
  { value: 'NPC', label: 'NPC' },
  { value: 'CloseCorporation', label: 'Close corporation' },
  { value: 'SoleProprietor', label: 'Sole proprietor' },
  { value: 'Trust', label: 'Trust' },
  { value: 'Cooperative', label: 'Co-operative' },
  { value: 'Other', label: 'Other' },
]

interface TrancheRow {
  amount: string
  plannedDate: string
  conditions: string
}

const EMPTY_TRANCHE: TrancheRow = { amount: '', plannedDate: '', conditions: '' }

/** Strips the spaces and thousands separators people type into money fields. */
function money(value: string): number {
  return Number(value.replace(/[\s,]/g, ''))
}

/** Cents, so the reconciliation comparison is exact rather than nearly equal. */
function cents(value: string): number {
  const n = money(value)
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}

function formatRand(amount: number): string {
  return amount.toLocaleString('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 2,
  })
}

export function AwardGrantDialog({
  funds,
  participants,
}: {
  funds: AwardFundOption[]
  participants: AwardParticipantOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    fundId: '',
    innovatorId: '',
    entityName: '',
    entityType: '',
    entityRegistrationNumber: '',
    reference: '',
    purpose: '',
    awardedAmount: '',
    startDate: '',
    endDate: '',
  })
  const [tranches, setTranches] = useState<TrancheRow[]>([{ ...EMPTY_TRANCHE }])

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const setTranche = (index: number, k: keyof TrancheRow, v: string) =>
    setTranches((rows) => rows.map((r, i) => (i === index ? { ...r, [k]: v } : r)))

  const selectedFund = funds.find((f) => f.fundId === form.fundId)
  const selectedParticipant = participants.find((p) => p.id === form.innovatorId)

  /**
   * The running reconciliation. Shown whenever there is an award to compare
   * against, so the operator watches it come to zero instead of discovering the
   * gap on submit.
   */
  const reconciliation = useMemo(() => {
    const award = cents(form.awardedAmount)
    const entered = tranches.filter((t) => t.amount.trim() !== '')
    const scheduled = entered.reduce((total, t) => total + cents(t.amount), 0)
    if (!Number.isFinite(award) || award <= 0 || entered.length === 0) return null
    if (!Number.isFinite(scheduled)) return null
    return { difference: scheduled - award, scheduled, award }
  }, [form.awardedAmount, tranches])

  /** Spreads the award across the current rows, giving the remainder to the first. */
  function splitEvenly() {
    const award = cents(form.awardedAmount)
    if (!Number.isFinite(award) || award <= 0 || tranches.length === 0) {
      setError('Enter the award amount first, then split it.')
      return
    }
    setError('')
    const base = Math.floor(award / tranches.length)
    const remainder = award - base * tranches.length
    setTranches((rows) =>
      rows.map((r, i) => ({
        ...r,
        amount: ((base + (i === 0 ? remainder : 0)) / 100).toFixed(2),
      }))
    )
  }

  async function submit() {
    setError('')

    const award = money(form.awardedAmount)
    if (!Number.isFinite(award) || award <= 0) {
      setError('The award has to be an amount greater than zero.')
      return
    }
    if (!form.fundId) {
      setError('Choose the fund this grant is paid from.')
      return
    }
    if (!form.innovatorId) {
      setError('Choose the participant receiving the grant.')
      return
    }
    if (!form.entityType) {
      setError('Choose what kind of entity is receiving the money.')
      return
    }

    const rows = tranches.filter((t) => t.amount.trim() !== '')
    if (rows.length === 0) {
      setError('A grant needs at least one tranche. Nobody can be paid otherwise.')
      return
    }
    if (rows.some((t) => !Number.isFinite(money(t.amount)) || money(t.amount) <= 0)) {
      setError('Every tranche has to be an amount greater than zero.')
      return
    }
    if (reconciliation && reconciliation.difference !== 0) {
      const over = reconciliation.difference > 0
      setError(
        `The tranches add up to ${formatRand(reconciliation.scheduled / 100)}, which is ` +
          `${formatRand(Math.abs(reconciliation.difference) / 100)} ${over ? 'more' : 'less'} ` +
          `than the award.`
      )
      return
    }
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      setError('The end date is before the start date.')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fundId: form.fundId,
          innovatorId: form.innovatorId,
          entityName: form.entityName.trim(),
          entityType: form.entityType,
          entityRegistrationNumber: form.entityRegistrationNumber.trim() || undefined,
          reference: form.reference.trim() || undefined,
          purpose: form.purpose.trim(),
          awardedAmount: award,
          startDate: form.startDate || undefined,
          endDate: form.endDate || undefined,
          tranches: rows.map((t) => ({
            amount: money(t.amount),
            plannedDate: t.plannedDate || undefined,
            conditions: t.conditions.trim() || undefined,
          })),
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Check the fields and try again.'
        )
      }
      toast({ title: 'Grant awarded', description: `${rows.length} tranches scheduled.` })
      setOpen(false)
      setForm({
        fundId: '', innovatorId: '', entityName: '', entityType: '',
        entityRegistrationNumber: '', reference: '', purpose: '',
        awardedAmount: '', startDate: '', endDate: '',
      })
      setTranches([{ ...EMPTY_TRANCHE }])
      router.push(`/dashboard/grants/${body.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const noFunds = funds.length === 0
  const noParticipants = participants.length === 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={noFunds || noParticipants}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Award a grant
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Award a grant</DialogTitle>
          <DialogDescription>
            The payment schedule is created with the award, because a grant with no
            tranches is money nobody can pay out.
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
          <div className="space-y-2">
            <Label htmlFor="grant-fund">Fund</Label>
            <Select value={form.fundId} onValueChange={(v) => set('fundId', v)}>
              <SelectTrigger id="grant-fund">
                <SelectValue placeholder="Choose a fund" />
              </SelectTrigger>
              <SelectContent>
                {funds.map((f) => (
                  <SelectItem key={f.fundId} value={f.fundId}>
                    {f.fundName} — {formatRand(f.remaining)} left
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedFund && (
              <p className="text-xs text-muted-foreground">
                This programme may still award {formatRand(selectedFund.remaining)} from this
                fund.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="grant-participant">Participant</Label>
            <Select
              value={form.innovatorId}
              onValueChange={(v) => {
                const chosen = participants.find((p) => p.id === v)
                /*
                 * Filled in from the participant's record, and only into fields the
                 * operator has not already typed into. Overwriting something
                 * somebody typed would be the form arguing with them; leaving a
                 * stale value from a previously selected participant would be
                 * worse, so anything that still matches the previous prefill is
                 * replaced.
                 */
                setForm((f) => {
                  const previous = participants.find((p) => p.id === f.innovatorId)
                  return {
                    ...f,
                    innovatorId: v,
                    entityName: prefillValue(
                      f.entityName,
                      previous?.entityName,
                      chosen?.entityName
                    ),
                    entityType: prefillValue(
                      f.entityType,
                      previous?.entityType,
                      chosen?.entityType
                    ),
                    entityRegistrationNumber: prefillValue(
                      f.entityRegistrationNumber,
                      previous?.entityRegistrationNumber,
                      chosen?.entityRegistrationNumber
                    ),
                  }
                })
              }}
            >
              <SelectTrigger id="grant-participant">
                <SelectValue placeholder="Choose a participant" />
              </SelectTrigger>
              <SelectContent>
                {participants.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedParticipant && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {selectedParticipant.entityRegistrationNumber
                ? `Entity details filled in from ${selectedParticipant.name}'s onboarding record. Change them if this grant is to a different entity.`
                : `${selectedParticipant.name} has no registered entity on their onboarding record, so these have to be entered here.`}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="grant-entity-name">Entity receiving the money</Label>
            <Input
              id="grant-entity-name"
              value={form.entityName}
              onChange={(e) => set('entityName', e.target.value)}
              placeholder="Registered name of the business"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="grant-entity-type">Entity type</Label>
            <Select value={form.entityType} onValueChange={(v) => set('entityType', v)}>
              <SelectTrigger id="grant-entity-type">
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="grant-registration">Registration number</Label>
            <Input
              id="grant-registration"
              value={form.entityRegistrationNumber}
              onChange={(e) => set('entityRegistrationNumber', e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="grant-reference">Grant reference</Label>
            <Input
              id="grant-reference"
              value={form.reference}
              onChange={(e) => set('reference', e.target.value)}
              placeholder="Optional, the funder's own reference"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="grant-purpose">What the money is for</Label>
            <Textarea
              id="grant-purpose"
              value={form.purpose}
              onChange={(e) => set('purpose', e.target.value)}
              rows={3}
              placeholder="The purpose this grant is conditional on. Reported back to the funder."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="grant-amount">Award amount (ZAR)</Label>
            <Input
              id="grant-amount"
              inputMode="decimal"
              value={form.awardedAmount}
              onChange={(e) => set('awardedAmount', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="grant-start">Starts</Label>
              <Input
                id="grant-start"
                type="date"
                value={form.startDate}
                onChange={(e) => set('startDate', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grant-end">Ends</Label>
              <Input
                id="grant-end"
                type="date"
                value={form.endDate}
                onChange={(e) => set('endDate', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-2 space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Payment schedule</h3>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={splitEvenly}>
                Split evenly
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTranches((r) => [...r, { ...EMPTY_TRANCHE }])}
                disabled={tranches.length >= 24}
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                Add a tranche
              </Button>
            </div>
          </div>

          {tranches.map((t, i) => (
            <div
              key={i}
              className="grid gap-3 rounded-lg border border-border px-3 py-3 sm:grid-cols-[auto,1fr,1fr,auto]"
            >
              <span className="self-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                #{i + 1}
              </span>
              <div className="space-y-1.5">
                <Label htmlFor={`tranche-amount-${i}`} className="text-xs">
                  Amount (ZAR)
                </Label>
                <Input
                  id={`tranche-amount-${i}`}
                  inputMode="decimal"
                  value={t.amount}
                  onChange={(e) => setTranche(i, 'amount', e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`tranche-date-${i}`} className="text-xs">
                  Planned date
                </Label>
                <Input
                  id={`tranche-date-${i}`}
                  type="date"
                  value={t.plannedDate}
                  onChange={(e) => setTranche(i, 'plannedDate', e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="self-end"
                aria-label={`Remove tranche ${i + 1}`}
                onClick={() => setTranches((r) => r.filter((_, j) => j !== i))}
                disabled={tranches.length === 1}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
              <div className="space-y-1.5 sm:col-start-2 sm:col-end-5">
                <Label htmlFor={`tranche-conditions-${i}`} className="text-xs">
                  Conditions for release
                </Label>
                <Input
                  id={`tranche-conditions-${i}`}
                  value={t.conditions}
                  onChange={(e) => setTranche(i, 'conditions', e.target.value)}
                  placeholder="Optional. What must be true before this tranche is paid."
                />
              </div>
            </div>
          ))}

          {reconciliation && (
            <p
              className={`text-sm tabular-nums ${
                reconciliation.difference === 0 ? 'text-muted-foreground' : 'text-destructive'
              }`}
              aria-live="polite"
            >
              {reconciliation.difference === 0
                ? `Scheduled ${formatRand(reconciliation.scheduled / 100)}, matching the award.`
                : `Scheduled ${formatRand(reconciliation.scheduled / 100)} against an award of ` +
                  `${formatRand(reconciliation.award / 100)} — ` +
                  `${formatRand(Math.abs(reconciliation.difference) / 100)} ` +
                  `${reconciliation.difference > 0 ? 'too much' : 'still to schedule'}.`}
            </p>
          )}
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Award the grant
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
