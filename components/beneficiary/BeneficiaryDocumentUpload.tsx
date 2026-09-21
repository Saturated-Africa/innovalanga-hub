'use client'

import { useState } from 'react'
import { Loader2, Paperclip, Check } from 'lucide-react'

/**
 * Attaching a document to a beneficiary form.
 *
 * Deliberately small and dumb: the parent owns the record id and the upload call,
 * because the form can be rendered before the record exists. Until it has been
 * saved once there is nothing to attach to, and the parent is what knows that.
 *
 * Lists what is already attached rather than only offering to add. Somebody
 * capturing a form in person needs to see that the certificate went in, and the
 * absence of any feedback is how a facilitator asks for the same document twice.
 */
export interface AttachedDocument {
  id: string
  name: string
  type: string
}

export function BeneficiaryDocumentUpload({
  label,
  type,
  onUpload,
  uploaded,
  disabled,
}: {
  label: string
  /** DocumentType value, sent to the route as-is. */
  type: string
  onUpload: (type: string, file: File) => Promise<void>
  uploaded: AttachedDocument[]
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handle(file: File) {
    setBusy(true)
    setError('')
    try {
      await onUpload(type, file)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1.5 py-1">
      {uploaded.map((doc) => (
        <p key={doc.id} className="flex items-center gap-1.5 text-sm">
          <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
          <span className="truncate">{doc.name}</span>
        </p>
      ))}

      {!disabled && (
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Paperclip className="h-3.5 w-3.5" aria-hidden />
          )}
          {uploaded.length === 0 ? label : 'Replace it'}
          <input
            type="file"
            className="sr-only"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Cleared so the same file can be chosen twice.
              e.target.value = ''
              if (file) void handle(file)
            }}
          />
        </label>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
