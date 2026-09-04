import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { AvailabilityGrid } from '@/components/dashboard/AvailabilityGrid'
import { AvailabilityExceptions } from '@/components/dashboard/AvailabilityExceptions'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { CalendarDays, Link2, Settings2 } from 'lucide-react'

export default async function MentorAvailabilityPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'mentor'].includes(session.user.role)) redirect('/dashboard')

  const mentor = await prisma.mentorProfile.findUnique({
    where: { userId: session.user.id },
    include: {
      availability: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
      dateOverrides: {
        where: { date: { gte: new Date() } },
        orderBy: { date: 'asc' },
      },
      blackoutPeriods: {
        where: { endDate: { gte: new Date() } },
        orderBy: { startDate: 'asc' },
      },
    },
  })

  if (!mentor && session.user.role === 'mentor') {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Availability Setup</h1>
        <p className="text-muted-foreground">Your mentor profile is not set up yet. Contact an administrator.</p>
      </div>
    )
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const bookingLink = `${baseUrl}/dashboard/book/${mentor!.bookingSlug}`
  const icsLink = `${baseUrl}/api/calendar/${mentor!.id}?token=${mentor!.icsToken}`

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Availability Setup</h1>
        <p className="text-muted-foreground mt-1">
          Configure when you are available for sessions
        </p>
      </div>

      {/* Session types shortcut */}
      <div className="rounded-lg border bg-card p-4 flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Session Types
          </p>
          <p className="text-xs text-muted-foreground">
            Define the types of sessions innovators can book with you.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/mentor/event-types">Manage</Link>
        </Button>
      </div>

      {/* Booking link */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <p className="text-sm font-medium flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          Your Booking Link
        </p>
        <p className="text-xs text-muted-foreground">
          Share this link with innovators so they can book a session with you directly.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded bg-muted px-3 py-1.5 text-xs font-mono break-all">
            {bookingLink}
          </code>
        </div>
      </div>

      {/* iCal feed */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <p className="text-sm font-medium flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          Calendar Sync
        </p>
        <p className="text-xs text-muted-foreground">
          Subscribe to your sessions in any calendar app (Google Calendar, Outlook, Apple Calendar).
          Copy the URL below and paste it as a new calendar subscription.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded bg-muted px-3 py-1.5 text-xs font-mono break-all">
            {icsLink}
          </code>
        </div>
        <p className="text-xs text-muted-foreground">
          In Google Calendar: Other calendars → + → From URL → paste the link above.
        </p>
      </div>

      <Separator />

      {/* Weekly grid */}
      <div>
        <h2 className="text-base font-semibold mb-4">Weekly Recurring Availability</h2>
        <AvailabilityGrid
          mentorId={mentor!.id}
          existingSlots={mentor!.availability}
        />
      </div>

      <Separator />

      {/* Date overrides + blackout periods */}
      <div>
        <h2 className="text-base font-semibold mb-4">Exceptions</h2>
        <AvailabilityExceptions
          mentorId={mentor!.id}
          overrides={mentor!.dateOverrides}
          blackouts={mentor!.blackoutPeriods}
        />
      </div>
    </div>
  )
}
