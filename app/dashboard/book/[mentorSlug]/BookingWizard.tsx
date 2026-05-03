'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'
import {
  format, addDays, startOfDay, isWithinInterval, addMinutes,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Clock, Loader2, Check } from 'lucide-react'

interface AvailabilitySlot {
  dayOfWeek: number
  startTime: string
  endTime: string
  bufferMins: number
}

interface BookedSlot {
  scheduledStart: Date
  scheduledEnd: Date
  eventTypeId: string | null
}

interface BlackoutPeriod {
  startDate: Date
  endDate: Date
}

interface DateOverride {
  date: Date
  available: boolean
}

interface EventType {
  id: string
  name: string
  slug: string
  description: string | null
  durationMins: number
  bufferBefore: number
  bufferAfter: number
  color: string
}

interface MentorData {
  id: string
  firstName: string
  lastName: string
  availability: AvailabilitySlot[]
  bookedSlots: BookedSlot[]
  blackoutPeriods: BlackoutPeriod[]
  dateOverrides: DateOverride[]
  eventTypes: EventType[]
}

interface BookingWizardProps {
  mentor: MentorData
  innovatorId: string
}

function generateTimeSlots(
  date: Date,
  mentor: MentorData,
  eventType: EventType,
): { start: Date; end: Date; label: string }[] {
  const dow = date.getDay()
  const daySlots = mentor.availability.filter((a) => a.dayOfWeek === dow)
  if (daySlots.length === 0) return []

  const override = mentor.dateOverrides.find(
    (o) => format(new Date(o.date), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
  )
  if (override && !override.available) return []

  const inBlackout = mentor.blackoutPeriods.some((bp) =>
    isWithinInterval(date, { start: new Date(bp.startDate), end: new Date(bp.endDate) })
  )
  if (inBlackout) return []

  const slots: { start: Date; end: Date; label: string }[] = []
  const totalBlock = eventType.durationMins + eventType.bufferBefore + eventType.bufferAfter

  for (const slot of daySlots) {
    const [sh, sm] = slot.startTime.split(':').map(Number)
    const [eh, em] = slot.endTime.split(':').map(Number)

    const dayStart = new Date(date)
    dayStart.setUTCHours(sh, sm, 0, 0)
    const dayEnd = new Date(date)
    dayEnd.setUTCHours(eh, em, 0, 0)

    let cursor = new Date(dayStart)

    while (true) {
      const slotStart = addMinutes(cursor, eventType.bufferBefore)
      const slotEnd = addMinutes(slotStart, eventType.durationMins)
      const blockEnd = addMinutes(slotEnd, eventType.bufferAfter)

      if (blockEnd > dayEnd) break

      const conflict = mentor.bookedSlots.some((b) => {
        const bs = new Date(b.scheduledStart)
        const be = new Date(b.scheduledEnd)
        return slotStart < be && slotEnd > bs
      })

      if (!conflict) {
        // Display in SAST (UTC+2)
        const startSAST = new Date(slotStart.getTime() + 2 * 60 * 60 * 1000)
        const endSAST = new Date(slotEnd.getTime() + 2 * 60 * 60 * 1000)
        slots.push({
          start: slotStart,
          end: slotEnd,
          label: `${format(startSAST, 'HH:mm')} – ${format(endSAST, 'HH:mm')} SAST`,
        })
      }

      cursor = addMinutes(cursor, totalBlock)
    }
  }

  return slots
}

export function BookingWizard({ mentor, innovatorId }: BookingWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [selectedEventType, setSelectedEventType] = useState<EventType | null>(
    mentor.eventTypes.length === 1 ? mentor.eventTypes[0] : null
  )
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date; label: string } | null>(null)
  const [notes, setNotes] = useState('')
  const [meetingLink, setMeetingLink] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [weekOffset, setWeekOffset] = useState(0)

  const today = startOfDay(new Date())
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(today, weekOffset * 7 + i + 1))
  const availableDays = new Set(mentor.availability.map((a) => a.dayOfWeek))
  const slotsForDate = selectedDate && selectedEventType
    ? generateTimeSlots(selectedDate, mentor, selectedEventType)
    : []

  const steps = [
    { n: 1, label: 'Session type' },
    { n: 2, label: 'Pick a date' },
    { n: 3, label: 'Pick a time' },
    { n: 4, label: 'Confirm' },
  ]

  async function confirmBooking() {
    if (!selectedSlot || !selectedEventType) return
    setSubmitting(true)

    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mentorId: mentor.id,
        innovatorId,
        eventTypeId: selectedEventType.id,
        scheduledStart: selectedSlot.start.toISOString(),
        scheduledEnd: selectedSlot.end.toISOString(),
        notes,
        meetingLink,
      }),
    })

    setSubmitting(false)

    if (res.ok) {
      const booking = await res.json()
      router.push(`/dashboard/book/confirmed?bookingId=${booking.id}`)
    } else {
      const body = await res.json()
      toast({
        title: 'Booking failed',
        description: body.error ?? 'Please try again.',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-1.5 text-sm">
        {steps.map((s, idx) => (
          <div key={s.n} className="flex items-center gap-1.5">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                step > s.n
                  ? 'bg-primary text-white'
                  : step === s.n
                  ? 'bg-primary text-white ring-2 ring-primary ring-offset-2'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {step > s.n ? <Check className="h-3.5 w-3.5" /> : s.n}
            </div>
            <span className={step === s.n ? 'font-medium' : 'text-muted-foreground hidden sm:inline'}>
              {s.label}
            </span>
            {idx < steps.length - 1 && <div className={`h-px w-6 ${step > s.n ? 'bg-primary' : 'bg-muted'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Event type */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Choose a session type</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {mentor.eventTypes.map((et) => (
              <button
                key={et.id}
                onClick={() => setSelectedEventType(et)}
                className={`w-full rounded-lg border p-4 text-left transition-all ${
                  selectedEventType?.id === et.id
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'hover:border-primary/50 hover:bg-accent'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 h-4 w-1 rounded-full shrink-0"
                    style={{ backgroundColor: et.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{et.name}</p>
                    {et.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{et.description}</p>
                    )}
                    <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{et.durationMins} minutes</span>
                    </div>
                  </div>
                  {selectedEventType?.id === et.id && (
                    <Check className="h-4 w-4 text-primary shrink-0" />
                  )}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Date */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Select a date</CardTitle>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
                  disabled={weekOffset === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setWeekOffset((w) => w + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1.5">
              {weekDays.map((day) => {
                const isAvailable = availableDays.has(day.getDay())
                const isSelected =
                  selectedDate &&
                  format(day, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd')
                return (
                  <button
                    key={day.toISOString()}
                    disabled={!isAvailable}
                    onClick={() => { setSelectedDate(day); setSelectedSlot(null) }}
                    className={`flex flex-col items-center rounded-lg p-2 text-sm transition-colors ${
                      isSelected
                        ? 'bg-primary text-white'
                        : isAvailable
                        ? 'hover:bg-accent cursor-pointer'
                        : 'opacity-30 cursor-not-allowed'
                    }`}
                  >
                    <span className="text-xs">{format(day, 'EEE')}</span>
                    <span className="text-lg font-semibold">{format(day, 'd')}</span>
                    <span className="text-xs">{format(day, 'MMM')}</span>
                  </button>
                )
              })}
            </div>
            {selectedEventType && (
              <p className="mt-3 text-xs text-muted-foreground text-center">
                Showing availability for: <strong>{selectedEventType.name}</strong>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3: Time */}
      {step === 3 && selectedDate && selectedEventType && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Available times — {format(selectedDate, 'EEEE, d MMMM yyyy')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {slotsForDate.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No slots available on this day. Go back and select a different date.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {slotsForDate.map((slot) => (
                  <button
                    key={slot.label}
                    onClick={() => setSelectedSlot(slot)}
                    className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                      selectedSlot?.label === slot.label
                        ? 'bg-primary text-white border-primary'
                        : 'hover:border-primary hover:text-primary'
                    }`}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 4: Confirm */}
      {step === 4 && selectedSlot && selectedDate && selectedEventType && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Confirm your booking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted p-4 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: selectedEventType.color }}
                />
                <span className="font-medium">{selectedEventType.name}</span>
                <Badge variant="outline" className="ml-auto text-xs">
                  <Clock className="mr-1 h-3 w-3" />
                  {selectedEventType.durationMins} min
                </Badge>
              </div>
              <p><span className="text-muted-foreground">Mentor:</span> {mentor.firstName} {mentor.lastName}</p>
              <p><span className="text-muted-foreground">Date:</span> {format(selectedDate, 'EEEE, d MMMM yyyy')}</p>
              <p><span className="text-muted-foreground">Time:</span> {selectedSlot.label}</p>
            </div>
            <div>
              <label className="text-sm font-medium">Meeting link (optional)</label>
              <input
                type="url"
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="https://zoom.us/j/... or Teams / Meet link"
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Notes for your mentor (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Topics you want to cover, questions, context…"
                rows={3}
                className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </div>
            <Button onClick={confirmBooking} disabled={submitting} className="w-full">
              {submitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Confirming…</>
              ) : (
                'Confirm Booking'
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => (s > 1 ? (s - 1 as 1 | 2 | 3 | 4) : s))}
          disabled={step === 1}
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Button
          onClick={() => {
            if (step === 1 && selectedEventType) setStep(2)
            else if (step === 2 && selectedDate) setStep(3)
            else if (step === 3 && selectedSlot) setStep(4)
          }}
          disabled={
            (step === 1 && !selectedEventType) ||
            (step === 2 && !selectedDate) ||
            (step === 3 && !selectedSlot) ||
            step === 4
          }
        >
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
