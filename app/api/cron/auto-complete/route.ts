import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendNoShowAlert, sendSessionCompletedToMentor } from '@/lib/email'
import { notifyNoShow, notifySessionCompleted } from '@/lib/notifications'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

  // Mark Confirmed bookings as NoShowPendingReview if 15+ min past scheduled start
  const noShowCutoff = new Date(now.getTime() - 15 * 60 * 1000)
  const noShowBookings = await prisma.booking.findMany({
    where: {
      status: 'Confirmed',
      scheduledStart: { lte: noShowCutoff },
      actualStart: null,
    },
    include: {
      mentor: { include: { user: { select: { email: true } } } },
      innovator: { include: { user: { select: { email: true } } } },
    },
  })

  for (const b of noShowBookings) {
    await prisma.booking.update({
      where: { id: b.id },
      data: { status: 'NoShowPendingReview' },
    })
    const mentorName = `${b.mentor.firstName} ${b.mentor.lastName}`
    const innovatorName = `${b.innovator.firstName} ${b.innovator.lastName}`
    try {
      await sendNoShowAlert({
        mentorEmail: b.mentor.user.email,
        mentorName,
        innovatorName,
        innovatorEmail: b.innovator.user.email,
        scheduledStart: b.scheduledStart,
      })
    } catch {
      // Email failure is non-fatal
    }
    try {
      await notifyNoShow({
        mentorUserId: b.mentor.userId,
        innovatorUserId: b.innovator.userId,
        innovatorName,
        mentorName,
      })
    } catch {
      // Notification failure is non-fatal
    }
  }

  // Mark InProgress bookings as Completed if 30+ min past scheduled end
  const autoCompleteCutoff = new Date(now.getTime() - 30 * 60 * 1000)
  const inProgressBookings = await prisma.booking.findMany({
    where: {
      status: 'InProgress',
      scheduledEnd: { lte: autoCompleteCutoff },
    },
    include: {
      mentor: { include: { user: { select: { email: true } } } },
      innovator: { select: { firstName: true, lastName: true } },
    },
  })

  let completed = 0
  for (const b of inProgressBookings) {
    const scheduledDuration = Math.round(
      (b.scheduledEnd.getTime() - b.scheduledStart.getTime()) / 60000
    )
    await prisma.booking.update({
      where: { id: b.id },
      data: {
        status: 'Completed',
        actualEnd: b.scheduledEnd,
        actualDurationMinutes: scheduledDuration,
      },
    })
    await prisma.mentorshipLog.upsert({
      where: { bookingId: b.id },
      create: { bookingId: b.id },
      update: {},
    })
    const mentorName2 = `${b.mentor.firstName} ${b.mentor.lastName}`
    const innovatorName2 = `${b.innovator.firstName} ${b.innovator.lastName}`
    try {
      await sendSessionCompletedToMentor({
        mentorEmail: b.mentor.user.email,
        mentorName: mentorName2,
        innovatorName: innovatorName2,
        scheduledStart: b.scheduledStart,
        logUrl: `${baseUrl}/dashboard/mentorship`,
      })
    } catch {
      // Email failure is non-fatal
    }
    try {
      await notifySessionCompleted({
        mentorUserId: b.mentor.userId,
        innovatorName: innovatorName2,
      })
    } catch {
      // Notification failure is non-fatal
    }
    completed++
  }

  return NextResponse.json({
    noShows: noShowBookings.length,
    autoCompleted: completed,
    timestamp: now.toISOString(),
  })
}
