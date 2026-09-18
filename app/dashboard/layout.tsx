import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { resolveProgrammeId } from '@/lib/scope'
import { Sidebar } from '@/components/dashboard/sidebar'
import { MobileNav } from '@/components/dashboard/MobileNav'
import { NotificationBell } from '@/components/dashboard/NotificationBell'
import { AssistantLauncher } from '@/components/assistant/AssistantLauncher'
import { isAssistantEnabled } from '@/lib/ai/providers'
import { InnovalangaLogo } from '@/components/brand/Logo'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  // Only the dimensions this programme has switched on get a menu entry.
  const programmeId = await resolveProgrammeId(session)
  const trackers = programmeId
    ? await prisma.readinessDimension.findMany({
        where: { programmeId, enabled: true },
        orderBy: { order: 'asc' },
        select: { key: true, shortLabel: true },
      })
    : []

  const assistantEnabled = isAssistantEnabled()

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-64 shrink-0 md:block">
        <Sidebar trackers={trackers} />
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card px-4 sm:px-6">
          <MobileNav trackers={trackers} />

          {/* The mark stands in for the sidebar brand once it collapses. */}
          <InnovalangaLogo tone="ink" markClassName="h-6" className="h-6 md:hidden" />

          <div className="ml-auto flex items-center gap-1">
            {/* Hidden entirely when ANTHROPIC_API_KEY is unset, rather than
                offering a button that can only fail. */}
            {assistantEnabled && <AssistantLauncher />}
            <NotificationBell />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
