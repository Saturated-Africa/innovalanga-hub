import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { tenantScope } from '@/lib/tenant-db'

/**
 * DELETE /api/finance/proofs/[id]
 *
 * Revoke a share link.
 *
 * The record and the stored file are both kept. A workbook already filed with
 * the funder carries this link, and an audit that later asks what was submitted
 * needs the evidence to still exist even where the link has been withdrawn.
 * Revoking closes the door without destroying what was behind it.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const proof = await prisma.financeProof.findFirst({
    where: {
      id: params.id,
      project: { programmeId },
    },
    select: { id: true, revokedAt: true },
  })
  if (!proof) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (proof.revokedAt) {
    return NextResponse.json({ ok: true, alreadyRevoked: true })
  }

  await prisma.financeProof.update({
    where: { id: proof.id },
    data: { revokedAt: new Date() },
  })

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'finance.proof.revoked',
      entityType: 'FinanceProof',
      entityId: proof.id,
    },
  })

  return NextResponse.json({ ok: true })
}
