'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import {
  Banknote,
  BarChart3,
  BookOpen,
  Calendar,
  CalendarCog,
  ClipboardList,
  ClipboardSignature,
  HandCoins,
  Landmark,
  LayoutDashboard,
  LineChart,
  LogOut,
  Shield,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCog,
  Users,
  Users2,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { InnovalangaLogo } from '@/components/brand/Logo'
import { ROLE_LABELS, type UserRole } from '@/lib/auth'

/*
  The sidebar is the app's strongest brand surface, so it carries the charcoal
  shell the brand's own artwork is built on, with volt as the single accent.

  Two rules from the palette work are load-bearing here:
    1. The active item is volt with INK text. Volt has luminance 0.775 — the
       previous `bg-primary text-white` would have been a 1.27:1 failure.
    2. Volt never appears as body text. It is the mark, the active pill and the
       indicator rule; everything else is warm off-white on charcoal.
*/

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  roles: UserRole[]
}

interface NavGroup {
  label: string
  items: NavItem[]
}

/*
  Grouped rather than a single flat list. The old sidebar rendered 16
  undifferentiated links, which reads as generated scaffolding regardless of
  how it is styled.
*/
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        label: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
        roles: ['super_admin', 'facilitator', 'mentor'],
      },
    ],
  },
  {
    label: 'Programme',
    items: [
      {
        label: 'Beneficiaries',
        href: '/dashboard/beneficiaries',
        icon: ClipboardSignature,
        roles: ['super_admin', 'facilitator'],
      },
      {
        label: 'My Beneficiary Form',
        href: '/dashboard/innovator/beneficiary-form',
        icon: ClipboardSignature,
        roles: ['innovator'],
      },
      {
        label: 'Innovators',
        href: '/dashboard/innovators',
        icon: Users,
        roles: ['super_admin', 'facilitator'],
      },
      {
        label: 'Cohorts',
        href: '/dashboard/cohorts',
        icon: Users2,
        roles: ['super_admin', 'facilitator'],
      },
      {
        label: 'Assessments',
        href: '/dashboard/assessments',
        icon: ClipboardList,
        roles: ['super_admin', 'facilitator'],
      },
    ],
  },
  {
    label: 'Mentorship',
    items: [
      {
        label: 'Sessions',
        href: '/dashboard/sessions',
        icon: Calendar,
        roles: ['super_admin', 'mentor'],
      },
      {
        label: 'Mentorship Log',
        href: '/dashboard/mentorship',
        icon: BookOpen,
        roles: ['super_admin', 'facilitator', 'mentor'],
      },
      {
        label: 'Availability',
        href: '/dashboard/mentor/availability',
        icon: CalendarCog,
        roles: ['super_admin', 'mentor'],
      },
      {
        label: 'Session Types',
        href: '/dashboard/mentor/event-types',
        icon: Sparkles,
        roles: ['mentor'],
      },
      {
        label: 'My Sessions',
        href: '/dashboard/innovator/sessions',
        icon: Calendar,
        roles: ['innovator'],
      },
      {
        label: 'Book a Session',
        href: '/dashboard/book',
        icon: BookOpen,
        roles: ['innovator'],
      },
    ],
  },
  {
    label: 'Support',
    items: [
      {
        label: 'Stipends',
        href: '/dashboard/stipends',
        icon: Banknote,
        roles: ['super_admin', 'facilitator'],
      },
      {
        label: 'IP Protection',
        href: '/dashboard/ip',
        icon: Shield,
        roles: ['super_admin', 'facilitator'],
      },
      {
        label: 'IP Assessment',
        href: '/dashboard/innovator/ip',
        icon: Shield,
        roles: ['innovator'],
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        // Funds under management: a funder's capital, not this organisation's
        // own project budget. The two sit next to each other because an
        // operator thinks of them together, and are separate because they
        // answer different questions.
        label: 'Funds',
        href: '/dashboard/funds',
        icon: Landmark,
        roles: ['super_admin'],
      },
      {
        label: 'Grants',
        href: '/dashboard/grants',
        icon: HandCoins,
        roles: ['super_admin', 'facilitator', 'funder_viewer'],
      },
      {
        // The participant's own side of the same thing. Without this link the
        // page exists and nobody can find it, which is how reporting stops
        // happening and every grant reads as unaccounted for.
        label: 'My Grant',
        href: '/dashboard/innovator/grant',
        icon: HandCoins,
        roles: ['innovator'],
      },
      {
        label: 'Project Finance',
        href: '/dashboard/finance',
        icon: Wallet,
        roles: ['super_admin'],
      },
    ],
  },
  {
    label: 'Insight',
    items: [
      {
        label: 'M&E',
        href: '/dashboard/mande',
        icon: LineChart,
        roles: ['super_admin', 'facilitator', 'funder_viewer'],
      },
      {
        label: 'Reports',
        href: '/dashboard/reports',
        icon: BarChart3,
        roles: ['super_admin', 'facilitator', 'funder_viewer'],
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        label: 'Admin',
        href: '/dashboard/admin',
        icon: ShieldCheck,
        roles: ['super_admin'],
      },
    ],
  },
]

