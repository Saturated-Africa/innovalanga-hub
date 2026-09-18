'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { Loader2, Paperclip, Plus, Link2, Check } from 'lucide-react'
import { isAllowedUploadType, MAX_UPLOAD_BYTES } from '@/lib/uploads'

/**
 * Proof of payment for one stipend.
 *
 * Attaching evidence also records the payment. A proof of payment sitting
 * against a stipend the register still shows as unpaid is a contradiction
 * somebody has to resolve later, so the two happen together.
 *
 * The date of payment is asked for rather than assumed, because a transfer made
 * on Friday is frequently captured on Monday and the funder's report cares
 * about when the money moved.
 */

export interface StipendProof {
  id: string
  filename: string
  shareToken: string
}

export function StipendProofButton({
  stipendId,
  innovator,
  proofs,
  paidAt,
}: {
  stipendId: string
  innovator: string
  proofs: StipendProof[]
  paidAt: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [paidOn, setPaidOn] = useState('')
  const [reference, setReference] = useState('')

  async function upload(file: File) {
    setError('')

    if (!isAllowedUploadType(file.type)) {
      setError('Use a PDF, an image, an Office file or a CSV.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`The limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`)
      return
    }

    setBusy(true)
    try {
      const signRes = await fetch(`/api/stipends/${stipendId}/proof?step=sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        }),
      })
      const signed = await signRes.json()
      if (!signRes.ok) throw new Error(signed.error ?? 'Could not prepare the upload.')

      const put = await fetch(signed.url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!put.ok) throw new Error('The file could not be uploaded.')

      const saveRes = await fetch(`/api/stipends/${stipendId}/proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'ProofOfPayment',
          filename: file.name,
          contentType: file.type,
          s3Key: signed.s3Key,
          sizeBytes: file.size,
          paidAt: paidOn || undefined,
          paymentReference: reference || undefined,
        }),
      })
      const saved = await saveRes.json()
      if (!saveRes.ok) throw new Error(saved.error ?? 'Could not record the evidence.')

      toast({
        title: 'Proof attached',
        description: paidAt ? undefined : 'The stipend is now marked as paid.',
      })
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {proofs.length > 0 ? (
            <>
              <Paperclip className="h-3 w-3" aria-hidden />
              {proofs.length}
            </>
          ) : (
            <>
              <Plus className="h-3 w-3" aria-hidden />
              proof
            </>
          )}
        </button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Proof of payment</DialogTitle>
          <DialogDescription>
            Evidence that {innovator}&rsquo;s stipend was paid.
            {paidAt ? ` Recorded as paid on ${paidAt}.` : ' Attaching proof marks it paid.'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {proofs.length > 0 && (
          <div className="space-y-2">
            {proofs.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="truncate">{p.filename}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const url = `${window.location.origin}/proof/${p.shareToken}`
                    navigator.clipboard
                      ?.writeText(url)
                      .then(() => {
                        setCopied(p.id)
                        setTimeout(() => setCopied(null), 2000)
                      })
                      .catch(() => toast({ title: 'Could not copy', variant: 'destructive' }))
                  }}
                >
                  {copied === p.id ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 border-t border-border pt-4">
          {!paidAt && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`paid-${stipendId}`}>Date paid</Label>
                <Input
                  id={`paid-${stipendId}`}
                  type="date"
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  When the money moved. Today if left blank.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`ref-${stipendId}`}>Payment reference</Label>
                <Input
                  id={`ref-${stipendId}`}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Bank reference"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={`file-${stipendId}`}>File</Label>
            <input
              id={`file-${stipendId}`}
              type="file"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) upload(file)
                e.target.value = ''
              }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
            />
          </div>

          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Uploading…
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
