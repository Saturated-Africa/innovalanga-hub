/**
 * Ollama protocol translation tests.
 *
 * The self-hosted path is not deployed yet, so this adapter has never met a
 * real model. These tests cover the parts most likely to be silently wrong:
 * the message/tool shape translation, and the newline-delimited JSON parser
 * that has to survive a chunk boundary landing mid-object.
 *
 * Run:  npm run test:ollama
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createNdjsonParser,
  parseArgs,
  toOllamaMessages,
  toOllamaTools,
  type ProtocolMessage,
} from './ai/providers/ollama-protocol.ts'

test('tools are translated to the OpenAI-style function shape', () => {
  const out = toOllamaTools([
    {
      name: 'list_innovators',
      description: 'List participants',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
    },
  ])
  assert.deepEqual(out, [
    {
      type: 'function',
      function: {
        name: 'list_innovators',
        description: 'List participants',
        parameters: { type: 'object', properties: { limit: { type: 'integer' } } },
      },
    },
  ])
})

test('the system prompt becomes the first message, not a top-level field', () => {
  const out = toOllamaMessages('You are Langa.', [{ role: 'user', content: 'Hi' }])
  assert.equal(out[0].role, 'system')
  assert.equal(out[0].content, 'You are Langa.')
  assert.equal(out[1].role, 'user')
})

test('tool results are keyed by tool NAME, since Ollama has no call id', () => {
  const messages: ProtocolMessage[] = [
    { role: 'user', content: 'How many participants?' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_1', name: 'get_programme_kpis', input: {} }],
    },
    {
      role: 'tool',
      toolCallId: 'call_1',
      name: 'get_programme_kpis',
      content: '{"totalParticipants":5}',
    },
  ]
  const out = toOllamaMessages('sys', messages)

  const assistant = out[2] as Record<string, unknown>
  assert.deepEqual(assistant.tool_calls, [
    { function: { name: 'get_programme_kpis', arguments: {} } },
  ])

  const toolMsg = out[3] as Record<string, unknown>
  assert.equal(toolMsg.role, 'tool')
  assert.equal(toolMsg.tool_name, 'get_programme_kpis')
  // The Anthropic-style id must NOT be sent — Ollama would ignore or reject it.
  assert.ok(!('tool_call_id' in toolMsg))
})

test('an assistant turn with no tool calls omits the tool_calls key entirely', () => {
  const out = toOllamaMessages('sys', [{ role: 'assistant', content: 'Hello' }])
  assert.ok(!('tool_calls' in (out[1] as Record<string, unknown>)))
})

test('tool arguments parse from both an object and a JSON string', () => {
  assert.deepEqual(parseArgs({ name: 'x', arguments: { limit: 5 } }), { limit: 5 })
  assert.deepEqual(parseArgs({ name: 'x', arguments: '{"limit":5}' }), { limit: 5 })
})

test('malformed tool arguments yield {} rather than throwing', () => {
  // One bad tool call must not kill the whole stream.
  assert.deepEqual(parseArgs({ name: 'x', arguments: '{not json' }), {})
  assert.deepEqual(parseArgs({ name: 'x', arguments: '"a string"' }), {})
  assert.deepEqual(parseArgs(undefined), {})
})

test('the NDJSON parser survives an object split across chunk boundaries', () => {
  const parser = createNdjsonParser()

  // A network chunk can end anywhere, including mid-object.
  assert.deepEqual(parser.push('{"message":{"content":"Hel'), [])
  const first = parser.push('lo"}}\n{"message":{"content":" world"}}\n')
  assert.equal(first.length, 2)
  assert.equal(first[0].message?.content, 'Hello')
  assert.equal(first[1].message?.content, ' world')
})

test('the final done frame is not dropped when it arrives without a trailing newline', () => {
  const parser = createNdjsonParser()
  parser.push('{"message":{"content":"hi"}}\n')
  // Ollama's last line frequently has no trailing newline. Dropping it would
  // lose the token counts and the stop reason.
  assert.deepEqual(parser.push('{"done":true,"done_reason":"stop","eval_count":42}'), [])
  const flushed = parser.flush()
  assert.equal(flushed.length, 1)
  assert.equal(flushed[0].done, true)
  assert.equal(flushed[0].eval_count, 42)
})

test('malformed lines are skipped without aborting the stream', () => {
  const parser = createNdjsonParser()
  const out = parser.push('{"message":{"content":"a"}}\nGARBAGE\n{"done":true}\n')
  assert.equal(out.length, 2)
  assert.equal(out[0].message?.content, 'a')
  assert.equal(out[1].done, true)
})

test('blank lines and an empty flush are harmless', () => {
  const parser = createNdjsonParser()
  assert.deepEqual(parser.push('\n\n'), [])
  assert.deepEqual(parser.flush(), [])
})