function isItemActive(pathname: string, href: string) {
  // `/dashboard` would otherwise match every child route.
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Sidebar({
  onNavigate,
  trackers = [],
}: {
  onNavigate?: () => void
  /**
   * Readiness dimensions this programme actually runs, resolved server-side.
   *
   * Hard-coding a link per dimension would put a dead entry in the sidebar of
   * any programme that disables one, and a visible link the router refuses is
   * the exact defect QA reported against the M&E menu item. Driving it from the
   * programme's own configuration means the menu cannot describe a page that
   * is not there.
   */
  trackers?: { key: string; shortLabel: string }[]
}) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined

  const trackerItems: NavItem[] = trackers.map((d) => ({
    label: `${d.shortLabel} Tracker`,
    href: `/dashboard/readiness/${d.key}`,
    icon: TrendingUp,
    roles: ['super_admin', 'facilitator', 'funder_viewer'],
  }))

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: (group.label === 'Programme'
      ? [...group.items, ...trackerItems]
      : group.items
    ).filter((item) => role && item.roles.includes(role)),
  })).filter((group) => group.items.length > 0)

  const initials = session?.user?.name
    ? session.user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '?'

  return (
    <div className="flex h-full flex-col bg-brand-ink text-white/70">
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center border-b border-white/10 px-5">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-volt"
        >
          <InnovalangaLogo
            tone="volt"
            markClassName="h-7"
            wordClassName="text-[15px]"
            className="h-7"
          />
          <span className="sr-only">Innovalanga Hub</span>
        </Link>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1 px-3 py-5">
        <nav className="space-y-6">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isItemActive(pathname, item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-volt',
                        active
                          ? // Ink on volt — the only legible pairing.
                            'bg-brand-volt text-brand-ink'
                          : 'text-white/65 hover:bg-white/[0.07] hover:text-white'
                      )}
                    >
                      <item.icon
                        className={cn('h-4 w-4 shrink-0', active && 'text-brand-ink')}
                        aria-hidden
                      />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* User */}
      <div className="shrink-0 border-t border-white/10 p-3">
        <div className="mb-2 flex items-center gap-3 px-2 py-1.5">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-brand-volt text-xs font-semibold text-brand-ink">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{session?.user?.name}</p>
            <p className="truncate text-xs text-white/45">
              {role ? ROLE_LABELS[role] : null}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-white/60 hover:bg-white/[0.07] hover:text-white"
          onClick={() => signOut({ callbackUrl: '/login' })}
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden />
          Sign out
        </Button>
        {/* Beside sign out, which is where people look for their own account
            rather than in a settings section they have to find. */}
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="w-full justify-start text-white/60 hover:bg-white/[0.07] hover:text-white"
        >
          <Link href="/dashboard/account">
            <UserCog className="mr-2 h-4 w-4" aria-hidden />
            Your account
          </Link>
        </Button>
      </div>
    </div>
  )
}
