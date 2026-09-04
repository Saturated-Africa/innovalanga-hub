import { NextResponse } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import { getSession } from '@/lib/auth'
import { getScopedContext } from '@/lib/scope'
import { toolsForContext, runTool } from '@/lib/ai/tools'
import { buildSystemPrompt } from '@/lib/ai/prompts'
import { getAnthropic, ASSISTANT_MODEL, ASSISTANT_MAX_TOKENS } from '@/lib/ai/client'

/*
  Node runtime, not Edge: this route reaches Prisma through the tool layer, and
  Prisma (along with bcryptjs and node:crypto elsewhere in the app) is Node-only.

  `maxDuration` matters — the platform default would cut a streamed answer off
  mid-sentence. `vercel.json` carries the matching function config.
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'The assistant is not configured. ANTHROPIC_API_KEY is not set.' },
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
  const history: Anthropic.MessageParam[] = incoming
    .slice(-20)
    .filter((m) => typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content.slice(0, 8000),
    }))

  if (history.length === 0 || history[0].role !== 'user') {
    return NextResponse.json({ error: 'Conversation must start with a user message' }, { status: 400 })
  }

  const ctx = await getScopedContext(session)
  const client = getAnthropic()
  const tools = toolsForContext(ctx)
  const system = buildSystemPrompt(ctx)

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      /** Server-sent event frame. */
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const messages: Anthropic.MessageParam[] = [...history]

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const response = await client.messages.stream({
            model: ASSISTANT_MODEL,
            max_tokens: ASSISTANT_MAX_TOKENS,
            thinking: { type: 'adaptive' },
            // The system prompt is stable per role, so it caches; the
            // conversation after it is the volatile part.
            system: [
              {
                type: 'text',
                text: system,
                cache_control: { type: 'ephemeral' },
              },
            ],
            tools,
            messages,
          })

          // Forward text as it is produced.
          response.on('text', (delta) => send('delta', { text: delta }))

          const final = await response.finalMessage()

          if (final.stop_reason !== 'tool_use') {
            send('usage', {
              inputTokens: final.usage.input_tokens,
              outputTokens: final.usage.output_tokens,
              cacheRead: final.usage.cache_read_input_tokens ?? 0,
              cacheWrite: final.usage.cache_creation_input_tokens ?? 0,
            })
            send('done', { stopReason: final.stop_reason })
            controller.close()
            return
          }

          // Execute every requested tool, then hand all results back in a
          // single user message — splitting them would suppress parallel calls.
          messages.push({ role: 'assistant', content: final.content })

          const toolUses = final.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
          )

          const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
            toolUses.map(async (block) => {
              send('tool', { name: block.name })
              const output = await runTool(
                block.name,
                (block.input ?? {}) as Record<string, unknown>,
                ctx
              )
              return {
                type: 'tool_result' as const,
                tool_use_id: block.id,
                content: JSON.stringify(output),
              }
            })
          )

          messages.push({ role: 'user', content: results })
        }

        // Ran out of rounds without a final answer.
        send('delta', {
          text: '\n\nI could not finish working that out. Could you narrow the question?',
        })
        send('done', { stopReason: 'max_rounds' })
        controller.close()
      } catch (err) {
        console.error('[assistant] stream failed:', err)
        send('error', {
          message:
            err instanceof Error && err.message === 'ANTHROPIC_API_KEY not set'
              ? 'The assistant is not configured.'
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
      // Stops proxies buffering the stream into one lump.
      'X-Accel-Buffering': 'no',
    },
  })
}
