'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { Loader2, Clock, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

interface SessionTimerProps {
  bookingId: string
  actualStart: string   // ISO UTC
  scheduledEnd: string  // ISO UTC
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function SessionTimer({ bookingId, actualStart, scheduledEnd }: SessionTimerProps) {
  const router = useRouter()
  const [now, setNow] = useState(Date.now())
  const [ending, setEnding] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const elapsed = now - new Date(actualStart).getTime()
  const scheduledEndMs = new Date(scheduledEnd).getTime()
  const overtime = now > scheduledEndMs

  const handleEnd = useCallback(async () => {
    setEnding(true)
    const res = await fetch(`/api/bookings/${bookingId}/complete`, { method: 'POST' })
    setEnding(false)
    if (res.ok) {
      setDone(true)
      router.refresh()
    } else {
      const body = await res.json().catch(() => ({}))
      toast({ title: 'Failed to end session', description: body.error ?? 'Please try again.', variant: 'destructive' })
    }
  }, [bookingId, router])

  if (done) {
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-1.5 text-green-600 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4" />
          Session ended
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/mentorship">Add session notes →</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className={`flex items-center gap-1.5 text-sm font-mono font-semibold ${overtime ? 'text-red-600' : 'text-green-600'}`}>
        <Clock className="h-4 w-4" />
        {formatElapsed(elapsed)}
        {overtime && <span className="text-xs font-sans font-medium text-red-500 ml-1">overtime</span>}
      </div>
      <Button
        size="sm"
        variant="destructive"
        onClick={handleEnd}
        disabled={ending}
      >
        {ending ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Ending…</> : 'End Session'}
      </Button>
    </div>
  )
}
