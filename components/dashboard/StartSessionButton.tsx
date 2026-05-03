'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { Loader2, Play } from 'lucide-react'

export function StartSessionButton({ bookingId }: { bookingId: string }) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)

  async function handleStart() {
    setStarting(true)
    const res = await fetch(`/api/bookings/${bookingId}/start`, { method: 'POST' })
    setStarting(false)
    if (res.ok) {
      router.refresh()
    } else {
      const body = await res.json().catch(() => ({}))
      toast({ title: 'Could not start session', description: body.error ?? 'Please try again.', variant: 'destructive' })
    }
  }

  return (
    <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={handleStart} disabled={starting}>
      {starting
        ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Starting…</>
        : <><Play className="mr-1.5 h-3.5 w-3.5" />Start Session</>}
    </Button>
  )
}
