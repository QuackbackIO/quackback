import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@/lib/server/config', () => ({ config: {} }))
vi.mock('../retrieval', () => ({
  retrieveKbArticles: vi.fn(),
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  listMessages: vi.fn(),
}))

const mockRecordVisitorContact = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.contact', () => ({
  recordVisitorContact: (...args: unknown[]) => mockRecordVisitorContact(...args),
}))

import { ASSISTANT_TOOL_SPECS } from '../assistant.toolspec'
import { makeToolTestContext } from './assistant-tool-fixtures'

const spec = ASSISTANT_TOOL_SPECS.capture_contact_details

describe('capture_contact_details', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has the expected spec shape', () => {
    expect(spec.risk).toBe('write')
    expect(spec.permissions).toEqual([PERMISSIONS.CONVERSATION_SET_ATTRIBUTES])
  })

  it('is offered only for a public anonymous visitor with no email', () => {
    expect(spec.availableWhen).toBeDefined()
    expect(
      spec.availableWhen!(
        makeToolTestContext({ audience: 'public', conversationId: 'conversation_1' as never })
      )
    ).toBe(false)
    expect(
      spec.availableWhen!(
        makeToolTestContext({
          audience: 'public',
          conversationId: 'conversation_1' as never,
          visitorIsAnonymous: true,
          visitorHasContactEmail: false,
        })
      )
    ).toBe(true)
    expect(
      spec.availableWhen!(
        makeToolTestContext({
          audience: 'public',
          conversationId: 'conversation_1' as never,
          visitorIsAnonymous: true,
          visitorHasContactEmail: true,
        })
      )
    ).toBe(false)
    expect(
      spec.availableWhen!(
        makeToolTestContext({
          audience: 'team',
          conversationId: 'conversation_1' as never,
          visitorIsAnonymous: true,
          visitorHasContactEmail: false,
        })
      )
    ).toBe(false)
  })

  it('rejects an empty payload', () => {
    expect(spec.definition.inputSchema.safeParse({}).success).toBe(false)
  })

  it('records a valid email through the shared contact writer', async () => {
    mockRecordVisitorContact.mockResolvedValue({
      captured: true,
      email: 'ada@example.com',
      name: 'Ada',
      possibleMatchPrincipalId: null,
    })
    const result = await spec.execute(
      { email: 'Ada@Example.com', name: 'Ada' },
      makeToolTestContext({ conversationId: 'conversation_1' as never })
    )
    expect(mockRecordVisitorContact).toHaveBeenCalledWith(
      'conversation_1',
      { email: 'Ada@Example.com', name: 'Ada' },
      { refuseTeamEmail: true }
    )
    expect(result).toEqual({ captured: true, email: 'ada@example.com', name: 'Ada' })
  })

  it('returns a refusal note when the address is rejected', async () => {
    mockRecordVisitorContact.mockResolvedValue({
      captured: false,
      email: null,
      name: null,
      possibleMatchPrincipalId: null,
    })
    const result = await spec.execute(
      { email: 'mate@acme.test' },
      makeToolTestContext({ conversationId: 'conversation_1' as never })
    )
    expect((result as { captured: boolean }).captured).toBe(false)
    expect((result as { note: string }).note).toMatch(/could not be recorded/i)
  })
})
