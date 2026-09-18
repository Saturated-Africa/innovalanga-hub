import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { GrantStatus } from '@prisma/client'
import { tenantScope } from '@/lib/tenant-db'
import { canChangeGrantStatus, type GrantStatus as GrantStatusName } from '@/lib/funds/rules'

/**
 * PATCH /api/grants/[id]
 *
 * Move a grant along its lifecycle.
 *
 * This route exists because the award screen shipped without it, and a grant is
 * created as Draft while canPayTranche refuses to pay a Draft grant - so the
 * first grant awarded through the UI could never be paid from. Awarding without
 * a way to activate is an award nobody can act on.
 *
 * Activating is what commits the fund's money, so it is the fund manager's act
 * rather than the facilitator's, the same split the tranche routes already use:
 * a facilitator proposes, the fund manager releases.
 */
const schema = z.object({
  status: z.nativeEnum(GrantStatus),
  reason: z.string().trim().max(2000).optional(),
})

const MAY_CHANGE = ['super_admin']

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!MAY_CHANGE.includes(session.user.role)) {
    return NextResponse.json(
      { error: 'Changing a grant’s status is the fund manager’s decision.' },
      { status: 403 }
    )
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { status: to, reason } = parsed.data

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { db: prisma } = scope

  const grant = await prisma.grant.findFirst({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      innovatorId: true,
      tranches: { select: { status: true } },
    },
  })
  if (!grant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const verdict = canChangeGrantStatus(
    grant.status as GrantStatusName,
    to as GrantStatusName,
    grant.tranches.map((t) => ({ status: t.status as never }))
  )
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.reason }, { status: 409 })
  }

  const updated = await prisma.grant.update({
    where: { id: grant.id },
    data: { status: to },
    select: { id: true, status: true },
  })

  await prisma.auditLog.create({
    data: {
      innovatorId: grant.innovatorId,
      actorId: session.user.id,
      action: 'grant.status',
      entityType: 'Grant',
      entityId: grant.id,
      diff: { from: grant.status, to: updated.status, reason: reason ?? null },
    },
  })

  return NextResponse.json({ id: updated.id, status: updated.status })
}
