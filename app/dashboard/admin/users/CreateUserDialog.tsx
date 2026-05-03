'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/hooks/use-toast'
import { Loader2 } from 'lucide-react'

type Role = 'super_admin' | 'facilitator' | 'mentor'

export function CreateUserDialog({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('facilitator')
  const [expertise, setExpertise] = useState('')
  const [bio, setBio] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')

  function reset() {
    setName(''); setEmail(''); setPassword(''); setRole('facilitator')
    setExpertise(''); setBio(''); setPhone(''); setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const body: Record<string, unknown> = { name, email, password, role }
    if (role === 'mentor') {
      const parts = name.trim().split(' ')
      body.firstName = parts[0]
      body.lastName = parts.slice(1).join(' ') || parts[0]
      body.expertise = expertise.split(',').map((s) => s.trim()).filter(Boolean)
      body.bio = bio || undefined
      body.phone = phone || undefined
    }

    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)

    if (res.ok) {
      toast({ title: `${role.replace('_', ' ')} account created` })
      reset()
      setOpen(false)
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Failed to create user.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Role</Label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="facilitator">Facilitator</option>
              <option value="mentor">Mentor</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Full Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Thabo Nkosi" required />
          </div>

          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="thabo@example.com" required />
          </div>

          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" minLength={8} required />
          </div>

          {role === 'mentor' && (
            <>
              <Separator />
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Mentor profile</p>

              <div className="space-y-1.5">
                <Label>Phone (optional)</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+27 / 0XX XXX XXXX" />
              </div>

              <div className="space-y-1.5">
                <Label>Areas of Expertise</Label>
                <Input value={expertise} onChange={(e) => setExpertise(e.target.value)} placeholder="e.g. Finance, Marketing, Tech (comma separated)" />
              </div>

              <div className="space-y-1.5">
                <Label>Bio (optional)</Label>
                <Input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Short bio for innovators to see" />
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Creating…</> : 'Create Account'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
