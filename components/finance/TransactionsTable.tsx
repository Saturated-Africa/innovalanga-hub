'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'
import { Loader2, Search, Wand2 } from 'lucide-react'
import { ProofCell, type ProofSummary } from './ProofCell'

/**
 * Transactions, with the coding that turns them into a report.
 *
 * Three things make a quarter's worth of bank lines tractable rather than
 * tedious, and all three matter more than they look:
 *
 *   - Selecting many rows and coding them in one action. Most transactions in a
 *     quarter belong to a handful of activities.
 *   - Selecting everything that matches a search. Bank descriptions repeat, so
 *     "Google" or "Fuel Purchase" usually picks out exactly one activity's worth
 *     of spend in a single gesture.
 *   - Showing what is left. The count of uncoded rows is the only number that
 *     says whether this quarter is ready to export.
 *
 * The table is deliberately not paginated below the filter: an operator working
 * through coding wants to see the effect of a filter on everything at once.
 */

export interface TransactionRow {
  id: string
  spentOn: string
  supplier: string
  description: string
  amount: number
  costCategory: string
  activityId: string | null
  activityCode: string | null
  proofs: ProofSummary[]
}

export interface ActivityOption {
  id: string
  code: string
  details: string
  costCategory: string
}

const CATEGORY_LABEL: Record<string, string> = {
  Personnel: 'Personnel',
  Operational: 'Operational',
  CapitalEquipment: 'Capital equipment',
  Consumables: 'Consumables',
}

const money = (n: number) =>
  n.toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })

export function TransactionsTable({
  projectId,
  transactions,
  activities,
}: {
  projectId: string
  transactions: TransactionRow[]
  activities: ActivityOption[]
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkActivity, setBulkActivity] = useState('')
  const [busy, setBusy] = useState(false)
  const [onlyUncoded, setOnlyUncoded] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return transactions.filter((t) => {
      if (onlyUncoded && t.activityId) return false
      if (!q) return true
      return (
        t.supplier.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      )
    })
  }, [transactions, search, onlyUncoded])

  const uncodedCount = transactions.filter((t) => !t.activityId).length
  const selectedTotal = transactions
    .filter((t) => selected.has(t.id))
    .reduce((sum, t) => sum + t.amount, 0)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function code(ids: string[], activityId: string | null) {
    if (ids.length === 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/finance/transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionIds: ids, activityId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not save that.')
      toast({
        title: activityId
          ? `${data.updated} transaction${data.updated === 1 ? '' : 's'} coded`
          : `${data.updated} cleared`,
      })
      setSelected(new Set())
      router.refresh()
    } catch (err) {
      toast({
        title: 'Coding failed',
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search supplier or description…"
            aria-label="Search transactions"
            className="pl-9"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyUncoded}
            onChange={(e) => setOnlyUncoded(e.target.checked)}
            className="h-4 w-4 accent-brand-volt-deep"
          />
          Only uncoded
        </label>

        <span className="text-sm text-muted-foreground">
          {filtered.length} shown · {uncodedCount} uncoded
        </span>
      </div>

      {/* Selecting everything a search matched is the gesture that makes this
          quick: bank descriptions repeat, so one search usually isolates one
          activity's spend. */}
      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelected(new Set(filtered.map((t) => t.id)))}
            disabled={busy}
          >
            <Wand2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Select all {filtered.length} shown
          </Button>
          {selected.size > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-volt-deep/30 bg-brand-volt/10 px-4 py-3">
          <span className="text-sm font-medium">
            {selected.size} selected · {money(selectedTotal)}
          </span>
          <select
            value={bulkActivity}
            onChange={(e) => setBulkActivity(e.target.value)}
            aria-label="Activity to code the selected transactions to"
            className="flex h-9 min-w-[18rem] flex-1 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Choose an activity…</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.details.slice(0, 60)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={busy || !bulkActivity}
            onClick={() => code([...selected], bulkActivity)}
          >
            {busy ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              'Code these'
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => code([...selected], null)}
          >
            Clear coding
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-b border-border bg-muted/60">
            <tr>
              <th scope="col" className="w-10 px-3 py-2.5" />
              {['Date', 'Supplier', 'Description', 'Category', 'Activity', 'Proof', 'Amount'].map(
                (h) => (
                  <th
                    key={h}
                    scope="col"
                    className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((t) => (
              <tr
                key={t.id}
                className={selected.has(t.id) ? 'bg-brand-volt/10' : 'hover:bg-muted/40'}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                    aria-label={`Select ${t.supplier}`}
                    className="h-4 w-4 accent-brand-volt-deep"
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-2">{t.spentOn}</td>
                <td className="max-w-[14rem] truncate px-4 py-2">{t.supplier}</td>
                <td className="max-w-[14rem] truncate px-4 py-2 text-muted-foreground">
                  {t.description}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-xs">
                  {CATEGORY_LABEL[t.costCategory] ?? t.costCategory}
                </td>
                <td className="px-4 py-2">
                  <select
                    value={t.activityId ?? ''}
                    onChange={(e) => code([t.id], e.target.value || null)}
                    disabled={busy}
                    aria-label={`Activity for ${t.supplier}`}
                    className={`h-8 max-w-[11rem] rounded-md border bg-background px-2 text-xs ${
                      t.activityId ? 'border-input' : 'border-warning/50 text-warning'
                    }`}
                  >
                    <option value="">not coded</option>
                    {activities.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <ProofCell
                    projectId={projectId}
                    transactionId={t.id}
                    proofs={t.proofs}
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                  {money(t.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {onlyUncoded && uncodedCount === 0
            ? 'Everything is coded.'
            : 'Nothing matches that search.'}
        </p>
      )}

      {uncodedCount === 0 && transactions.length > 0 && (
        <Badge variant="default">
          All {transactions.length} transactions are coded to an activity
        </Badge>
      )}
    </div>
  )
}
