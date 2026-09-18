import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { InnovalangaLogo } from '@/components/brand/Logo'
import { Compass } from 'lucide-react'

/**
 * Branded 404.
 *
 * Next.js ships a stock not-found page - unstyled black text on white, no
 * navigation, no way back. Because the app never defined one, every mistyped
 * URL and every stale link dropped the user on that dead end. QA hit it on
 * four separate routes across three roles.
 *
 * This lives at the root so it covers marketing, auth and dashboard paths
 * alike. It deliberately offers a route home rather than a bare apology.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md space-y-8 text-center">
        <InnovalangaLogo tone="ink" className="mx-auto h-8 w-auto" />

        <div className="space-y-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-volt">
            <Compass className="h-6 w-6 text-brand-ink" aria-hidden />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            We can’t find that page
          </h1>
          <p className="text-sm text-muted-foreground">
            The link may be out of date, or the page may have moved. Nothing is
            wrong with your account.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
