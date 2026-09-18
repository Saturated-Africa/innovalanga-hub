import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canRead,
  canEdit,
  canSign,
  canApprove,
  canReturn,
  isOwner,
  type FormRecord,
} from './beneficiary-access.ts'

const beneficiary = { userId: 'user-bene', role: 'innovator' }
const otherBeneficiary = { userId: 'user-other', role: 'innovator' }
const facilitator = { userId: 'user-fac', role: 'facilitator' }
const admin = { userId: 'user-admin', role: 'super_admin' }

const draft = (over: Partial<FormRecord> = {}): FormRecord => ({
  userId: 'user-bene',
  status: 'Draft',
  ...over,
})

test('a beneficiary owns only their own form', () => {
  assert.equal(isOwner(beneficiary, draft()), true)
  assert.equal(isOwner(otherBeneficiary, draft()), false)
})

test('a beneficiary cannot read another beneficiary form', () => {
  assert.equal(canRead(beneficiary, draft()), true)
  assert.equal(canRead(otherBeneficiary, draft()), false)
})

test('staff read any form', () => {
  assert.equal(canRead(facilitator, draft()), true)
  assert.equal(canRead(admin, draft({ userId: null })), true)
})

test('answers can only change while the form is a draft', () => {
  assert.equal(canEdit(beneficiary, draft()), true)
  assert.equal(canEdit(facilitator, draft()), true)

  // The rule the integrity model depends on.
  for (const status of ['AwaitingAcceptance', 'Accepted', 'Withdrawn'] as const) {
    assert.equal(canEdit(beneficiary, draft({ status })), false, status)
    assert.equal(canEdit(facilitator, draft({ status })), false, status)
    assert.equal(canEdit(admin, draft({ status })), false, status)
  }
})

test('a beneficiary cannot edit somebody else driving their own draft', () => {
  assert.equal(canEdit(otherBeneficiary, draft()), false)
})

test('the owner signs their own form, and staff can sign one captured in person', () => {
  assert.equal(canSign(beneficiary, draft()), true)
  assert.equal(canSign(facilitator, draft({ userId: null })), true)
  assert.equal(canSign(otherBeneficiary, draft()), false)
})

test('nothing can be signed twice', () => {
  assert.equal(canSign(beneficiary, draft({ status: 'AwaitingAcceptance' })), false)
  assert.equal(canSign(beneficiary, draft({ status: 'Accepted' })), false)
})

test('only staff approve, and only after the beneficiary has signed', () => {
  const signed = draft({ status: 'AwaitingAcceptance' })
  assert.equal(canApprove(facilitator, signed), true)
  assert.equal(canApprove(admin, signed), true)

  // Not before signing.
  assert.equal(canApprove(facilitator, draft()), false)
  // Not twice.
  assert.equal(canApprove(facilitator, draft({ status: 'Accepted' })), false)
})

test('a beneficiary never approves, not even their own form', () => {
  const signed = draft({ status: 'AwaitingAcceptance' })
  assert.equal(canApprove(beneficiary, signed), false)
  assert.equal(canApprove(otherBeneficiary, signed), false)
})

test('a staff member cannot counter-sign a form that is about themselves', () => {
  // The acceptance block is a counter-signature by the centre. A form approved
  // by the person it describes has not been counter-signed at all.
  const ownForm = draft({ userId: facilitator.userId, status: 'AwaitingAcceptance' })
  assert.equal(canApprove(facilitator, ownForm), false)
})

test('returning for correction follows the same rule as approving', () => {
  const signed = draft({ status: 'AwaitingAcceptance' })
  assert.equal(canReturn(facilitator, signed), true)
  assert.equal(canReturn(beneficiary, signed), false)
  assert.equal(canReturn(facilitator, draft()), false)
})
