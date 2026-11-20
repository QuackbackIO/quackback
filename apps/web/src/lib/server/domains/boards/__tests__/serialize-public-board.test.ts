import { describe, expect, it } from 'vitest'

import { serializePublicBoard } from '../board.serialize'

describe('serializePublicBoard', () => {
  const row = {
    id: 'board_1',
    name: 'Bugs',
    slug: 'bugs',
    access: { view: 'anonymous' },
    settings: null as unknown as Record<string, never>,
    readOnly: true,
  }

  it('never carries readOnly, for a board an admin set read-only or not', () => {
    for (const readOnly of [true, false]) {
      const out = serializePublicBoard({ ...row, readOnly })
      expect(out).not.toHaveProperty('readOnly')
      expect(JSON.stringify(out)).not.toContain('readOnly')
    }
  })

  it('still strips the access matrix and defaults settings', () => {
    const out = serializePublicBoard(row)
    expect(out).not.toHaveProperty('access')
    expect(out.settings).toEqual({})
  })
})
