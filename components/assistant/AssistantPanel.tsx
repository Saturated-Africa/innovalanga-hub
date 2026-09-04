'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { ArrowUp, Loader2, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SheetClose, SheetTitle } from '@/components/ui/sheet'
import { InnovalangaMark } from '@/components/brand/Logo'
import { SUGGESTIONS } from '@/lib/ai/prompts'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/lib/auth'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Human-readable labels for the tool-call ticker. */
const TOOL_LABELS: Record<string, string> = {
  get_programme_overview: 'Reading programme setup',
  explain_readiness_level: 'Checking readiness levels',
  list_innovators: 'Looking up participants',
  get_innovator_detail: 'Reading the record',
  list_sessions: 'Checking sessions',
  get_programme_kpis: 'Pulling programme figures',
  get_mande_summary: 'Reading M&E data',
  get_stipend_summary: 'Checking stipends',
}

export function AssistantPanel() {
  const { data: session } = useSession()
  const role = (session?.user?.role as UserRole) ?? 'innovator'

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [activity, setActivity] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // token -> real name. The server pseudonymises before sending anything to a
  // remote model; the reader is already authorised to see these names, so the
  // reversal happens here rather than in the stream (which would have to cope
  // with a token split across two chunks).
  const [pseudonyms, setPseudonyms] = useState<Record<string, string>>({})

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the newest content in view as it streams.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, activity])

  useEffect(() => () => abortRef.current?.abort(), [])

  const send = useCallback(
    async (text: string) => {
      const question = text.trim()
      if (!question || streaming) return

      setError(null)
      setInput('')
      setStreaming(true)
      setActivity('Thinking')

      const next: ChatMessage[] = [...messages, { role: 'user', content: question }]
      setMessages([...next, { role: 'assistant', content: '' }])

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: next }),
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          const payload = await res.json().catch(() => null)
          throw new Error(payload?.error ?? 'The assistant is unavailable.')
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        // Parse the SSE frames the route emits.
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''

          for (const frame of frames) {
            const eventLine = frame.split('\n').find((l) => l.startsWith('event: '))
            const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
            if (!eventLine || !dataLine) continue

            const event = eventLine.slice(7).trim()
            let data: Record<string, unknown> = {}
            try {
              data = JSON.parse(dataLine.slice(6))
            } catch {
              continue
            }

            if (event === 'delta' && typeof data.text === 'string') {
              setActivity(null)
              const chunk = data.text
              setMessages((prev) => {
                const copy = [...prev]
                const last = copy[copy.length - 1]
                if (last?.role === 'assistant') {
                  copy[copy.length - 1] = { ...last, content: last.content + chunk }
                }
                return copy
              })
            } else if (event === 'pseudonyms') {
              setPseudonyms(data as Record<string, string>)
            } else if (event === 'tool' && typeof data.name === 'string') {
              setActivity(TOOL_LABELS[data.name] ?? 'Looking that up')
            } else if (event === 'error') {
              setError(typeof data.message === 'string' ? data.message : 'Something went wrong.')
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message || 'Something went wrong.')
        }
      } finally {
        setStreaming(false)
        setActivity(null)
        abortRef.current = null
        // Drop a trailing empty assistant turn if nothing arrived.
        setMessages((prev) =>
          prev.length && prev[prev.length - 1].role === 'assistant' && !prev[prev.length - 1].content
            ? prev.slice(0, -1)
            : prev
        )
      }
    },
    [messages, streaming]
  )

  /** Swap pseudonym tokens back to real names for display. */
  const rehydrate = useCallback(
    (text: string) => {
      let out = text
      for (const token of Object.keys(pseudonyms).sort((a, b) => b.length - a.length)) {
        out = out.split(token).join(pseudonyms[token])
      }
      return out
    },
    [pseudonyms]
  )

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-ink">
          <InnovalangaMark className="h-4 text-brand-volt" />
        </span>
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-sm font-semibold">Langa</SheetTitle>
          <p className="text-xs text-muted-foreground">Reads your data · drafts your words</p>
        </div>
        <SheetClose asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Close assistant">
            <X className="h-4 w-4" />
          </Button>
        </SheetClose>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {isEmpty ? (
          <div className="pt-6">
            <p className="text-sm font-medium">What can I help with?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              I can only read what your role already gives you access to, and I can’t change
              anything.
            </p>
            <div className="mt-4 space-y-2">
              {(SUGGESTIONS[role] ?? SUGGESTIONS.innovator).map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg rounded-br-sm bg-brand-ink px-3 py-2 text-sm text-white">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-brand-ink">
                  <InnovalangaMark className="h-3 text-brand-volt" />
                </span>
                <div className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {rehydrate(m.content)}
                  {streaming && i === messages.length - 1 && !m.content && (
                    <span className="text-muted-foreground">…</span>
                  )}
                </div>
              </div>
            )
          )
        )}

        {activity && (
          <div className="flex items-center gap-2 pl-8 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            {activity}…
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border p-3">
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the programme, or paste notes to tidy up…"
            aria-label="Message Langa"
            rows={2}
            className="max-h-40 resize-none pr-11"
          />
          <div className="absolute bottom-2 right-2">
            {streaming ? (
              <Button
                size="icon"
                variant="secondary"
                className="h-7 w-7"
                aria-label="Stop"
                onClick={() => abortRef.current?.abort()}
              >
                <Square className="h-3 w-3" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-7 w-7"
                aria-label="Send"
                disabled={!input.trim()}
                onClick={() => void send(input)}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        <p className={cn('mt-2 text-[11px] leading-snug text-muted-foreground')}>
          Langa can read programme data and draft text. It cannot make changes — always check
          figures before they go out.
        </p>
      </div>
    </div>
  )
}
