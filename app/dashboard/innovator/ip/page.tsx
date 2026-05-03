'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { Loader2, ShieldCheck, ChevronRight, ChevronLeft, RotateCcw } from 'lucide-react'
import { IP_QUESTIONS, REC_CONFIG, STATUS_CONFIG, type Answers } from '@/lib/ip-engine'

interface IPAssessment {
  id: string
  recommendations: string[]
  primaryRec: string
  reasoning: string
  status: string
  advisorNotes?: string | null
  reviewedBy?: string | null
  reviewedAt?: string | null
  completedAt: string
}

export default function InnovatorIPPage() {
  const { toast } = useToast()
  const [innovatorId, setInnovatorId] = useState<string | null>(null)
  const [assessment, setAssessment] = useState<IPAssessment | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const [started, setStarted] = useState(false)

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/innovator/me')
      if (!res.ok) return
      const { id } = await res.json()
      setInnovatorId(id)

      const aRes = await fetch(`/api/ip/${id}`)
      if (aRes.ok) {
        const data = await aRes.json()
        setAssessment(data)
      }
      setLoading(false)
    }
    load()
  }, [])

  function handleAnswer(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }

  function next() {
    if (step < IP_QUESTIONS.length - 1) setStep((s) => s + 1)
  }

  function back() {
    if (step > 0) setStep((s) => s - 1)
  }

  async function handleSubmit() {
    if (!innovatorId) return
    setSubmitting(true)
    const res = await fetch(`/api/ip/${innovatorId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    })
    setSubmitting(false)
    if (res.ok) {
      const data = await res.json()
      setAssessment(data)
      setStarted(false)
      toast({ title: 'IP assessment complete' })
    } else {
      toast({ title: 'Submission failed', variant: 'destructive' })
    }
  }

  function startRetake() {
    setAnswers({})
    setStep(0)
    setStarted(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const current = IP_QUESTIONS[step]
  const answered = Object.keys(answers).length
  const allAnswered = answered === IP_QUESTIONS.length
  const currentAnswered = answers[current?.id] !== undefined

  // Show result
  if (assessment && !started) {
    const cfg = REC_CONFIG[assessment.primaryRec]
    const statusCfg = STATUS_CONFIG[assessment.status]
    return (
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold">IP Protection Assessment</h1>
          <p className="text-muted-foreground mt-1">Your intellectual property protection recommendation</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg">{cfg?.label ?? assessment.primaryRec}</CardTitle>
                <CardDescription className="mt-1">{cfg?.description}</CardDescription>
              </div>
              <Badge className={`${cfg?.color} shrink-0`}>{cfg?.label}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* All recommendation types */}
            {assessment.recommendations.length > 1 && (
              <div>
                <p className="text-sm font-medium mb-2">All applicable protection types:</p>
                <div className="flex flex-wrap gap-2">
                  {assessment.recommendations.map((r) => (
                    <Badge key={r} className={REC_CONFIG[r]?.color ?? 'bg-gray-100'}>
                      {REC_CONFIG[r]?.label ?? r}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Reasoning */}
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-sm font-medium mb-1">Why this recommendation</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{assessment.reasoning}</p>
            </div>

            {/* Status */}
            <div className="flex items-center justify-between border-t pt-4">
              <div>
                <p className="text-xs text-muted-foreground">IP Status</p>
                <Badge className={statusCfg?.color} variant="outline">
                  {statusCfg?.label ?? assessment.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Assessed {new Date(assessment.completedAt).toLocaleDateString('en-ZA')}
              </p>
            </div>

            {/* Advisor notes */}
            {assessment.advisorNotes && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="text-sm font-medium text-blue-900 mb-1">Advisor Notes</p>
                <p className="text-sm text-blue-800">{assessment.advisorNotes}</p>
                {assessment.reviewedBy && (
                  <p className="text-xs text-blue-600 mt-2">— {assessment.reviewedBy}</p>
                )}
              </div>
            )}

            <Button variant="outline" size="sm" onClick={startRetake}>
              <RotateCcw className="h-3.5 w-3.5 mr-2" />
              Retake assessment
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Questionnaire — intro screen
  if (!started) {
    return (
      <div className="space-y-6 max-w-lg">
        <div>
          <h1 className="text-2xl font-bold">IP Protection Assessment</h1>
          <p className="text-muted-foreground mt-1">Understand what intellectual property protection applies to your innovation</p>
        </div>

        <Card>
          <CardContent className="pt-6 pb-6 flex flex-col items-center gap-5 text-center">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-lg">IP Questionnaire</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Answer {IP_QUESTIONS.length} short questions about your innovation. Our engine will
                identify which IP protection types apply and explain why.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full text-left text-sm">
              {['Patent', 'Trademark', 'Copyright', 'Trade Secret'].map((t) => (
                <div key={t} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  {t}
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={() => setStarted(true)}>
              Start assessment
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Questionnaire — question screen
  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold">IP Protection Assessment</h1>
        <p className="text-muted-foreground mt-1">Question {step + 1} of {IP_QUESTIONS.length}</p>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${((step + 1) / IP_QUESTIONS.length) * 100}%` }}
        />
      </div>

      <Card>
        <CardContent className="pt-6 space-y-5">
          <div>
            <p className="font-semibold text-base leading-snug">{current.text}</p>
            {current.hint && (
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{current.hint}</p>
            )}
          </div>

          {current.type === 'yesno' && (
            <div className="grid grid-cols-2 gap-3">
              {(['yes', 'no'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => handleAnswer(current.id, v)}
                  className={`rounded-lg border-2 py-3 text-sm font-medium transition-colors ${
                    answers[current.id] === v
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  {v === 'yes' ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          )}

          {current.type === 'select' && current.options && (
            <div className="space-y-2">
              {current.options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleAnswer(current.id, opt.value)}
                  className={`w-full text-left rounded-lg border-2 px-4 py-3 text-sm transition-colors ${
                    answers[current.id] === opt.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between gap-3">
        <Button variant="outline" onClick={back} disabled={step === 0}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>

        {step < IP_QUESTIONS.length - 1 ? (
          <Button onClick={next} disabled={!currentAnswered}>
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={!allAnswered || submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
            Get My Result
          </Button>
        )}
      </div>
    </div>
  )
}
