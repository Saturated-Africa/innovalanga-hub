'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { Loader2, Trash2 } from 'lucide-react'

export function DeleteUserButton({ userId, userName }: { userId: string; userName: string }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm(`Delete account for ${userName}? This cannot be undone.`)) return
    setDeleting(true)
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
    setDeleting(false)
    if (res.ok) {
      toast({ title: 'Account deleted' })
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      toast({ title: 'Failed to delete', description: data.error, variant: 'destructive' })
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-destructive hover:text-destructive"
      onClick={handleDelete}
      disabled={deleting}
    >
      {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </Button>
  )
}
