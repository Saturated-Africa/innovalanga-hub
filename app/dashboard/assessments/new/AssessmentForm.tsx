'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getTRLLabel, getBRLLabel, getIRLLabel, getMRLLabel } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { Loader2 } from 'lucide-react'

interface Innovator {
  id: string
  firstName: string
  lastName: string
  businessName: string | null
  cohort: { programmeId: string }
}

interface ExistingAssessment {
  innovatorId: string
  period: string
  trlScore: number
  brlScore: number
  irlScore: number
  mrlScore: number | null
}

interface PeriodDef {
  key: string
  label: string
  order: number
}

interface AssessmentFormProps {
  innovators: Innovator[]
  existingAssessments: ExistingAssessment[]
  defaultInnovatorId?: string
  assessorName: string
}

const SCORE_COLORS: Record<string, string> = {
  TRL: 'blue',
  BRL: 'green',
  IRL: 'purple',
  MRL: 'orange',
}

function ScoreSelector({
  type,
  value,
  onChange,
  labelFn,
}: {
  type: string
  value: number
  onChange: (v: number) => void
  labelFn: (n: number) => string
}) {
  const color = SCORE_COLORS[type]
  const activeClass =
    color === 'blue'
      ? 'bg-blue-600 text-white'
      : color === 'green'
      ? 'bg-green-600 text-white'
      : color === 'purple'
      ? 'bg-purple-600 text-white'
      : 'bg-orange-500 text-white'

  return (
    <div>
      <Label className="text-sm font-semibold mb-2 block">
        {type} Score: {value}/9 — {labelFn(value)}
      </Label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex-1 h-10 rounded text-sm font-semibold transition-colors ${
              value === n ? activeClass : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

export function AssessmentForm({
  innovators,
  existingAssessments,
  defaultInnovatorId,
  assessorName,
}: AssessmentFormProps) {
  const router = useRouter()
  const [innovatorId, setInnovatorId] = useState(defaultInnovatorId ?? '')
  const [period, setPeriod] = useState('')
  const [periods, setPeriods] = useState<PeriodDef[]>([])
  const [trl, setTRL] = useState(1)
  const [brl, setBRL] = useState(1)
  const [irl, setIRL] = useState(1)
  const [mrl, setMRL] = useState(1)
  const [trlJustification, setTRLJustification] = useState('')
  const [brlJustification, setBRLJustification] = useState('')
  const [irlJustification, setIRLJustification] = useState('')
  const [mrlJustification, setMRLJustification] = useState('')
  const [dropJustification, setDropJustification] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [prevScores, setPrevScores] = useState<{
    trl: number; brl: number; irl: number; mrl: number | null
  } | null>(null)

  // Load periods when innovator changes
  useEffect(() => {
    if (!innovatorId) { setPeriods([]); return }
    const innovator = innovators.find((i) => i.id === innovatorId)
    if (!innovator) return
    fetch(`/api/programmes/${innovator.cohort.programmeId}/periods`)
      .then((r) => r.json())
      .then((data: PeriodDef[]) => setPeriods(data))
      .catch(() => {})
  }, [innovatorId, innovators])

  // Compute previous scores for drop validation
  useEffect(() => {
    if (!innovatorId || !period || periods.length === 0) { setPrevScores(null); return }
    const periodIdx = periods.findIndex((p) => p.key === period)
    if (periodIdx <= 0) { setPrevScores(null); return }
    const prevKey = periods[periodIdx - 1].key
    const prev = existingAssessments.find(
      (a) => a.innovatorId === innovatorId && a.period === prevKey
    )
    setPrevScores(
      prev
        ? { trl: prev.trlScore, brl: prev.brlScore, irl: prev.irlScore, mrl: prev.mrlScore }
        : null
    )
  }, [innovatorId, period, periods, existingAssessments])

  const takenPeriods = existingAssessments
    .filter((a) => a.innovatorId === innovatorId)
    .map((a) => a.period)

  const needsDropJustification =
    prevScores !== null &&
    (
      trl < prevScores.trl - 2 ||
      brl < prevScores.brl - 2 ||
      irl < prevScores.irl - 2 ||
      (prevScores.mrl != null && mrl < prevScores.mrl - 2)
    )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!innovatorId || !period) {
      setError('Select an innovator and period.')
      return
    }
    if (takenPeriods.includes(period)) {
      setError('An assessment for this period already exists and cannot be duplicated.')
      return
    }
    if (needsDropJustification && !dropJustification.trim()) {
      setError('A written justification is required when a score drops more than 2 points.')
      return
    }

    setSubmitting(true)
    const res = await fetch('/api/assessments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        innovatorId,
        period,
        trlScore: trl,
        brlScore: brl,
        irlScore: irl,
        mrlScore: mrl,
        trlJustification,
        brlJustification,
        irlJustification,
        mrlJustification,
        dropJustification: needsDropJustification ? dropJustification : undefined,
        assessedBy: assessorName,
      }),
    })

    setSubmitting(false)

    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'Failed to save assessment.')
      return
    }

    toast({ title: 'Assessment saved', description: 'Scores have been recorded and locked.' })
    router.push(`/dashboard/innovators/${innovatorId}`)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select Innovator &amp; Period</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Innovator</Label>
            <Select value={innovatorId} onValueChange={(v) => { setInnovatorId(v); setPeriod('') }}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Choose an innovator…" />
              </SelectTrigger>
              <SelectContent>
                {innovators.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.firstName} {i.lastName}{i.businessName ? ` — ${i.businessName}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Assessment Period</Label>
            <Select value={period} onValueChange={setPeriod} disabled={!innovatorId || periods.length === 0}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={innovatorId ? 'Choose a period…' : 'Select an innovator first'} />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.key} value={p.key} disabled={takenPeriods.includes(p.key)}>
                    {p.label} {takenPeriods.includes(p.key) ? '(already recorded)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* TRL */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">TRL — Technology Readiness Level</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ScoreSelector type="TRL" value={trl} onChange={setTRL} labelFn={getTRLLabel} />
          {prevScores && trl < prevScores.trl - 2 && (
            <p className="text-sm text-destructive font-medium">
              Score drops {prevScores.trl - trl} points from previous ({prevScores.trl}). Justification required below.
            </p>
          )}
          <div>
            <Label>Justification</Label>
            <Textarea
              className="mt-1"
              placeholder="Describe the evidence for this TRL score…"
              value={trlJustification}
              onChange={(e) => setTRLJustification(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* BRL */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">BRL — Business Readiness Level</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ScoreSelector type="BRL" value={brl} onChange={setBRL} labelFn={getBRLLabel} />
          {prevScores && brl < prevScores.brl - 2 && (
            <p className="text-sm text-destructive font-medium">
              Score drops {prevScores.brl - brl} points from previous ({prevScores.brl}). Justification required below.
            </p>
          )}
          <div>
            <Label>Justification</Label>
            <Textarea
              className="mt-1"
              placeholder="Describe the evidence for this BRL score…"
              value={brlJustification}
              onChange={(e) => setBRLJustification(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* IRL */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">IRL — Innovation Readiness Level</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ScoreSelector type="IRL" value={irl} onChange={setIRL} labelFn={getIRLLabel} />
          {prevScores && irl < prevScores.irl - 2 && (
            <p className="text-sm text-destructive font-medium">
              Score drops {prevScores.irl - irl} points from previous ({prevScores.irl}). Justification required below.
            </p>
          )}
          <div>
            <Label>Justification</Label>
            <Textarea
              className="mt-1"
              placeholder="Describe the evidence for this IRL score…"
              value={irlJustification}
              onChange={(e) => setIRLJustification(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* MRL */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">MRL — Market Readiness Level</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ScoreSelector type="MRL" value={mrl} onChange={setMRL} labelFn={getMRLLabel} />
          {prevScores && prevScores.mrl != null && mrl < prevScores.mrl - 2 && (
            <p className="text-sm text-destructive font-medium">
              Score drops {prevScores.mrl - mrl} points from previous ({prevScores.mrl}). Justification required below.
            </p>
          )}
          <div>
            <Label>Justification</Label>
            <Textarea
              className="mt-1"
              placeholder="Describe the evidence for this MRL score…"
              value={mrlJustification}
              onChange={(e) => setMRLJustification(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {needsDropJustification && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Drop Justification Required</CardTitle>
          </CardHeader>
          <CardContent>
            <Label>Why did one or more scores decrease by more than 2 points?</Label>
            <Textarea
              className="mt-1"
              placeholder="Explain the reason for the significant score decrease…"
              value={dropJustification}
              onChange={(e) => setDropJustification(e.target.value)}
              rows={4}
              required
            />
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
          ) : (
            'Save & Lock Assessment'
          )}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
