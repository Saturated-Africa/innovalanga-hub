/**
 * What may be uploaded, and under what name.
 *
 * The presign route used to accept any `contentType` the client sent and derive
 * the stored file extension from the client's own filename. That let an account
 * store `.html` or `.svg` on the bucket and have S3 serve it back with an active
 * content type, from the same origin as presigned document downloads. There was
 * no size limit either, so a single request could be pointed at an arbitrarily
 * large body.
 *
 * The extension is derived from the allowlist rather than the filename, so a
 * stored object's name can never disagree with the type it was approved as.
 */

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 // 20 MiB

/** Content types a programme document may legitimately be. */
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'text/plain': 'txt',
}

export function isAllowedUploadType(contentType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_UPLOAD_TYPES, contentType)
}

/** Extension for an approved content type. Never taken from the filename. */
export function extensionFor(contentType: string): string {
  return ALLOWED_UPLOAD_TYPES[contentType] ?? 'bin'
}

/**
 * Strip anything from a display name that could be read as a path, as a header
 * continuation, or as markup.
 *
 * This is the name shown in the UI and echoed in Content-Disposition. It never
 * reaches the storage key, which is built entirely from server-held values.
 *
 * Control characters are filtered by code point rather than by a regex, so the
 * source file stays plain printable ASCII.
 */
export function safeDisplayName(filename: string): string {
  const withoutSeparators = filename.replace(/[\\/]/g, '-').replace(/["<>]/g, '')

  const printable = Array.from(withoutSeparators)
    .filter((ch) => {
      const code = ch.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')

  return printable.trim().slice(0, 255) || 'document'
}

/**
 * Build the storage key for an approved upload.
 *
 * Every part is server-controlled: the innovator id we authorised, a random
 * id, and an extension from the allowlist. Nothing the client sent is used.
 */
export function buildDocumentKey(
  innovatorId: string,
  uuid: string,
  contentType: string
): string {
  return `innovators/${innovatorId}/documents/${uuid}.${extensionFor(contentType)}`
}

/**
 * Storage key for a piece of financial evidence.
 *
 * Separate from the participant document key because these belong to a project
 * rather than a person. The same allowlist and the same extension rule apply:
 * every part of the key is server-decided, and the client's filename is used
 * only as a display name.
 */
export function buildFinanceProofKey(
  projectId: string,
  uuid: string,
  contentType: string
): string {
  return `finance/${projectId}/proof/${uuid}.${extensionFor(contentType)}`
}

/**
 * Storage key for proof of a stipend payment.
 *
 * Deliberately under the same `finance/` prefix as project evidence. The
 * instance role is granted that prefix and nothing wider, and widening it means
 * deploying the stack that holds the instance - which replaces the instance
 * whenever AWS has published a newer image. A new prefix would cost an outage
 * to gain nothing: this is financial evidence either way.
 */
export function buildStipendProofKey(
  stipendRecordId: string,
  uuid: string,
  contentType: string
): string {
  return `finance/stipends/${stipendRecordId}/proof/${uuid}.${extensionFor(contentType)}`
}

/**
 * Storage key for proof of how grant money was spent.
 *
 * Under the same `finance/` prefix as everything else, for the reason given
 * above: the instance role is granted that prefix and nothing wider, and
 * widening it means deploying the stack that holds the instance, which replaces
 * the instance whenever AWS has published a newer image. A new prefix would buy
 * an outage and nothing else.
 *
 * Keyed by the expenditure rather than the grant so that deleting one reported
 * expense cannot orphan another's receipt.
 */
export function buildGrantProofKey(
  expenditureId: string,
  uuid: string,
  contentType: string
): string {
  return `finance/grants/${expenditureId}/proof/${uuid}.${extensionFor(contentType)}`
}

/**
 * Storage key for proof that a tranche was actually paid.
 *
 * The counterpart to buildGrantProofKey: that one evidences how grant money was
 * spent, this one evidences it leaving. A funder reconciling disbursements asks
 * for this side first, because it is their money going out.
 *
 * Keyed by the tranche, under the same `finance/` prefix the instance role is
 * granted - see buildStipendProofKey for why widening that prefix is expensive.
 */
export function buildTrancheProofKey(
  trancheId: string,
  uuid: string,
  contentType: string
): string {
  return `finance/tranches/${trancheId}/proof/${uuid}.${extensionFor(contentType)}`
}

/**
 * Storage key for a document collected against a beneficiary form.
 *
 * Under `beneficiaries/` rather than `innovators/`, because at the moment of
 * upload there is no participant: an ID copy and a CIPC certificate are handed
 * over while the form is being captured, and acceptance may never come. Keying by
 * the record means a withdrawn form's documents are identifiable and removable
 * without hunting for them.
 *
 * The object is not moved when the person becomes a participant. Copying files to
 * make a path prettier is how you end up with two objects and one row.
 */
export function buildBeneficiaryDocumentKey(
  beneficiaryRecordId: string,
  uuid: string,
  contentType: string
): string {
  return `beneficiaries/${beneficiaryRecordId}/documents/${uuid}.${extensionFor(contentType)}`
}
