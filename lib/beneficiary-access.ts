/**
 * Who may do what to a beneficiary capture form.
 *
 * Two routes to the same record. Staff capture forms on behalf of people being
 * onboarded in person; beneficiaries fill their own in and sign it, which is
 * the flow the funder wants for compliance. Both end at the same place: a
 * signed form a facilitator has approved.
 *
 * Dependency-free so the rules can be tested without a database, in the same
 * way as the scope and route-access rules.
 */

export type FormStatus = 'Draft' | 'AwaitingAcceptance' | 'Accepted' | 'Withdrawn'

export interface FormActor {
  userId: string
  role: string
}

export interface FormRecord {
  /** The account that owns this form, when a beneficiary filled it in. */
  userId: string | null
  status: FormStatus
}

const STAFF = ['super_admin', 'facilitator']

export function isStaff(role: string): boolean {
  return STAFF.includes(role)
}

/** The beneficiary whose form this is. */
export function isOwner(actor: FormActor, record: FormRecord): boolean {
  return record.userId !== null && record.userId === actor.userId
}

/**
 * May this actor read the form?
 *
 * Staff read any form in their programme; the scope query enforces the
 * programme part. A beneficiary reads only their own.
 */
export function canRead(actor: FormActor, record: FormRecord): boolean {
  return isStaff(actor.role) || isOwner(actor, record)
}

/**
 * May this actor change the answers?
 *
 * Only while the form is a Draft, and only staff or the owner. Once signed,
 * the answers are what was signed. This is the rule the whole integrity model
 * rests on: the hash taken at signing is meaningless if the answers behind it
 * can still move.
 */
export function canEdit(actor: FormActor, record: FormRecord): boolean {
  if (record.status !== 'Draft') return false
  return isStaff(actor.role) || isOwner(actor, record)
}

/**
 * May this actor sign as the beneficiary?
 *
 * The owner signs their own form. Staff may also sign, because a form captured
 * in person is signed on the facilitator's device with the beneficiary present,
 * which is how the paper process works.
 */
export function canSign(actor: FormActor, record: FormRecord): boolean {
  if (record.status !== 'Draft') return false
  return isStaff(actor.role) || isOwner(actor, record)
}

/**
 * May this actor approve the submission?
 *
 * Staff only, and never the beneficiary, even for their own form. The
 * acceptance block on the funder's form is a counter-signature by the centre;
 * a form approved by the person it describes is not counter-signed at all.
 */
export function canApprove(actor: FormActor, record: FormRecord): boolean {
  if (record.status !== 'AwaitingAcceptance') return false
  if (!isStaff(actor.role)) return false
  return !isOwner(actor, record)
}

/**
 * May this actor send the form back for correction?
 *
 * Same rule as approving. Returning voids the signature, so it is a staff
 * decision and not something a beneficiary can do to undo their own.
 */
export function canReturn(actor: FormActor, record: FormRecord): boolean {
  return canApprove(actor, record)
}
