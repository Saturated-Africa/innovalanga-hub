'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { AssistantPanel } from './AssistantPanel'

/**
 * Top-bar entry point for the assistant, with a Cmd/Ctrl-K shortcut.
 *
 * The panel is mounted only while open so the conversation resets between
 * sessions rather than persisting stale programme figures.
 */
export function AssistantLauncher() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2"
        aria-label="Open Langa, the programme assistant"
      >
        <Sparkles className="h-4 w-4 text-brand-volt-deep" aria-hidden />
        <span className="hidden sm:inline">Ask Langa</span>
        <kbd className="ml-1 hidden rounded border border-border bg-muted px-1.5 font-sans text-[10px] font-medium text-muted-foreground lg:inline">
          ⌘K
        </kbd>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="p-0" hideClose>
          {open && <AssistantPanel />}
        </SheetContent>
      </Sheet>
    </>
  )
}
