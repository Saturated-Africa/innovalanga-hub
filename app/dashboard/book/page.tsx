import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Clock, CalendarDays } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'

export default async function BookPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'innovator') redirect('/dashboard')

  const profile = await prisma.innovatorProfile.findUnique({
    where: { userId: session.user.id },
  })
  if (!profile) redirect('/dashboard/innovator/sessions')

  const activeBooking = await prisma.booking.findFirst({
    where: { innovatorId: profile.id, status: { in: ['Confirmed', 'InProgress'] } },
    include: {
      mentor: true,
      eventType: true,
    },
  })

  if (activeBooking) {
    return (
      <div className="space-y-4 max-w-lg">
        <h1 className="text-2xl font-bold">Book a Session</h1>
        <div className="rounded-lg border bg-warning/10 border-warning/25 p-4 space-y-1">
          <p className="text-sm font-medium text-warning">You already have an active booking.</p>
          <p className="text-sm text-warning">
            {activeBooking.eventType?.name ?? 'Session'} with{' '}
            {activeBooking.mentor.firstName} {activeBooking.mentor.lastName}.
            Complete or cancel it before booking again.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/innovator/sessions">View My Sessions</Link>
        </Button>
      </div>
    )
  }

  const mentors = await prisma.mentorProfile.findMany({
    include: {
      user: { select: { name: true } },
      availability: { orderBy: { dayOfWeek: 'asc' } },
      eventTypes: { where: { active: true }, orderBy: { durationMins: 'asc' } },
    },
    where: {
      availability: { some: {} },
      eventTypes: { some: { active: true } },
    },
  })

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader title="Book a Session" description="Choose a mentor to book a 1-on-1 session" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {mentors.map((m) => (
          <Card key={m.id} className="hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="text-base">{m.firstName} {m.lastName}</CardTitle>
              <CardDescription>{m.expertise.join(' · ')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {m.bio && <p className="text-sm text-muted-foreground line-clamp-2">{m.bio}</p>}

              {/* Event types */}
              <div className="space-y-1">
                {m.eventTypes.map((et) => (
                  <div key={et.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span
                      className="inline-block h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: et.color }}
                    />
                    <Clock className="h-3 w-3 shrink-0" />
                    <span>{et.name} · {et.durationMins} min</span>
                  </div>
                ))}
              </div>

              {/* Available days */}
              <div className="flex flex-wrap gap-1">
                {[...new Set(m.availability.map((a) => DAYS[a.dayOfWeek]))].map((day) => (
                  <Badge key={day} variant="outline" className="text-xs">{day}</Badge>
                ))}
              </div>

              <Button asChild className="w-full" size="sm">
                <Link href={`/dashboard/book/${m.bookingSlug}`}>
                  <CalendarDays className="mr-2 h-3.5 w-3.5" />
                  Schedule a Session
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}

        {mentors.length === 0 && (
          <div className="col-span-2 text-center text-muted-foreground py-8">
            No mentors are currently available. Check back later.
          </div>
        )}
      </div>
    </div>
  )
}
