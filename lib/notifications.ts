import { prisma } from '@/lib/prisma'

export async function createNotification(params: {
  userId: string
  title: string
  body: string
  href?: string
}) {
  await prisma.notification.create({ data: params })
}

/** Create notifications for both mentor and innovator when a booking is confirmed */
export async function notifyBookingConfirmed(params: {
  mentorUserId: string
  innovatorUserId: string
  mentorName: string
  innovatorName: string
  bookingId: string
  dateStr: string
}) {
  const { mentorUserId, innovatorUserId, mentorName, innovatorName, bookingId, dateStr } = params
  await Promise.all([
    createNotification({
      userId: innovatorUserId,
      title: 'Session confirmed',
      body: `Your session with ${mentorName} on ${dateStr} has been confirmed.`,
      href: '/dashboard/innovator/sessions',
    }),
    createNotification({
      userId: mentorUserId,
      title: 'New session booked',
      body: `${innovatorName} has booked a session with you on ${dateStr}.`,
      href: '/dashboard/sessions',
    }),
  ])
}

export async function notifySessionCompleted(params: {
  mentorUserId: string
  innovatorName: string
}) {
  await createNotification({
    userId: params.mentorUserId,
    title: 'Session completed — add your notes',
    body: `Your session with ${params.innovatorName} is complete. Log your notes and next steps.`,
    href: '/dashboard/mentorship',
  })
}

export async function notifyNoShow(params: {
  mentorUserId: string
  innovatorUserId: string
  innovatorName: string
  mentorName: string
}) {
  await Promise.all([
    createNotification({
      userId: params.mentorUserId,
      title: 'No-show flagged',
      body: `${params.innovatorName} did not attend the scheduled session. A facilitator will follow up.`,
      href: '/dashboard/sessions',
    }),
    createNotification({
      userId: params.innovatorUserId,
      title: 'Missed session',
      body: `You missed your session with ${params.mentorName}. Please book a new session when ready.`,
      href: '/dashboard/book',
    }),
  ])
}
