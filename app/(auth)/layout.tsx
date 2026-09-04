import { InnovalangaLogo, InnovalangaMark } from '@/components/brand/Logo'

/**
 * Shared auth shell.
 *
 * This layout was previously a no-op pass-through, so `login` and `register`
 * each reimplemented their own full-screen centring and branding — with
 * different backgrounds (a blue gradient vs. flat grey). The brand panel now
 * lives here once.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Brand panel */}
      <div className="relative flex shrink-0 flex-col justify-between overflow-hidden bg-brand-ink px-6 py-8 lg:w-[46%] lg:px-14 lg:py-14">
        {/*
          The mark used as a graphic device, the way the brand's own collateral
          does. Sized so the whole bolt reads — cropping it much harder turns
          the two blocks into an anonymous diagonal band.
        */}
        <InnovalangaMark
          aria-hidden
          className="pointer-events-none absolute -right-8 bottom-10 hidden h-[55%] text-brand-volt/[0.06] lg:block"
        />

        <div className="relative">
          <InnovalangaLogo
            tone="volt"
            className="h-9 lg:h-11"
            markClassName="h-9 lg:h-11"
            wordClassName="text-lg lg:text-xl"
          />
        </div>

        <div className="relative mt-8 lg:mt-0">
          <p className="max-w-md text-2xl font-bold leading-[1.15] tracking-tight text-white lg:text-4xl">
            Where the sun rises on African innovation.
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/55 lg:mt-6">
            Readiness tracking, mentorship and programme reporting for innovators across
            Mpumalanga and the Free State.
          </p>
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-volt lg:mt-10">
            Proudly African · Tech-oriented · Future-focused
          </p>
        </div>

        <p className="relative mt-8 hidden text-xs text-white/30 lg:block">
          An initiative of Saturated Africa
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center bg-background px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  )
}
