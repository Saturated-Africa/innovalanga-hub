import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { tenantScope } from '@/lib/tenant-db'
import { encrypt } from '@/lib/encryption'
import { validateOwnProfile } from '@/lib/own-profile'

/**
 * GET /api/innovator/me
 * Returns the innovator profile for the currently logged-in innovator user.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await prisma.innovatorProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      businessName: true,
      cohortId: true,
    },
  })

  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(profile)
}

/**
 * PATCH /api/innovator/me
 *
 * A participant correcting their own details.
 *
 * Until this existed they could not fix a misspelled surname or a changed phone
 * number without asking a facilitator to do it in the admin screens, which is a
 * poor use of a facilitator and a worse experience for the participant.
 *
 * Two things keep this narrow. The row is found by the caller's own user id, so
 * there is no id in the request that could point at somebody else - the usual
 * ownership bug cannot be written here. And the fields written are exactly the
 * ones validateOwnProfile returns, so a field added to the profile later is not
 * silently self-editable; classification fields like cohort and region stay with
 * staff because a funder's figures are grouped by them.
 *
 * The request body is never spread into `update`. Every value assigned below is
 * one the validator produced.
 */
export async function PATCH(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'innovator') {
    return NextResponse.json(
      { error: 'This is for a participant editing their own profile.' },
      { status: 403 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { db: db } = scope

  const existing = await db.innovatorProfile.findFirst({
    where: { userId: session.user.id },
    select: { id: true, idNumberEncrypted: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const result = validateOwnProfile(body, {
    hasIdNumber: existing.idNumberEncrypted !== null,
  })
  if (!result.ok) {
    return NextResponse.json({ error: 'Check the fields.', fields: result.errors }, { status: 400 })
  }
  const { idNumber, ...fields } = result.fields

  const updated = await db.innovatorProfile.update({
    where: { id: existing.id },
    data: {
      firstName: fields.firstName,
      lastName: fields.lastName,
      phone: fields.phone,
      businessName: fields.businessName,
      businessSector: fields.businessSector,
      bio: fields.bio,
      // Only ever set, never replaced. The validator has already refused an
      // attempt to overwrite one that exists.
      ...(idNumber ? { idNumberEncrypted: encrypt(idNumber) } : {}),
    },
    select: { id: true, firstName: true, lastName: true },
  })

  // The user record carries the display name used across the app, so leaving it
  // behind would show the old name everywhere except this form.
  await db.user.update({
    where: { id: session.user.id },
    data: { name: `${fields.firstName} ${fields.lastName}` },
  })

  await db.auditLog.create({
    data: {
      innovatorId: existing.id,
      actorId: session.user.id,
      action: 'profile.self.updated',
      entityType: 'InnovatorProfile',
      entityId: existing.id,
      // The ID number itself is never logged. That it was set is the fact worth
      // keeping; the value is the thing being protected.
      diff: {
        fields: Object.keys(fields),
        idNumberSet: Boolean(idNumber),
      },
    },
  })

  return NextResponse.json({
    id: updated.id,
    firstName: updated.firstName,
    lastName: updated.lastName,
  })
}
