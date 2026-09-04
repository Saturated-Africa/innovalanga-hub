'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Save } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'

const FIELDS = [
  { key: 'problem', label: 'Problem Statement', desc: 'What problem does this programme address?' },
  { key: 'vision', label: 'Vision / Goal', desc: 'What is the ultimate change we want to see?' },
  { key: 'inputs', label: 'Inputs', desc: 'Resources invested — funding, staff, equipment, partnerships' },
  { key: 'activities', label: 'Activities', desc: 'What actions does the programme carry out?' },
  { key: 'outputs', label: 'Outputs', desc: 'Direct, tangible results of the activities' },
  { key: 'outcomes', label: 'Outcomes', desc: 'Short to medium-term changes resulting from outputs' },
  { key: 'impact', label: 'Impact', desc: 'Long-term, sustainable change attributable to the programme' },
  { key: 'assumptions', label: 'Assumptions & Risks', desc: 'Conditions that must hold for the ToC to work' },
] as const

type ToCData = {
  [K in typeof FIELDS[number]['key']]?: string
}

export default function TheoryOfChangePage() {
  const { toast } = useToast()
  const [programmeId, setProgrammeId] = useState<string | null>(null)
  const [data, setData] = useState<ToCData>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      const meRes = await fetch('/api/programmes/me')
      if (!meRes.ok) return
      const { programmeId: pid } = await meRes.json()
      setProgrammeId(pid)

      const tocRes = await fetch('/api/mande/toc')
      if (tocRes.ok) {
        const toc = await tocRes.json()
        if (toc) setData(toc)
      }
      setLoading(false)
    }
    load()
  }, [])

  async function handleSave() {
    if (!programmeId) return
    setSaving(true)
    const res = await fetch('/api/mande/toc', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programmeId, ...data }),
    })
    setSaving(false)
    if (res.ok) {
      toast({ title: 'Theory of Change saved' })
    } else {
      toast({ title: 'Failed to save', variant: 'destructive' })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Theory of Change"
        description="Define the causal pathway from inputs to impact"
        actions={
          <>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save
        </Button>
          </>
        }
      />

      <div className="space-y-4">
        {FIELDS.map(({ key, label, desc }) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{label}</CardTitle>
              <CardDescription className="text-xs">{desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder={`Describe ${label.toLowerCase()}…`}
                rows={4}
                value={data[key] ?? ''}
                onChange={(e) => setData((prev) => ({ ...prev, [key]: e.target.value }))}
                className="resize-none"
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save Theory of Change
        </Button>
      </div>
    </div>
  )
}
