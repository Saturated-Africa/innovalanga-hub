import { MAX_UPLOAD_BYTES, isAllowedUploadType } from '@/lib/uploads'

/**
 * Sending a piece of financial evidence: presign, PUT to storage, then record it.
 *
 * Shared by both kinds of grant proof - how money was spent, and that it was
 * paid out - because they differ only in the route they talk to. Two copies of
 * this would drift, and the half that drifted would be the error handling, which
 * is the part that matters when a receipt silently fails to attach.
 *
 * The middle step goes straight to S3 without touching the app, so a 20 MiB
 * photograph never occupies the request path of the single process serving every
 * page.
 *
 * The checks here are a courtesy, not the enforcement. The routes check the same
 * things and are the only authority; these exist so somebody picking a 40 MiB
 * file is told immediately rather than after waiting for the upload to fail.
 */

export class ProofUploadError extends Error {}

export interface UploadedProof {
  id: string
  filename: string
  shareToken: string
}

/**
 * @param base The route that handles both verbs: POST presigns, PUT records.
 */
export async function uploadProof(base: string, file: File): Promise<UploadedProof> {
  if (file.size === 0) {
    throw new ProofUploadError('That file is empty.')
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))
    throw new ProofUploadError(`Files have to be under ${mb} MB.`)
  }
  if (!isAllowedUploadType(file.type)) {
    throw new ProofUploadError(
      'That file type cannot be uploaded. Use a PDF or a photo of the document.'
    )
  }

  const describe = {
    filename: file.name,
    contentType: file.type,
    sizeBytes: file.size,
  }

  const presigned = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(describe),
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

  // The storage path the presign step issued, sent back so the record step can
  // check it is one this server built. It is a path, not a credential - the
  // secret scanner sees a key-shaped name with a high entropy value and cannot
  // tell the difference.
  const storagePath = presignedBody.s3Key // gitleaks:allow

  const recorded = await fetch(base, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...describe, s3Key: storagePath }),
  })
  const recordedBody = await recorded.json()
  if (!recorded.ok) {
    // The object is in storage but nothing points at it. Saying so matters: the
    // alternative is evidence somebody believes was filed.
    throw new ProofUploadError(
      typeof recordedBody.error === 'string'
        ? recordedBody.error
        : 'The file uploaded but could not be attached. Try attaching it again.'
    )
  }

  return recordedBody
}

/** Evidence of what a participant spent grant money on. */
export function uploadExpenseProof(
  grantId: string,
  expenditureId: string,
  file: File
): Promise<UploadedProof> {
  return uploadProof(`/api/grants/${grantId}/expenditures/${expenditureId}/proof`, file)
}

/** Evidence that a tranche was actually paid out. */
export function uploadTrancheProof(
  grantId: string,
  trancheId: string,
  file: File
): Promise<UploadedProof> {
  return uploadProof(`/api/grants/${grantId}/tranches/${trancheId}/proof`, file)
}
