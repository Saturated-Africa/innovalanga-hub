'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/hooks/use-toast'
import { ChevronDown, Loader2 } from 'lucide-react'

/**
 * Moving a grant along its lifecycle.
 *
 * The states offered come from the same transition table the API checks against,
 * passed in from the server, so the menu can never offer a move that is about to
 * be refused.
 *
 * A Draft grant is called out rather than left as a quiet badge: nothing can be
 * paid from a Draft grant, and an award sitting in Draft looks finished to
 * everyone except the payment screen.
 */

const WORDING: Record<string, string> = {
  Approved: 'Approve it',
  Active: 'Activate it',
  Draft: 'Send back to draft',
  Suspended: 'Suspend it',
  Completed: 'Mark it completed',
  Cancelled: 'Cancel it',
}

export function GrantStatusControl({
  grantId,
  status,
  options,
  canChange,
}: {
  grantId: string
  status: string
  options: string[]
  canChange: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function change(to: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/grants/${grantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: to }),
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'That could not be done.'
        )
      }
      toast({ title: `Grant is now ${String(body.status).toLowerCase()}` })
      router.refresh()
    } catch (err) {
      toast({ title: (err as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const badge = (
    <Badge variant={status === 'Active' ? 'default' : 'secondary'}>{status}</Badge>
  )

  if (!canChange || options.length === 0) return badge

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : null}
          {status}
          <ChevronDown className="ml-1.5 h-3.5 w-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((to) => (
          <DropdownMenuItem key={to} onClick={() => change(to)}>
            {WORDING[to] ?? to}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
