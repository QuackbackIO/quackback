import { describe, it, expect, vi, beforeEach } from 'vitest'

// Table sentinels + operator stubs; the service passes an explicit `exec`, so
// the mocked `db` is only a fallback and the operators just need to not throw.
const notExistsSpy = vi.fn((q: unknown) => ({ notExists: q }))
// Spread the real db module so tables/operators stay current; override only what this suite drives.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {},
  and: (...a: unknown[]) => ({ and: a }),
  eq: (...a: unknown[]) => ({ eq: a }),
  gt: (...a: unknown[]) => ({ gt: a }),
  lt: (...a: unknown[]) => ({ lt: a }),
  isNull: (...a: unknown[]) => ({ isNull: a }),
  notExists: (q: unknown) => notExistsSpy(q),
  desc: (...a: unknown[]) => ({ desc: a }),
  sql: (strings: TemplateStringsArray) => ({ sql: strings }),
}))

const mockClassifyConversationAttributes = vi.fn()
vi.mock('@/lib/server/domains/conversation-attributes/ai-classification.service', () => ({
  classifyConversationAttributes: (...args: unknown[]) =>
    mockClassifyConversationAttributes(...args),
}))

import { finalizeStaleAssistantInvolvements } from '../assistant.involvement'

/**
 * A minimal drizzle-shaped executor: the correlated NOT EXISTS subquery is built
 * via select().from().where() (not awaited), and the sweep's set-based UPDATE
 * resolves through update().set().where().returning() to `resolvedRows`.
 */
function makeExec(resolvedRows: Array<{ id: string; conversationId: string }>) {
  return {
    select: () => ({ from: () => ({ where: () => ({ __subquery: true }) }) }),
    update: () => ({
      set: () => ({ where: () => ({ returning: async () => resolvedRows }) }),
    }),
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  mockClassifyConversationAttributes.mockResolvedValue([])
})

describe('finalizeStaleAssistantInvolvements', () => {
  it('resolves in one set-based UPDATE, returning the count of rows it flipped', async () => {
    const exec = makeExec([
      { id: 'assistant_involvement_1', conversationId: 'conversation_1' },
      { id: 'assistant_involvement_2', conversationId: 'conversation_2' },
    ])
    const { resolved } = await finalizeStaleAssistantInvolvements(10, exec)
    expect(resolved).toBe(2)
    // The "customer returned" guard rides a correlated NOT EXISTS subquery.
    expect(notExistsSpy).toHaveBeenCalledTimes(1)
  })

  it('is 0 when nothing is stale (the UPDATE matches no rows)', async () => {
    const exec = makeExec([])
    const { resolved } = await finalizeStaleAssistantInvolvements(10, exec)
    expect(resolved).toBe(0)
  })

  it('classifies attributes (trigger inactivity) for every conversation resolved this sweep', async () => {
    const exec = makeExec([
      { id: 'assistant_involvement_1', conversationId: 'conversation_1' },
      { id: 'assistant_involvement_2', conversationId: 'conversation_2' },
    ])
    await finalizeStaleAssistantInvolvements(10, exec)
    // Fire-and-forget: give the un-awaited classify calls a tick to fire.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockClassifyConversationAttributes).toHaveBeenCalledWith('conversation_1', {
      trigger: 'inactivity',
    })
    expect(mockClassifyConversationAttributes).toHaveBeenCalledWith('conversation_2', {
      trigger: 'inactivity',
    })
  })

  it('does not classify anything when no involvement was resolved', async () => {
    const exec = makeExec([])
    await finalizeStaleAssistantInvolvements(10, exec)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockClassifyConversationAttributes).not.toHaveBeenCalled()
  })

  it('never lets a classification failure affect the sweep result', async () => {
    mockClassifyConversationAttributes.mockRejectedValue(new Error('classifier exploded'))
    const exec = makeExec([{ id: 'assistant_involvement_1', conversationId: 'conversation_1' }])
    const { resolved } = await finalizeStaleAssistantInvolvements(10, exec)
    expect(resolved).toBe(1)
  })
})
