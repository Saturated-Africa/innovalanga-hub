import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getScopedContext } from '@/lib/scope'
import { toolsForContext, runTool } from '@/lib/ai/tools'
import { buildSystemPrompt } from '@/lib/ai/prompts'
import {
  getProvider,
  isAssistantEnabled,
  ProviderUnavailableError,
  type ChatMessage,
} from '@/lib/ai/providers'
import {
  buildPseudonymMap,
  redactText,
  redactValue,
  EMPTY_MAP,
} from '@/lib/ai/pseudonymise'

/*
  Node runtime, not Edge: this route reaches Prisma through the tool layer, and
  Prisma (along with bcryptjs and node:crypto elsewhere) is Node-only.

  Self-hosted note: `maxDuration` below is a Vercel concept and is ignored by
  `next start`. Off Vercel the real ceiling is the reverse proxy, so Caddy must
  disable buffering and allow a long read timeout for this path. The
  `X-Accel-Buffering: no` header below covers nginx-style proxies.
*/
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Turns the agentic loop over at most this many times before giving up. */
const MAX_TOOL_ROUNDS = 6

interface IncomingMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isAssistantEnabled()) {
    return NextResponse.json(
      { error: 'The assistant is not configured on this deployment.' },
      { status: 503 }
    )
  }

  let body: { messages?: IncomingMessage[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const incoming = Array.isArray(body.messages) ? body.messages : []
  if (incoming.length === 0) {
    return NextResponse.json({ error: 'No messages supplied' }, { status: 400 })
  }

  // Bound the history so a long conversation cannot grow without limit.
  const history: ChatMessage[] = incoming
    .slice(-20)
    .filter((m) => typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content.slice(0, 8000),
    }))

  if (history.length === 0 || history[0].role !== 'user') {
    return NextResponse.json(
      { error: 'Conversation must start with a user message' },
      { status: 400 }
    )
  }

  const ctx = await getScopedContext(session)

  let provider
  try {
    provider = getProvider()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'No provider configured.' },
      { status: 503 }
    )
  }

  const tools = toolsForContext(ctx)
  const system = buildSystemPrompt(ctx)

  // Only pay for the roster lookup when the prompt actually leaves our network.
  const pseudonyms = provider.isRemote ? await buildPseudonymMap(ctx) : EMPTY_MAP

  // The user may have typed a real name; it must not reach a remote provider.
  const messages: ChatMessage[] = history.map((m) =>
    m.role === 'user' ? { ...m, content: redactText(m.content, pseudonyms) } : m
  )

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        )
      }

      // The browser reverses the mapping for display. Sent first so the panel
      // can rehydrate text as it streams.
      if (Object.keys(pseudonyms.toReal).length > 0) {
        send('pseudonyms', pseudonyms.toReal)
      }

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          let assistantText = ''
          const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = []
          let stopReason = 'end_turn'

          for await (const event of provider.streamTurn({ system, messages, tools })) {
            if (event.type === 'text') {
              assistantText += event.text
              send('delta', { text: event.text })
            } else if (event.type === 'tool_call') {
              toolCalls.push(event.call)
            } else {
              stopReason = event.stopReason
              send('usage', { ...event.usage, provider: provider.id, model: provider.model })
            }
          }

          if (toolCalls.length === 0) {
            send('done', { stopReason })
            controller.close()
            return
          }

          messages.push({ role: 'assistant', content: assistantText, toolCalls })

          // Run the requested tools in parallel, then append every result.
          const results = await Promise.all(
            toolCalls.map(async (call) => {
              send('tool', { name: call.name })
              const output = await runTool(call.name, call.input, ctx)
              return {
                role: 'tool' as const,
                toolCallId: call.id,
                name: call.name,
                // Redact BEFORE serialising: this is the point where real names
                // would otherwise be handed to a remote model.
                content: JSON.stringify(redactValue(output, pseudonyms)),
              }
            })
          )

          messages.push(...results)
        }

        send('delta', {
          text: '\n\nI could not finish working that out. Could you narrow the question?',
        })
        send('done', { stopReason: 'max_rounds' })
        controller.close()
      } catch (err) {
        console.error('[assistant] stream failed:', err)
        send('error', {
          message:
            err instanceof ProviderUnavailableError
              ? err.message
              : 'Something went wrong reaching the assistant. Please try again.',
        })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
