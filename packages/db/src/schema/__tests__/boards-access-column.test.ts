import { describe, it, expect } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { boards } from '../boards'

describe('boards.access column', () => {
  it('exists on the boards table', () => {
    const cols = getTableColumns(boards)
    expect(cols.access).toBeDefined()
  })

  it('access is NOT NULL with a default', () => {
    const cols = getTableColumns(boards)
    const col = cols.access as unknown as { notNull: boolean; default: unknown }
    expect(col.notNull).toBe(true)
    expect(col.default).toBeDefined()
  })
})
