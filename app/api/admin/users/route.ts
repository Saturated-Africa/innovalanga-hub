import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

const createSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['super_admin', 'facilitator', 'mentor']),
  // Mentor-specific
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional(),
  expertise: z.array(z.string()).optional(),
  bio: z.string().max(500).optional(),
  phone: z.string().optional(),
})

export async function GET() {
  const session = await getSession()
  if (!session || session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      innovatorProfile: { select: { id: true, cohortId: true, businessName: true } },
      mentorProfile: { select: { id: true, expertise: true } },
    },
  })

  return NextResponse.json(users)
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const { name, email, password, role, firstName, lastName, expertise, bio, phone } = parsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
  }

  const hashed = await bcrypt.hash(password, 12)

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: { name, email, password: hashed, role },
    })

    if (role === 'mentor') {
      const parts = name.split(' ')
      await tx.mentorProfile.create({
        data: {
          userId: newUser.id,
          firstName: firstName ?? parts[0] ?? name,
          lastName: lastName ?? parts.slice(1).join(' ') ?? '',
          phone: phone ?? null,
          expertise: expertise ?? [],
          bio: bio ?? null,
        },
      })
    }

    return newUser
  })

  return NextResponse.json({ id: user.id, email: user.email, role: user.role }, { status: 201 })
}
