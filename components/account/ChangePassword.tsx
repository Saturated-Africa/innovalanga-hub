'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { Check, Eye, EyeOff, Loader2 } from 'lucide-react'
import { checkPassword, strength, MIN_LENGTH } from '@/lib/password-policy'

/**
 * Changing your own password.
 *
 * The rules are imported from the same module the endpoint uses, so what this
 * form says and what the server does cannot drift. The check here is for
 * immediate feedback only; the server decides, and it checks again.
 *
 * Problems are shown as you type rather than only on submit, and all of them at
 * once. Revealing one rule at a time turns choosing a password into a guessing
 * game against a form.
 */
export function ChangePassword({
  hasPassword,
  email,
  name,
  urgent,
}: {
  hasPassword: boolean
  email: string
  name: string
  urgent: boolean
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const verdict = next === '' ? null : checkPassword(next, { email, name })
  const mismatch = confirm !== '' && confirm !== next
  const ready =
    current !== '' && next !== '' && confirm === next && verdict?.acceptable === true

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'That could not be done.')

      setDone(true)
      setCurrent('')
      setNext('')
      setConfirm('')
      toast({
        title: 'Password changed',
        description: 'Use the new one next time you sign in.',
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!hasPassword) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Password</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This account signs in through an identity provider rather than with a
            password, so there is nothing to change here.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={urgent ? 'border-destructive/40' : undefined}>
      <CardHeader>
        <CardTitle className="text-base">Change your password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="max-w-md space-y-4">
          {error && (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          {done && (
            <p className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <Check className="h-4 w-4 shrink-0" aria-hidden />
              Changed. Anyone already signed in as this account stays signed in until
              their session expires.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="current">Current password</Label>
            <Input
              id="current"
              type={reveal ? 'text' : 'password'}
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Asked for even though you are signed in, so that an unattended screen is
              not enough to take the account over.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="next">New password</Label>
              <button
                type="button"
                onClick={() => setReveal((r) => !r)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {reveal ? (
                  <>
                    <EyeOff className="h-3 w-3" aria-hidden /> Hide
                  </>
                ) : (
                  <>
                    <Eye className="h-3 w-3" aria-hidden /> Show
                  </>
                )}
              </button>
            </div>
            <Input
              id="next"
              type={reveal ? 'text' : 'password'}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />

            {next !== '' && <Meter value={strength(next)} />}

            {verdict && !verdict.acceptable ? (
              <ul className="space-y-1 text-xs text-destructive">
                {verdict.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                At least {MIN_LENGTH} characters. A few ordinary words you will remember
                beat a short one full of symbols.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">New password again</Label>
            <Input
              id="confirm"
              type={reveal ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {mismatch && <p className="text-xs text-destructive">These do not match.</p>}
          </div>

          <Button type="submit" disabled={!ready || busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * How much work the password represents.
 *
 * Describes, never gates: the button is enabled by the rules, not by this. A
 * meter that blocks submission teaches people to pad a weak password until the
 * bar turns green.
 */
function Meter({ value }: { value: 'weak' | 'fair' | 'strong' }) {
  const filled = value === 'strong' ? 3 : value === 'fair' ? 2 : 1
  const tone =
    value === 'strong' ? 'bg-brand-volt-deep' : value === 'fair' ? 'bg-warning' : 'bg-destructive'

  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${i <= filled ? tone : 'bg-muted'}`}
          />
        ))}
      </div>
      <span className="text-xs capitalize text-muted-foreground">{value}</span>
    </div>
  )
}
