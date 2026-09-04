'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Loader2, ChevronDown, ChevronUp, Save } from 'lucide-react'
import { REC_CONFIG, STATUS_CONFIG } from '@/lib/ip-engine'
import { IP_RECOMMENDATION_VARIANT, IP_STATUS, statusMeta } from '@/lib/status-colors'
import { useRouter } from 'next/navigation'

interface AssessmentSummary {
  innovatorId: string
  innovatorName: string
  businessName?: string | null
  cohortName: string
  primaryRec: string
  recommendations: string[]
  reasoning: string
  status: string
  advisorNotes?: string | null
  reviewedBy?: string | null
  completedAt: string
}

interface Props {
  assessment: AssessmentSummary
}

const STATUSES = ['NotAssessed', 'Assessed', 'ApplicationPending', 'Protected', 'Expired'] as const

export function IPAdvisorPanel({ assessment }: Props) {
  const { toast } = useToast()
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState(assessment.advisorNotes ?? '')
  const [status, setStatus] = useState(assessment.status)
  const [saving, setSaving] = useState(false)

  const recCfg = REC_CONFIG[assessment.primaryRec]
  const statusCfg = STATUS_CONFIG[assessment.status]

  async function handleSave() {
    setSaving(true)
    const res = await fetch(`/api/ip/${assessment.innovatorId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ advisorNotes: notes, status }),
    })
    setSaving(false)
    if (res.ok) {
      toast({ title: 'Notes saved' })
      router.refresh()
    } else {
      toast({ title: 'Failed to save', variant: 'destructive' })
    }
  }

  return (
    <div className="px-4 py-3">
      {/* Summary row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{assessment.innovatorName}</span>
            {assessment.businessName && (
              <span className="text-xs text-muted-foreground">· {assessment.businessName}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge size="sm" variant={IP_RECOMMENDATION_VARIANT[assessment.primaryRec] ?? 'muted'}>
              {recCfg?.label ?? assessment.primaryRec}
            </Badge>
            <Badge size="sm" variant={statusMeta(IP_STATUS, assessment.status).variant}>
              {statusCfg?.label ?? assessment.status}
            </Badge>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-4 space-y-4 border-t pt-4">
          {/* All recs */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">All protection types</p>
            <div className="flex flex-wrap gap-1.5">
              {assessment.recommendations.map((r) => (
                <Badge key={r} variant={IP_RECOMMENDATION_VARIANT[r] ?? 'muted'}>
                  {REC_CONFIG[r]?.label ?? r}
                </Badge>
              ))}
            </div>
          </div>

          {/* Reasoning */}
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs font-medium mb-1">System reasoning</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{assessment.reasoning}</p>
          </div>

          {/* Advisor controls */}
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-medium">Update IP Status</p>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_CONFIG[s]?.label ?? s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium">Advisor Notes</p>
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add guidance, referrals, or next steps for this innovator…"
                className="text-sm"
              />
            </div>
            {assessment.reviewedBy && (
              <p className="text-xs text-muted-foreground">Last reviewed by {assessment.reviewedBy}</p>
            )}
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Save className="h-3.5 w-3.5 mr-2" />}
              Save Notes
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
