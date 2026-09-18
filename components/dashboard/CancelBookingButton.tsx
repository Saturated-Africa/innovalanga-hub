'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { Loader2, CalendarX } from 'lucide-react'

/**
 * Cancel an upcoming booking.
 *
 * My Sessions previously had no action of any kind on an upcoming booking,
 * while the booking page told innovators to "complete or cancel it before
 * booking again" and linked them here. With one confirmed booking and no
 * control to release it, an innovator could never book again through the UI.
 *
 * The API allows an innovator to cancel only up to two hours before the start.
 * That window is mirrored here so the button is not offered when the server
 * would refuse it, and the reason is stated rather than left to a failed
 * request.
 */
const CANCEL_CUTOFF_MS = 2 * 60 * 60 * 1000

export function CancelBookingButton({
  bookingId,
  scheduledStart,
}: {
  bookingId: string
  /** ISO string - Server Components cannot hand a Date to a Client Component. */
  scheduledStart: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const startsAt = new Date(scheduledStart).getTime()
  const withinCutoff = Date.now() > startsAt - CANCEL_CUTOFF_MS

  if (withinCutoff) {
    return (
      <p className="text-xs text-muted-foreground">
        Too late to cancel online. Contact your facilitator.
      </p>
    )
  }

  async function handleCancel() {
    setCancelling(true)
    const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cancelledBy: 'innovator',
        cancelReason: reason.trim() || undefined,
      }),
    })
    setCancelling(false)

    if (res.ok) {
      setOpen(false)
      setReason('')
      toast({
        title: 'Session cancelled',
        description: 'You can book a new session now.',
      })
      router.refresh()
    } else {
      const body = await res.json().catch(() => ({}))
      toast({
        title: 'Could not cancel',
        description: body.error ?? 'Please try again.',
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarX className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Cancel session
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this session?</DialogTitle>
          <DialogDescription>
            Your mentor will be notified. You will be able to book a new session
            straight away.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="cancel-reason">Reason (optional)</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Let your mentor know why, if you would like to."
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={cancelling}>
            Keep session
          </Button>
          <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                Cancelling…
              </>
            ) : (
              'Cancel session'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
