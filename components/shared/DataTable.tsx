'use client'

import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  SearchX,
  Inbox,
} from 'lucide-react'

interface Column<T> {
  key: keyof T | string
  label: string
  render?: (row: T) => React.ReactNode
  sortable?: boolean
  /** Right-align numeric columns. */
  align?: 'left' | 'right'
  /** Value used for sorting and CSV when `render` returns a node. */
  value?: (row: T) => string | number | null | undefined
}

interface DataTableProps<T extends Record<string, unknown>> {
  data: T[]
  columns: Column<T>[]
  searchKeys?: (keyof T)[]
  pageSize?: number
  csvFilename?: string
  /** Shown when the dataset itself is empty (as opposed to filtered to zero). */
  emptyMessage?: string
}

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  searchKeys = [],
  pageSize = 10,
  csvFilename,
  emptyMessage = 'Nothing here yet.',
}: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  /** Cell value for sorting/export — `value` wins, else the raw field. */
  function cellValue(row: T, col: Column<T>): unknown {
    return col.value ? col.value(row) : row[col.key as keyof T]
  }

  const filtered = useMemo(() => {
    if (!search) return data
    const q = search.toLowerCase()
    return data.filter((row) =>
      searchKeys.some((key) => String(row[key] ?? '').toLowerCase().includes(q))
    )
  }, [data, search, searchKeys])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const col = columns.find((c) => String(c.key) === sortKey)
    return [...filtered].sort((a, b) => {
      const av = col ? cellValue(a, col) : a[sortKey as keyof T]
      const bv = col ? cellValue(b, col) : b[sortKey as keyof T]

      // Numeric columns (readiness scores, hours, amounts) must not sort as
      // text — "10" sorting before "9" was the previous behaviour.
      const an = typeof av === 'number' ? av : Number(av)
      const bn = typeof bv === 'number' ? bv : Number(bv)
      if (av !== null && av !== '' && bv !== null && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn)) {
        return sortDir === 'asc' ? an - bn : bn - an
      }

      const as = String(av ?? '')
      const bs = String(bv ?? '')
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, columns])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginated = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(1)
  }

  function downloadCSV() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const headers = columns.map((c) => esc(c.label)).join(',')
    const rows = sorted.map((row) => columns.map((c) => esc(cellValue(row, c))).join(','))
    const csv = [headers, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = csvFilename ?? 'export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const isFiltered = search.length > 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            placeholder="Search…"
            aria-label="Search table"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="pl-9"
          />
        </div>
        {csvFilename && (
          <Button variant="outline" size="sm" onClick={downloadCSV}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            Export CSV
          </Button>
        )}
        <span className="ml-auto text-sm tabular-nums text-muted-foreground">
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Wide tables (the innovators list carries nine columns) must scroll
          rather than overflow the viewport on small screens. */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="border-b border-border bg-muted/60">
            <tr>
              {columns.map((col) => {
                const key = String(col.key)
                const active = sortKey === key
                return (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={
                      active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                    className={cn(
                      'whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                      col.align === 'right' ? 'text-right' : 'text-left',
                      col.sortable && 'cursor-pointer select-none hover:text-foreground'
                    )}
                    onClick={() => col.sortable && handleSort(key)}
                  >
                    <span
                      className={cn(
                        'inline-flex items-center gap-1',
                        col.align === 'right' && 'flex-row-reverse'
                      )}
                    >
                      {col.label}
                      {col.sortable &&
                        (active ? (
                          sortDir === 'asc' ? (
                            <ChevronUp className="h-3.5 w-3.5 text-foreground" aria-hidden />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-foreground" aria-hidden />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" aria-hidden />
                        ))}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12">
                  {/* Distinguish "filtered to nothing" from "no data at all" —
                      previously both showed "No results found." */}
                  <div className="flex flex-col items-center gap-2 text-center">
                    {isFiltered ? (
                      <>
                        <SearchX className="h-5 w-5 text-muted-foreground" aria-hidden />
                        <p className="text-sm text-muted-foreground">
                          No results for “{search}”.
                        </p>
                        <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
                          Clear search
                        </Button>
                      </>
                    ) : (
                      <>
                        <Inbox className="h-5 w-5 text-muted-foreground" aria-hidden />
                        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              paginated.map((row, i) => (
                <tr key={i} className="transition-colors hover:bg-muted/40">
                  {columns.map((col) => (
                    <td
                      key={String(col.key)}
                      className={cn(
                        'px-4 py-2.5 align-middle',
                        col.align === 'right' && 'text-right tabular-nums'
                      )}
                    >
                      {col.render ? col.render(row) : String(row[col.key as keyof T] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm tabular-nums text-muted-foreground">
            Page {safePage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label="Previous page"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Next page"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
