import { MAX_UPLOAD_BYTES, isAllowedUploadType } from '@/lib/uploads'

/**
 * Send a receipt for a reported expense: presign, PUT to storage, then record it.
 *
 * Three steps, and the middle one goes straight to S3 without touching the app,
 * so a 20 MiB receipt never occupies the request path of the single process
 * serving every page.
 *
 * The checks here are a courtesy, not the enforcement. The routes check the same
 * things and are the only authority; these exist so somebody picking a 40 MiB
 * photo is told immediately rather than after waiting for the upload to fail.
 */

export class ProofUploadError extends Error {}

export async function uploadExpenseProof(
  grantId: string,
  expenditureId: string,
  file: File
): Promise<{ id: string; filename: string; shareToken: string }> {
  if (file.size === 0) {
    throw new ProofUploadError('That file is empty.')
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))
    throw new ProofUploadError(`Receipts have to be under ${mb} MB.`)
  }
  if (!isAllowedUploadType(file.type)) {
    throw new ProofUploadError(
      'That file type cannot be uploaded. Use a PDF or a photo of the receipt.'
    )
  }

  const base = `/api/grants/${grantId}/expenditures/${expenditureId}/proof`
  const body = {
    filename: file.name,
    contentType: file.type,
    sizeBytes: file.size,
  }

  const presigned = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const presignedBody = await presigned.json()
  if (!presigned.ok) {
    throw new ProofUploadError(
      typeof presignedBody.error === 'string'
        ? presignedBody.error
        : 'The upload could not be started.'
    )
  }

  // Content-Type must match what was signed, or S3 rejects the PUT with a
  // signature mismatch that says nothing about the real cause.
  const put = await fetch(presignedBody.url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!put.ok) {
    throw new ProofUploadError(
      `Storage refused the file (${put.status}). Nothing was attached.`
    )
  }

  const recorded = await fetch(base, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, s3Key: presignedBody.s3Key }),
  })
  const recordedBody = await recorded.json()
  if (!recorded.ok) {
    // The object is in storage but nothing points at it. Saying so matters: the
    // alternative is a receipt the participant believes was filed.
    throw new ProofUploadError(
      typeof recordedBody.error === 'string'
        ? recordedBody.error
        : 'The file uploaded but could not be attached. Try attaching it again.'
    )
  }

  return recordedBody
}
