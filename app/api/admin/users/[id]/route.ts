import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const patchSchema = z.object({
  role: z.enum(['super_admin', 'facilitator', 'mentor', 'innovator', 'funder_viewer']).optional(),
  name: z.string().min(2).max(100).optional(),
})

/**
 * Refuse to leave the platform with no administrator.
 *
 * Nothing stopped the last super_admin being demoted or deleted, and the only
 * route that can undo either is one that requires a super_admin. The result is
 * a platform nobody can administer and no way back in short of the database.
 * The caller's own account is already protected; this covers every other way of
 * reaching the same state.
 */
async function wouldRemoveLastAdmin(targetId: string): Promise<boolean> {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { role: true },
  })
  if (target?.role !== 'super_admin') return false
  const admins = await prisma.user.count({ where: { role: 'super_admin' } })
  return admins <= 1
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session || session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Prevent demoting yourself
  if (params.id === session.user.id) {
    return NextResponse.json({ error: 'Cannot modify your own account.' }, { status: 400 })
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, role: true },
  })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (
    parsed.data.role &&
    parsed.data.role !== 'super_admin' &&
    (await wouldRemoveLastAdmin(params.id))
  ) {
    return NextResponse.json(
      { error: 'This is the only super admin. Promote somebody else first.' },
      { status: 409 }
    )
  }

  const updated = await prisma.user.update({
    where: { id: params.id },
    data: parsed.data,
    select: { id: true, name: true, email: true, role: true },
  })

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'admin.user.updated',
      entityType: 'User',
      entityId: params.id,
      diff: { from: { role: user.role }, to: parsed.data },
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session || session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (params.id === session.user.id) {
    return NextResponse.json({ error: 'Cannot delete your own account.' }, { status: 400 })
  }

  if (await wouldRemoveLastAdmin(params.id)) {
    return NextResponse.json(
      { error: 'This is the only super admin. Promote somebody else first.' },
      { status: 409 }
    )
  }

  // Written before the delete, because the row it describes is about to stop
  // existing and the log is the only record that it ever did.
  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { email: true, role: true },
  })
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'admin.user.deleted',
      entityType: 'User',
      entityId: params.id,
      diff: { email: target.email, role: target.role },
    },
  })

  await prisma.user.delete({ where: { id: params.id } })

  // Sessions are JWTs, so this account's existing token stays valid until it
  // expires. Deleting the row removes their data, not their access.
  return NextResponse.json({ ok: true, sessionsRemainValidUntilExpiry: true })
}
