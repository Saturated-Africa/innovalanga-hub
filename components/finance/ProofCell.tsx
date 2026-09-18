'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
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
import { Loader2, Paperclip, Plus, Link2, Check, Ban } from 'lucide-react'
import { isAllowedUploadType, MAX_UPLOAD_BYTES } from '@/lib/uploads'

/**
 * Attach evidence to one transaction.
 *
 * Three requests, the same shape the rest of the platform uses: ask for a
 * signed URL, put the file straight into storage, then record it. The file
 * never passes through the application server.
 *
 * The link shown afterwards is the durable one that will sit beside this
 * transaction in the exported workbook. It is displayed here so an operator can
 * check it resolves before a funder receives it, which is the sort of thing
 * that is very cheap now and very expensive after filing.
 */

export interface ProofSummary {
  id: string
  kind: string
  filename: string
  shareToken: string
  revokedAt: string | null
}

const KINDS = [
  { value: 'Invoice', label: 'Invoice' },
  { value: 'ProofOfPayment', label: 'Proof of payment' },
  { value: 'BankStatement', label: 'Bank statement' },
  { value: 'Other', label: 'Other' },
] as const

const KIND_LABEL: Record<string, string> = Object.fromEntries(
  KINDS.map((k) => [k.value, k.label])
)

export function ProofCell({
  projectId,
  transactionId,
  proofs,
}: {
  projectId: string
  transactionId: string
  proofs: ProofSummary[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [kind, setKind] = useState<string>('ProofOfPayment')
  const [copied, setCopied] = useState<string | null>(null)

  const live = proofs.filter((p) => !p.revokedAt)

  async function upload(file: File) {
    setError('')

    if (!isAllowedUploadType(file.type)) {
      setError('That file type is not accepted. Use a PDF, an image, an Office file or a CSV.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`The limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`)
      return
    }

    setBusy(true)
    try {
      const signRes = await fetch('/api/finance/proofs/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
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

      const saveRes = await fetch('/api/finance/proofs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          transactionId,
          kind,
          filename: file.name,
          contentType: file.type,
          s3Key: signed.s3Key,
          sizeBytes: file.size,
        }),
      })
      const saved = await saveRes.json()
      if (!saveRes.ok) throw new Error(saved.error ?? 'Could not record the evidence.')

      toast({ title: 'Evidence attached' })
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/finance/proofs/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not revoke that link.')
      toast({
        title: 'Link revoked',
        description: 'The file is kept, but the link no longer opens.',
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
          {live.length > 0 ? (
            <>
              <Paperclip className="h-3 w-3" aria-hidden />
              {live.length}
            </>
          ) : (
            <>
              <Plus className="h-3 w-3" aria-hidden />
              attach
            </>
          )}
        </button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Evidence for this transaction</DialogTitle>
          <DialogDescription>
            Invoices, proof of payment and bank statements. Each one gets a link
            that goes into the exported workbook.
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
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {KIND_LABEL[p.kind] ?? p.kind}
                    {p.revokedAt ? ' · link revoked' : ''}
                  </p>
                </div>
                {!p.revokedAt && (
                  <div className="flex shrink-0 items-center gap-1">
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke(p.id)}
                      disabled={busy}
                      aria-label={`Revoke the link for ${p.filename}`}
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 border-t border-border pt-4">
          <div className="space-y-2">
            <Label htmlFor={`kind-${transactionId}`}>What is this?</Label>
            <select
              id={`kind-${transactionId}`}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`file-${transactionId}`}>File</Label>
            <input
              id={`file-${transactionId}`}
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
              Working…
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
