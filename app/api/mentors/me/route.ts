import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const mentor = await prisma.mentorProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      bookingSlug: true,
      icsToken: true,
    },
  })
  if (!mentor) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(mentor)
}
