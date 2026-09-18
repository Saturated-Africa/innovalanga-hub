import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { tenantScope } from '@/lib/tenant-db'
import { canManageMentorSchedule } from '@/lib/authz'

export async function DELETE(
  _req: Request,
  props: { params: Promise<{ id: string; overrideId: string }> }
) {
  const params = await props.params;
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  if (!(await canManageMentorSchedule(session, params.id, programmeId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Bound to the mentor in the path as well as its own id, so an authorised
  // caller cannot pass an override id belonging to someone else.
  const deleted = await prisma.mentorDateOverride.deleteMany({
    where: { id: params.overrideId, mentorId: params.id },
  })
  if (deleted.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
