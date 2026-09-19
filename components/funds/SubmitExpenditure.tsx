'use client'

import { useState } from 'react'
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
import { Loader2, Plus, Paperclip } from 'lucide-react'
import { uploadExpenseProof, ProofUploadError } from '@/lib/upload-proof'

/**
 * Reporting what a grant was spent on.
 *
 * This is the participant's side of the grant, and until it existed the platform
 * could pay money out but had no way to record where it went - so every grant
 * read as entirely unaccounted for regardless of what had actually happened.
 *
 * The form asks for a supplier and a description rather than just an amount,
 * because those two fields are what a funder's own audit asks for, and
 * collecting them later means going back to the participant months after they
 * have forgotten.
 */

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'Personnel', label: 'Personnel' },
  { value: 'Operational', label: 'Operational' },
  { value: 'CapitalEquipment', label: 'Capital equipment' },
  { value: 'Consumables', label: 'Consumables' },
]

export interface TrancheOption {
  id: string
  label: string
}

export function SubmitExpenditure({
  grantId,
  tranches,
  disabledReason,
}: {
  grantId: string
  tranches: TrancheOption[]
  /** Set when reporting is not possible yet, and why. */
  disabledReason?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const [form, setForm] = useState({
    spentOn: '',
    supplier: '',
    description: '',
    amount: '',
    category: 'Operational',
    trancheId: '',
  })

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    setError('')
    const amount = Number(form.amount.replace(/[\s,]/g, ''))
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('The amount has to be more than zero.')
      return
    }
    if (!form.spentOn) {
      setError('When was the money spent?')
      return
    }
    if (form.spentOn > new Date().toISOString().slice(0, 10)) {
      setError('That date is in the future.')
      return
    }
    if (form.supplier.trim() === '' || form.description.trim() === '') {
      setError('A funder needs to know who was paid and what for.')
      return
    }

    setBusy(true)
    try {
      const res = await fetch(`/api/grants/${grantId}/expenditures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spentOn: form.spentOn,
          supplier: form.supplier.trim(),
          description: form.description.trim(),
          amount,
          category: form.category,
          trancheId: form.trancheId || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Check the fields and try again.'
        )
      }
      // The expense is saved at this point. A receipt that fails after this must
      // not read as a failed submission, because the expense is filed either way
      // and telling somebody it failed makes them submit it twice.
      let proofNote = ''
      if (file) {
        try {
          await uploadExpenseProof(grantId, body.id, file)
          proofNote = ' The receipt is attached.'
        } catch (err) {
          proofNote =
            err instanceof ProofUploadError
              ? ` The expense was saved, but the receipt did not attach: ${err.message}`
              : ' The expense was saved, but the receipt did not attach.'
        }
      }

      // Warnings are not refusals - the item was saved. Showing them matters
      // because they are what a reviewer is about to ask about.
      toast({
        title: 'Expense submitted',
        description:
          (Array.isArray(body.warnings) && body.warnings.length > 0
            ? body.warnings.join(' ')
            : 'It is now waiting for review.') + proofNote,
      })
      setOpen(false)
      setForm({
        spentOn: '', supplier: '', description: '', amount: '',
        category: 'Operational', trancheId: '',
      })
      setFile(null)
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
        <Button disabled={Boolean(disabledReason)} title={disabledReason}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Report an expense
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report an expense</DialogTitle>
          <DialogDescription>
            What you spent grant money on. A facilitator reviews it, and may come back to
            you if something is missing.
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
            <Label htmlFor="exp-date">Date of the expense</Label>
            <Input
              id="exp-date"
              type="date"
              value={form.spentOn}
              onChange={(e) => set('spentOn', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="exp-amount">Amount (ZAR)</Label>
            <Input
              id="exp-amount"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="exp-supplier">Who was paid</Label>
            <Input
              id="exp-supplier"
              value={form.supplier}
              onChange={(e) => set('supplier', e.target.value)}
              placeholder="The supplier or service provider"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="exp-description">What it was for</Label>
            <Textarea
              id="exp-description"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              placeholder="Enough detail that somebody who was not there understands the purchase."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="exp-category">Category</Label>
            <Select value={form.category} onValueChange={(v) => set('category', v)}>
              <SelectTrigger id="exp-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {tranches.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="exp-tranche">Paid from</Label>
              <Select value={form.trancheId} onValueChange={(v) => set('trancheId', v)}>
                <SelectTrigger id="exp-tranche">
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  {tranches.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <Label htmlFor="exp-proof" className="flex items-center gap-1.5">
            <Paperclip className="h-3.5 w-3.5" aria-hidden />
            Receipt or invoice
          </Label>
          <Input
            id="exp-proof"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">
            A PDF or a photo. Without one a reviewer is accepting your description on
            trust, and a funder&rsquo;s audit asks for the document.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Submit it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
