'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { Loader2, RefreshCw } from 'lucide-react'

export function RecalculateStipendButton({ stipendRecordId }: { stipendRecordId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleRecalculate() {
    setLoading(true)
    const res = await fetch('/api/stipends/recalculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stipendRecordId }),
    })
    setLoading(false)
    if (res.ok) {
      toast({ title: 'Stipend recalculated' })
      router.refresh()
    } else {
      toast({ title: 'Recalculation failed', variant: 'destructive' })
    }
  }

  return (
    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRecalculate} disabled={loading}>
      {loading
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : <RefreshCw className="h-3.5 w-3.5" />}
    </Button>
  )
}
