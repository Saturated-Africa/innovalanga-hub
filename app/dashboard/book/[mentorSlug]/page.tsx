import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { BookingWizard } from './BookingWizard'
import { PageHeader } from '@/components/shared/PageHeader'

interface Props {
  params: Promise<{ mentorSlug: string }>
}

export default async function BookMentorPage(props: Props) {
  const params = await props.params;
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'innovator') redirect('/dashboard')

  const [mentor, innovatorProfile] = await Promise.all([
    prisma.mentorProfile.findUnique({
      where: { bookingSlug: params.mentorSlug },
      include: {
        availability: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
        dateOverrides: { where: { date: { gte: new Date() } } },
        blackoutPeriods: { where: { endDate: { gte: new Date() } } },
        eventTypes: { where: { active: true }, orderBy: { durationMins: 'asc' } },
        bookings: {
          where: {
            status: { in: ['Confirmed', 'InProgress'] },
            scheduledStart: { gte: new Date() },
          },
          select: { scheduledStart: true, scheduledEnd: true, eventTypeId: true },
        },
      },
    }),
    prisma.innovatorProfile.findUnique({
      where: { userId: session.user.id },
    }),
  ])

  if (!mentor) notFound()
  if (!innovatorProfile) redirect('/dashboard/innovator/sessions')

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Book with {mentor.firstName} {mentor.lastName}" description={<>{mentor.expertise.join(' · ')}</>} />
      <BookingWizard
        mentor={{
          id: mentor.id,
          firstName: mentor.firstName,
          lastName: mentor.lastName,
          availability: mentor.availability,
          bookedSlots: mentor.bookings,
          blackoutPeriods: mentor.blackoutPeriods,
          dateOverrides: mentor.dateOverrides,
          eventTypes: mentor.eventTypes,
        }}
        innovatorId={innovatorProfile.id}
      />
    </div>
  )
}
