'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Users2,
  Calendar,
  BookOpen,
  DollarSign,
  BarChart3,
  Settings,
  LogOut,
  Zap,
  ShieldCheck,
  LineChart,
  Shield,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import type { UserRole } from '@/lib/auth'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  roles: UserRole[]
}

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    roles: ['super_admin', 'facilitator', 'mentor'],
  },
  {
    label: 'Innovators',
    href: '/dashboard/innovators',
    icon: Users,
    roles: ['super_admin', 'facilitator'],
  },
  {
    label: 'Assessments',
    href: '/dashboard/assessments',
    icon: ClipboardList,
    roles: ['super_admin', 'facilitator'],
  },
  {
    label: 'Cohorts',
    href: '/dashboard/cohorts',
    icon: Users2,
    roles: ['super_admin', 'facilitator'],
  },
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
    icon: Settings,
    roles: ['super_admin', 'mentor'],
  },
  {
    label: 'Session Types',
    href: '/dashboard/mentor/event-types',
    icon: Zap,
    roles: ['mentor'],
  },
  {
    label: 'Stipends',
    href: '/dashboard/stipends',
    icon: DollarSign,
    roles: ['super_admin', 'facilitator'],
  },
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
  {
    label: 'IP Protection',
    href: '/dashboard/ip',
    icon: Shield,
    roles: ['super_admin', 'facilitator'],
  },
  {
    label: 'Admin',
    href: '/dashboard/admin',
    icon: ShieldCheck,
    roles: ['super_admin'],
  },
  // Innovator-only
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
  {
    label: 'IP Assessment',
    href: '/dashboard/innovator/ip',
    icon: Shield,
    roles: ['innovator'],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined

  const visibleItems = navItems.filter((item) => role && item.roles.includes(role))

  const initials = session?.user?.name
    ? session.user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <div className="flex h-full flex-col border-r bg-white">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2 px-4 border-b">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Zap className="h-4 w-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold">Innovalanga Hub</p>
          <p className="text-xs text-muted-foreground">Innovation Platform</p>
        </div>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1 px-2 py-4">
        <nav className="space-y-1">
          {visibleItems.map((item) => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href)
            return (
              <Link key={item.href} href={item.href}>
                <span
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </span>
              </Link>
            )
          })}
        </nav>
      </ScrollArea>

      {/* User */}
      <div className="border-t p-4">
        <Separator className="mb-4" />
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{session?.user?.name}</p>
            <p className="text-xs text-muted-foreground truncate capitalize">
              {role?.replace('_', ' ')}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={() => signOut({ callbackUrl: '/login' })}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  )
}
