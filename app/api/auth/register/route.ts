import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { checkRateLimit, clientIp, REGISTER_PER_IP } from '@/lib/rate-limit'

/**
 * POST /api/auth/register
 *
 * Creates an innovator account. Role is always 'innovator'; admins, mentors and
 * facilitators are created from the admin area.
 *
 * Three changes from the original. It was unlimited, so this public endpoint
 * could be used to create accounts in bulk - and a real account is what turned
 * several of the authorisation bugs into a usable attack chain. It confirmed
 * which email addresses already existed, which is an enumeration oracle on an
 * unauthenticated route. And it had no bot deterrent at all.
 */
const schema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  /**
   * Honeypot. Hidden from real users by CSS and left empty by them; automated
   * form fillers populate every field they find. Named to look worth filling.
   */
  company: z.string().max(0).optional(),
  /** Milliseconds the form was on screen before submission. */
  elapsedMs: z.number().int().nonnegative().optional(),
})

/** No human completes a registration form this fast. */
const MIN_FILL_MS = 2000

export async function POST(req: Request) {
  const ip = clientIp(req.headers)
  const limit = checkRateLimit(`register:${ip}`, REGISTER_PER_IP)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const { name, password, company, elapsedMs } = parsed.data
  const email = parsed.data.email.trim().toLowerCase()

  // Bot signals. Both respond exactly as a success would, so an automated
  // client learns nothing from the difference.
  const looksAutomated =
    (company !== undefined && company !== '') ||
    (elapsedMs !== undefined && elapsedMs < MIN_FILL_MS)

  if (looksAutomated) {
    return NextResponse.json({ ok: true }, { status: 201 })
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })

  // Do not confirm whether the address is already registered. The original
  // returned a 409 saying so, which let anyone test an address list against the
  // platform. A real duplicate is handled by the sign-in page instead.
  if (existing) {
    return NextResponse.json({ ok: true }, { status: 201 })
  }

  const hashed = await bcrypt.hash(password, 12)

  await prisma.user.create({
    data: { name, email, password: hashed, role: 'innovator' },
  })

  return NextResponse.json({ ok: true }, { status: 201 })
}
