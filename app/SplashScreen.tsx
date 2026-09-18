'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { InnovalangaLogo } from '@/components/brand/Logo'

/**
 * The platform's entry screen.
 *
 * The root route used to be a bare `redirect('/dashboard')`, so the first thing
 * anyone saw was either a blank frame or the sign-in form, with no branded
 * moment at all for any role.
 *
 * The destination is resolved on the server from the session, so this component
 * never decides who may go where - it only holds the screen long enough to be
 * seen and then follows.
 *
 * Two things keep it from becoming a trap. It renders a real link, so the
 * journey completes with JavaScript disabled or if the navigation fails. And it
 * respects `prefers-reduced-motion`, where it skips the hold entirely rather
 * than animating at someone who has asked it not to.
 */

/** Long enough to register as deliberate, short enough not to feel like a wait. */
const HOLD_MS = 1100

export function SplashScreen({ destination }: { destination: string }) {
  const router = useRouter()
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (reduced) {
      router.replace(destination)
      return
    }

    const fade = setTimeout(() => setLeaving(true), HOLD_MS - 200)
    const go = setTimeout(() => router.replace(destination), HOLD_MS)

    return () => {
      clearTimeout(fade)
      clearTimeout(go)
    }
  }, [router, destination])

  return (
    <main
      className={`flex min-h-screen flex-col items-center justify-center bg-brand-ink px-6 transition-opacity duration-200 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* The mark and wordmark sit on ink, so the volt tone is correct here.
          Volt is optically light: it carries ink on top, never white. */}
      <InnovalangaLogo tone="volt" className="h-10 sm:h-12" markClassName="h-10 sm:h-12" />

      <p className="mt-8 max-w-md text-center text-xl font-bold leading-tight tracking-tight text-white sm:text-2xl">
        Innovation thrives where the sun rises.
      </p>

      {/* Three settling marks rather than a spinner. A spinner says "this is
          slow"; this says "we are arriving". */}
      <div className="mt-10 flex gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-brand-volt motion-safe:animate-pulse"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>

      {/* The screen reader announcement and the no-JavaScript escape hatch are
          the same element, so neither can be forgotten separately. */}
      <Link
        href={destination}
        className="mt-8 text-xs text-white/40 underline underline-offset-4 transition-colors hover:text-white/70 focus-visible:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-volt focus-visible:ring-offset-2 focus-visible:ring-offset-brand-ink"
      >
        Continue
      </Link>
    </main>
  )
}
