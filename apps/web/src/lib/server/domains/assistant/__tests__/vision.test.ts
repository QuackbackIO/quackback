/**
 * Quinn vision: a customer screenshot reaches the model as image input ONLY
 * when the effective assistant chat model accepts image input; on a text-only
 * model the same thread degrades to a textual "[image attached]" note and not
 * a single image part is ever emitted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = {
  baseUrl: 'https://app.example.com',
  aiChatModel: undefined as string | undefined,
  aiAssistantModel: undefined as string | undefined,
  aiAssistantVision: undefined as string | undefined,
}

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const { isVisionCapableModel, getChatModel } = await import('@/lib/server/domains/ai/models')
const { buildThreadModelMessages } = await import('../vision')
const { mapRowsToThreadMessages } = await import('../assistant.thread')

beforeEach(() => {
  mockConfig.baseUrl = 'https://app.example.com'
  mockConfig.aiChatModel = undefined
  mockConfig.aiAssistantModel = undefined
  mockConfig.aiAssistantVision = undefined
})

describe('isVisionCapableModel', () => {
  it('accepts known vision-capable chat models', () => {
    expect(isVisionCapableModel('gpt-4o')).toBe(true)
    expect(isVisionCapableModel('gpt-4o-mini')).toBe(true)
    expect(isVisionCapableModel('gpt-5.2')).toBe(true)
    expect(isVisionCapableModel('o4-mini')).toBe(true)
    expect(isVisionCapableModel('openrouter/anthropic/claude-sonnet-4')).toBe(true)
    expect(isVisionCapableModel('gemini-2.0-flash')).toBe(true)
    expect(isVisionCapableModel('llama-3.2-11b-vision-instruct')).toBe(true)
  })

  it('rejects text-only and unknown models', () => {
    expect(isVisionCapableModel(null)).toBe(false)
    expect(isVisionCapableModel('gpt-3.5-turbo')).toBe(false)
    expect(isVisionCapableModel('deepseek-chat')).toBe(false)
    expect(isVisionCapableModel('qwen2.5-7b-instruct')).toBe(false)
    expect(isVisionCapableModel('some-custom-model')).toBe(false)
  })

  it('honours the AI_ASSISTANT_VISION override in both directions', () => {
    mockConfig.aiAssistantVision = 'on'
    expect(isVisionCapableModel('some-custom-model')).toBe(true)
    mockConfig.aiAssistantVision = 'off'
    expect(isVisionCapableModel('gpt-4o')).toBe(false)
  })
})

const png = (name: string, url: string) => ({
  url,
  name,
  contentType: 'image/png',
  size: 1234,
})

describe('buildThreadModelMessages', () => {
  it('streams a customer screenshot as an image part to a vision-capable model', () => {
    const [msg] = buildThreadModelMessages(
      [
        {
          sender: 'customer',
          content: 'The export button does nothing, see attached.',
          attachments: [png('screen.png', '/api/storage/abc/screen.png')],
        },
      ],
      { visionCapable: true }
    )
    expect(msg.role).toBe('user')
    expect(Array.isArray(msg.content)).toBe(true)
    const parts = msg.content as Array<{
      type: string
      content?: string
      source?: { type: string; value: string; mimeType?: string }
    }>
    expect(parts[0]).toEqual({
      type: 'text',
      content: 'The export button does nothing, see attached.',
    })
    expect(parts[1]).toEqual({
      type: 'image',
      source: {
        type: 'url',
        value: 'https://app.example.com/api/storage/abc/screen.png',
        mimeType: 'image/png',
      },
    })
  })

  it('keeps an image-only customer message (no text) with a placeholder text part', () => {
    const [msg] = buildThreadModelMessages(
      [
        {
          sender: 'customer',
          content: '',
          attachments: [png('shot.png', 'https://cdn.example.com/shot.png')],
        },
      ],
      { visionCapable: true }
    )
    const parts = msg.content as Array<{ type: string }>
    expect(parts[0].type).toBe('text')
    expect(parts[1].type).toBe('image')
  })

  it('never emits image parts to a text-only model, degrading to a textual note', () => {
    const [msg] = buildThreadModelMessages(
      [
        {
          sender: 'customer',
          content: 'See the error.',
          attachments: [png('screen.png', '/api/storage/abc/screen.png')],
        },
      ],
      { visionCapable: false }
    )
    expect(typeof msg.content).toBe('string')
    expect(msg.content).toContain('See the error.')
    expect(msg.content).toContain('[image attached: screen.png]')
  })

  it('does not inline non-image attachments or agent-side attachments', () => {
    const [customerMsg, agentMsg] = buildThreadModelMessages(
      [
        {
          sender: 'customer',
          content: 'logs attached',
          attachments: [
            { url: '/api/storage/x/log.txt', name: 'log.txt', contentType: 'text/plain', size: 10 },
          ],
        },
        {
          sender: 'assistant',
          content: 'reply',
          attachments: [png('internal.png', '/api/storage/y/internal.png')],
        },
      ],
      { visionCapable: true }
    )
    expect(customerMsg.content).toBe('logs attached')
    expect(agentMsg.content).toBe('reply')
  })

  it('leaves plain text messages byte-identical', () => {
    const msgs = buildThreadModelMessages(
      [
        { sender: 'customer', content: 'hi' },
        { sender: 'human_agent', content: 'hello' },
      ],
      { visionCapable: true }
    )
    expect(msgs).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })
})

describe('mapRowsToThreadMessages — attachments', () => {
  const row = (over: Record<string, unknown>) =>
    ({
      id: 'm1',
      conversationId: 'c1',
      ticketId: null,
      senderType: 'visitor',
      content: '',
      createdAt: '2026-01-01T00:00:00Z',
      author: null,
      attachments: [],
      citations: [],
      isInternal: false,
      ...over,
    }) as never

  it('keeps an image-only customer message and carries its attachments', () => {
    const out = mapRowsToThreadMessages(
      [row({ attachments: [png('screen.png', '/api/storage/abc/screen.png')] })],
      'p1' as never
    )
    expect(out).toHaveLength(1)
    expect(out[0].sender).toBe('customer')
    expect(out[0].attachments?.[0]?.name).toBe('screen.png')
  })

  it('still drops a text-less message with no image attachments', () => {
    const out = mapRowsToThreadMessages([row({})], 'p1' as never)
    expect(out).toHaveLength(0)
  })
})

describe('getChatModel still resolves the assistant model (gate input)', () => {
  it('assistant override wins over the chat default', () => {
    mockConfig.aiChatModel = 'deepseek-chat'
    mockConfig.aiAssistantModel = 'gpt-4o'
    expect(getChatModel('assistant')).toBe('gpt-4o')
    expect(isVisionCapableModel(getChatModel('assistant'))).toBe(true)
  })
})
