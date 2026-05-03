'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/hooks/use-toast'

const ROLES = ['super_admin', 'facilitator', 'mentor', 'innovator', 'funder_viewer'] as const
type Role = typeof ROLES[number]

const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  facilitator: 'Facilitator',
  mentor: 'Mentor',
  innovator: 'Innovator',
  funder_viewer: 'Funder Viewer',
}

export function UserRoleSelect({
  userId,
  currentRole,
  isSelf,
}: {
  userId: string
  currentRole: Role
  isSelf: boolean
}) {
  const router = useRouter()
  const [role, setRole] = useState(currentRole)
  const [saving, setSaving] = useState(false)

  async function handleChange(newRole: Role) {
    if (newRole === role) return
    setSaving(true)
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    })
    setSaving(false)
    if (res.ok) {
      setRole(newRole)
      toast({ title: 'Role updated' })
      router.refresh()
    } else {
      toast({ title: 'Failed to update role', variant: 'destructive' })
    }
  }

  if (isSelf) {
    return (
      <span className="text-sm capitalize text-muted-foreground">
        {ROLE_LABELS[role]} (you)
      </span>
    )
  }

  return (
    <select
      value={role}
      disabled={saving}
      onChange={(e) => handleChange(e.target.value as Role)}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50 capitalize"
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
      ))}
    </select>
  )
}
