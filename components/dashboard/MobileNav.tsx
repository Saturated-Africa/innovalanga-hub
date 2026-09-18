'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { Menu } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/dashboard/sidebar'

/**
 * Mobile navigation.
 *
 * The dashboard previously had none: the sidebar was `hidden md:block` with no
 * drawer behind it, so below the `md` breakpoint there was no way to navigate
 * at all. This puts the same grouped nav behind a hamburger.
 */
export function MobileNav({
  trackers = [],
}: {
  trackers?: { key: string; shortLabel: string }[]
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Close on navigation, otherwise the drawer stays over the new page.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 border-white/10 p-0" hideClose>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <Sidebar onNavigate={() => setOpen(false)} trackers={trackers} />
      </SheetContent>
    </Sheet>
  )
}
