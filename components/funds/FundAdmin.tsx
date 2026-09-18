'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { Loader2 } from 'lucide-react'

/**
 * The two things done to a fund after it exists: recording money in, and
 * earmarking money for a programme.
 *
 * Side by side because they are the two halves of the same question. Allocating
 * more than has arrived is allowed and often correct, and seeing both at once
 * is what makes that a decision rather than an accident.
 */
export function FundAdmin({
  fundId,
  currency,
  uncommitted,
  programmes,
}: {
  fundId: string
  currency: string
  uncommitted: number
  programmes: { id: string; name: string; allocated: number }[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'receipt' | 'allocate' | null>(null)
  const [error, setError] = useState('')

  const [receipt, setReceipt] = useState({ amount: '', receivedOn: '', reference: '' })
  const [allocation, setAllocation] = useState({ programmeId: '', amount: '', note: '' })

  const chosen = programmes.find((p) => p.id === allocation.programmeId)

  async function post(action: 'receipt' | 'allocate', body: Record<string, unknown>) {
    setError('')
    setBusy(action)
    try {
      const res = await fetch(`/api/funds/${fundId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      })
      const parsed = await res.json()
      if (!res.ok) {
        throw new Error(
          typeof parsed.error === 'string' ? parsed.error : 'Check the fields and try again.'
        )
      }
      toast({ title: action === 'receipt' ? 'Receipt recorded' : 'Allocation saved' })
      if (action === 'receipt') setReceipt({ amount: '', receivedOn: '', reference: '' })
      else setAllocation({ programmeId: '', amount: '', note: '' })
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const num = (s: string) => Number(s.replace(/[\s,]/g, ''))

  return (
    <div className="space-y-3">
      {error && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Record money received</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              What the funder has actually transferred. A negative amount records a
              clawback.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="receiptAmount">Amount ({currency})</Label>
                <Input
                  id="receiptAmount"
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  value={receipt.amount}
                  onChange={(e) => setReceipt((r) => ({ ...r, amount: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="receiptDate">Received on</Label>
                <Input
                  id="receiptDate"
                  type="date"
                  value={receipt.receivedOn}
                  onChange={(e) => setReceipt((r) => ({ ...r, receivedOn: e.target.value }))}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="receiptRef">Bank reference</Label>
                <Input
                  id="receiptRef"
                  value={receipt.reference}
                  onChange={(e) => setReceipt((r) => ({ ...r, reference: e.target.value }))}
                />
              </div>
            </div>
            <Button
              size="sm"
              disabled={busy !== null || !receipt.amount || !receipt.receivedOn}
              onClick={() =>
                post('receipt', {
                  amount: num(receipt.amount),
                  receivedOn: receipt.receivedOn,
                  reference: receipt.reference || undefined,
                })
              }
            >
              {busy === 'receipt' && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              )}
              Record receipt
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Allocate to a programme</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {uncommitted >= 0
                ? `${fmt(uncommitted, currency)} of this fund is not yet allocated.`
                : `This fund is over-allocated by ${fmt(-uncommitted, currency)}.`}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="allocProgramme">Programme</Label>
                <Select
                  value={allocation.programmeId}
                  onValueChange={(v) =>
                    setAllocation((a) => ({
                      ...a,
                      programmeId: v,
                      // Pre-fill with what it already has, so an edit starts
                      // from the current figure rather than from nothing.
                      amount:
                        programmes.find((p) => p.id === v)?.allocated.toString() ?? a.amount,
                    }))
                  }
                >
                  <SelectTrigger id="allocProgramme">
                    <SelectValue placeholder="Select a programme" />
                  </SelectTrigger>
                  <SelectContent>
                    {programmes.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.allocated > 0 ? ` — ${fmt(p.allocated, currency)} now` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="allocAmount">Amount ({currency})</Label>
                <Input
                  id="allocAmount"
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  value={allocation.amount}
                  onChange={(e) => setAllocation((a) => ({ ...a, amount: e.target.value }))}
                />
                {chosen && chosen.allocated > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Replaces the current {fmt(chosen.allocated, currency)}.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="allocNote">Note</Label>
                <Input
                  id="allocNote"
                  value={allocation.note}
                  onChange={(e) => setAllocation((a) => ({ ...a, note: e.target.value }))}
                />
              </div>
            </div>
            <Button
              size="sm"
              disabled={busy !== null || !allocation.programmeId || allocation.amount === ''}
              onClick={() =>
                post('allocate', {
                  programmeId: allocation.programmeId,
                  amount: num(allocation.amount),
                  note: allocation.note || undefined,
                })
              }
            >
              {busy === 'allocate' && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              )}
              Save allocation
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function fmt(amount: number, currency: string): string {
  return amount.toLocaleString('en-ZA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  })
}
