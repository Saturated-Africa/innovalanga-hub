'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'
import { Loader2, Upload, AlertTriangle, Info, Check } from 'lucide-react'

/**
 * Load a funder workbook.
 *
 * Two steps, and the first one writes nothing. These files are filled in by
 * hand across a year and arrive with the marks of that, so the operator sees
 * what the file yields and what is wrong with it before deciding to keep any
 * of it. Committing straight from an upload would mean discovering a problem
 * after it was already in the accounts.
 */

interface Problem {
  sheet: string
  row: number | null
  message: string
  severity: 'error' | 'warning'
}

interface DryRun {
  suggestedInstitutionName: string | null
  activityCount: number
  totals: {
    transactionCount: number
    transactionTotal: number
    budgetTotal: number
    uncategorised: number
  }
  project: { agreementNumber: string | null; reportingPeriod: string | null }
  problems: Problem[]
}

const money = (n: number) =>
  n.toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })

export function ImportClient({
  projects,
}: {
  projects: { id: string; institutionName: string }[]
}) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [dry, setDry] = useState<DryRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [institutionName, setInstitutionName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [periodLabel, setPeriodLabel] = useState('Q1')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  async function send(commit: boolean) {
    if (!file) return
    setError('')
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('commit', String(commit))
      if (commit) {
        fd.append('institutionName', institutionName)
        if (projectId) fd.append('projectId', projectId)
        fd.append('periodLabel', periodLabel)
        fd.append('periodStart', periodStart)
        fd.append('periodEnd', periodEnd)
        fd.append('startDate', startDate)
        fd.append('endDate', endDate)
      }
      const res = await fetch('/api/finance/import', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'The import failed.')

      if (commit) {
        toast({
          title: 'Workbook imported',
          description: `${data.activitiesCreated} activities created, ${data.activitiesUpdated} updated, ${data.transactionsCreated} transactions.`,
        })
        router.push(`/dashboard/finance/${data.projectId}`)
      } else {
        setDry(data)
        // Offered as a starting point only. The name that reaches the funder's
        // report is the one typed into the field below.
        if (!institutionName && data.suggestedInstitutionName) {
          setInstitutionName(data.suggestedInstitutionName)
        }
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const errors = dry?.problems.filter((p) => p.severity === 'error') ?? []
  const warnings = dry?.problems.filter((p) => p.severity === 'warning') ?? []
  const ready =
    dry !== null && institutionName.trim().length > 1 && periodStart && periodEnd && startDate && endDate

  return (
    <div className="space-y-6">
      {error && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="workbook">Funder workbook</Label>
            <Input
              id="workbook"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setDry(null)
              }}
            />
            <p className="text-xs text-muted-foreground">
              Nothing is saved until you review what the file contains.
            </p>
          </div>

          <Button onClick={() => send(false)} disabled={!file || busy}>
            {busy && !dry ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                Reading…
              </>
            ) : (
              <>
                <Upload className="mr-1.5 h-4 w-4" aria-hidden />
                Read the file
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {dry && (
        <>
          <Card>
            <CardContent className="pt-6">
              <p className="mb-4 text-sm font-medium">What this file contains</p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Figure label="Activities" value={String(dry.activityCount)} />
                <Figure label="Transactions" value={String(dry.totals.transactionCount)} />
                <Figure label="Spend" value={money(dry.totals.transactionTotal)} />
                <Figure label="Budget" value={money(dry.totals.budgetTotal)} />
              </div>
            </CardContent>
          </Card>

          {(errors.length > 0 || warnings.length > 0) && (
            <Card>
              <CardContent className="space-y-3 pt-6">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
                  {errors.length} row{errors.length !== 1 ? 's' : ''} skipped,{' '}
                  {warnings.length} thing{warnings.length !== 1 ? 's' : ''} to check
                </p>
                <div className="max-h-64 space-y-1.5 overflow-y-auto">
                  {[...errors, ...warnings].map((p, i) => (
                    <div key={i} className="flex gap-3 text-xs">
                      <Badge
                        variant={p.severity === 'error' ? 'destructive' : 'secondary'}
                        className="shrink-0"
                      >
                        {p.severity === 'error' ? 'skipped' : 'check'}
                      </Badge>
                      <span className="text-muted-foreground">
                        <span className="font-mono">
                          {p.sheet}
                          {p.row ? ` row ${p.row}` : ''}
                        </span>{' '}
                        {p.message}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-5 pt-6">
              <div className="space-y-2">
                <Label htmlFor="institutionName">Institution name</Label>
                <Input
                  id="institutionName"
                  value={institutionName}
                  onChange={(e) => setInstitutionName(e.target.value)}
                  placeholder="As it should appear on the funder's report"
                />
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  This is what appears at the top of the exported report. The file
                  suggests a name, but the stored value is whatever you type here.
                </p>
              </div>

              {projects.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="projectId">Load into</Label>
                  <select
                    id="projectId"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">A new project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.institutionName}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Loading into an existing project updates its plan in place and
                    replaces the transactions for this period, rather than adding a
                    second copy.
                  </p>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Project starts" id="startDate" value={startDate} onChange={setStartDate} />
                <Field label="Project ends" id="endDate" value={endDate} onChange={setEndDate} />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="periodLabel">Period</Label>
                  <Input
                    id="periodLabel"
                    value={periodLabel}
                    onChange={(e) => setPeriodLabel(e.target.value)}
                    placeholder="Q1"
                  />
                </div>
                <Field label="Period starts" id="periodStart" value={periodStart} onChange={setPeriodStart} />
                <Field label="Period ends" id="periodEnd" value={periodEnd} onChange={setPeriodEnd} />
              </div>

              <Button onClick={() => send(true)} disabled={!ready || busy}>
                {busy ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                    Importing…
                  </>
                ) : (
                  <>
                    <Check className="mr-1.5 h-4 w-4" aria-hidden />
                    Import {dry.totals.transactionCount} transactions
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function Field({
  label,
  id,
  value,
  onChange,
}: {
  label: string
  id: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
