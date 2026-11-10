import { beforeEach, describe, expect, it, vi } from 'vitest'

const findFirst = vi.fn()
const execute = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst } }, execute },
  settings: { id: 'id' },
  eq: () => 'eq',
  sql: () => 'sql',
}))

const { getOrCreateInstanceId } = await import('../instance-id')

describe('the stored instance id', () => {
  beforeEach(() => {
    findFirst.mockReset()
    execute.mockReset()
  })

  it('returns the id already stored', async () => {
    findFirst.mockResolvedValue({ id: 's1', metadata: JSON.stringify({ instanceId: 'inst-1' }) })
    expect(await getOrCreateInstanceId()).toBe('inst-1')
    expect(execute).not.toHaveBeenCalled()
  })

  it('has no id before a workspace exists, rather than a new random one each ping', async () => {
    findFirst.mockResolvedValue(undefined)
    expect(await getOrCreateInstanceId()).toBeNull()
    expect(await getOrCreateInstanceId()).toBeNull()
  })

  it('has no id when the database cannot be read', async () => {
    findFirst.mockRejectedValue(new Error('connection refused'))
    expect(await getOrCreateInstanceId()).toBeNull()
  })
})
