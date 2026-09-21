'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { isAllowedUploadType, MAX_UPLOAD_BYTES } from '@/lib/uploads'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'
import { Upload, Trash2, Download, Loader2, FileText } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { DocumentType } from '@prisma/client'

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  id_document: 'ID Document',
  cipc_registration: 'CIPC Registration Certificate',
  proof_of_address: 'Proof of Address',
  business_plan: 'Business Plan',
  pitch_deck: 'Pitch Deck',
  financial_statement: 'Financial Statement',
  progress_report: 'Progress Report',
  other: 'Other',
}

interface Document {
  id: string
  name: string
  type: DocumentType
  sizeBytes: number
  uploadedAt: Date | string
}

interface DocumentVaultProps {
  innovatorId: string
  documents: Document[]
  readonly?: boolean
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DocumentVault({ innovatorId, documents: initial, readonly = false }: DocumentVaultProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [documents, setDocuments] = useState(initial)
  const [uploading, setUploading] = useState(false)
  const [docType, setDocType] = useState<DocumentType>('other')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  async function handleUpload(file: File) {
    // Checked here for a useful message; the server enforces both the type and
    // the size regardless, since anything in the browser can be bypassed.
    if (!isAllowedUploadType(file.type)) {
      toast({
        title: 'That file type is not accepted',
        description: 'Upload a PDF, image, Office document, CSV or text file.',
        variant: 'destructive',
      })
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({
        title: 'File is too large',
        description: `The limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
        variant: 'destructive',
      })
      return
    }

    setUploading(true)

    // 1. Get presigned URL
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        innovatorId,
        sizeBytes: file.size,
      }),
    })

    if (!urlRes.ok) {
      setUploading(false)
      const body = await urlRes.json().catch(() => ({}))
      toast({
        title: 'Upload failed',
        description: body.error ?? 'Could not get upload URL.',
        variant: 'destructive',
      })
      return
    }

    const { url, s3Key } = await urlRes.json()

    // 2. PUT file to S3
    const s3Res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    })

    if (!s3Res.ok) {
      setUploading(false)
      toast({ title: 'Upload failed', description: 'File could not be uploaded.', variant: 'destructive' })
      return
    }

    // 3. Save document record
    const saveRes = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        innovatorId,
        type: docType,
        name: file.name,
        s3Key,
        sizeBytes: file.size,
      }),
    })

    setUploading(false)

    if (saveRes.ok) {
      const doc = await saveRes.json()
      setDocuments((prev) => [doc, ...prev])
      toast({ title: 'Document uploaded' })
      router.refresh()
    } else {
      toast({ title: 'Upload failed', description: 'File was uploaded but record could not be saved.', variant: 'destructive' })
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    if (res.ok) {
      setDocuments((prev) => prev.filter((d) => d.id !== id))
      toast({ title: 'Document removed' })
    } else {
      toast({ title: 'Failed to remove document', variant: 'destructive' })
    }
  }

  async function handleDownload(id: string, name: string) {
    setDownloadingId(id)
    const res = await fetch(`/api/documents/${id}`)
    setDownloadingId(null)
    if (res.ok) {
      const { url } = await res.json()
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.target = '_blank'
      a.click()
    } else {
      toast({ title: 'Failed to download', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      {!readonly && (
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as DocumentType)}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Uploading…</>
              : <><Upload className="mr-1.5 h-3.5 w-3.5" />Upload Document</>}
          </Button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleUpload(file)
              e.target.value = ''
            }}
          />
        </div>
      )}

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No documents uploaded yet.</p>
      ) : (
        <div className="divide-y divide-border rounded-md border">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{doc.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className="text-xs">{DOC_TYPE_LABELS[doc.type] ?? doc.type}</Badge>
                    <span className="text-xs text-muted-foreground">{formatSize(doc.sizeBytes)}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(doc.uploadedAt)}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleDownload(doc.id, doc.name)}
                  disabled={downloadingId === doc.id}
                >
                  {downloadingId === doc.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Download className="h-3.5 w-3.5" />}
                </Button>
                {!readonly && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(doc.id)}
                    disabled={deletingId === doc.id}
                  >
                    {deletingId === doc.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
