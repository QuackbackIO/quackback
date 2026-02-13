import { describe, it, expect } from 'vitest'
import {
  generateId,
  createId,
  toUuid,
  fromUuid,
  parseTypeId,
  getTypeIdPrefix,
  isValidTypeId,
  isUuid,
  isTypeIdFormat,
  batchFromUuid,
  batchToUuid,
  normalizeToUuid,
  ensureTypeId,
} from '../core'
import { ID_PREFIXES } from '../prefixes'

describe('TypeID Core', () => {
  describe('generateId', () => {
    it('generates a valid TypeID with the correct prefix', () => {
      const id = generateId('post')
      expect(id).toMatch(/^post_[0-7][0-9a-hjkmnp-tv-z]{25}$/)
    })

    it('generates unique IDs on each call', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 1000; i++) {
        ids.add(generateId('post'))
      }
      expect(ids.size).toBe(1000)
    })

    it('generates IDs with different prefixes', () => {
      const postId = generateId('post')
      const boardId = generateId('board')
      const commentId = generateId('comment')

      expect(postId).toMatch(/^post_/)
      expect(boardId).toMatch(/^board_/)
      expect(commentId).toMatch(/^comment_/)
    })

    it('generates time-ordered IDs (UUIDv7)', () => {
      const ids: string[] = []
      for (let i = 0; i < 10; i++) {
        ids.push(generateId('post'))
      }

      // IDs should be in lexicographic order (time-sorted)
      const sorted = [...ids].sort()
      expect(ids).toEqual(sorted)
    })
  })

  describe('createId', () => {
    it('creates ID using entity type key', () => {
      const postId = createId('post')
      const boardId = createId('board')

      expect(postId).toMatch(/^post_/)
      expect(boardId).toMatch(/^board_/)
    })

    it('works with all entity types', () => {
      for (const entityType of Object.keys(ID_PREFIXES) as Array<keyof typeof ID_PREFIXES>) {
        const id = createId(entityType)
        expect(id).toMatch(new RegExp(`^${ID_PREFIXES[entityType]}_`))
      }
    })
  })

  describe('toUuid', () => {
    it('extracts UUID from TypeID', () => {
      const typeId = generateId('post')
      const uuid = toUuid(typeId)

      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })

    it('throws on invalid TypeID format', () => {
      expect(() => toUuid('invalid')).toThrow()
      expect(() => toUuid('post_invalid')).toThrow()
      expect(() => toUuid('')).toThrow()
    })
  })

  describe('fromUuid', () => {
    it('creates TypeID from UUID', () => {
      const uuid = '01893d8c-7e80-7000-8000-000000000000'
      const typeId = fromUuid('post', uuid)

      expect(typeId).toMatch(/^post_/)
      expect(toUuid(typeId)).toBe(uuid)
    })

    it('throws on invalid UUID format', () => {
      expect(() => fromUuid('post', 'invalid')).toThrow('Invalid UUID format')
      expect(() => fromUuid('post', '01893d8c-7e80-7000')).toThrow()
      expect(() => fromUuid('post', '')).toThrow()
    })

    it('works with uppercase UUIDs', () => {
      const uuid = '01893D8C-7E80-7000-8000-000000000000'
      const typeId = fromUuid('post', uuid)
      expect(typeId).toMatch(/^post_/)
    })
  })

  describe('round-trip conversion', () => {
    it('preserves ID through UUID round-trip', () => {
      const original = generateId('post')
      const uuid = toUuid(original)
      const restored = fromUuid('post', uuid)

      expect(restored).toBe(original)
    })

    it('works for all entity types', () => {
      for (const entityType of Object.keys(ID_PREFIXES) as Array<keyof typeof ID_PREFIXES>) {
        const original = createId(entityType)
        const uuid = toUuid(original)
        const restored = fromUuid(ID_PREFIXES[entityType], uuid)
        expect(restored).toBe(original)
      }
    })
  })

  describe('parseTypeId', () => {
    it('extracts prefix and UUID', () => {
      const typeId = generateId('post')
      const { prefix, uuid } = parseTypeId(typeId)

      expect(prefix).toBe('post')
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })

    it('works with different prefixes', () => {
      const prefixes = ['post', 'board', 'comment', 'workspace', 'user'] as const

      for (const prefix of prefixes) {
        const typeId = generateId(prefix)
        const parsed = parseTypeId(typeId)
        expect(parsed.prefix).toBe(prefix)
      }
    })
  })

  describe('getTypeIdPrefix', () => {
    it('returns the prefix', () => {
      const typeId = generateId('board')
      expect(getTypeIdPrefix(typeId)).toBe('board')
    })
  })

  describe('isValidTypeId', () => {
    it('returns true for valid TypeIDs', () => {
      expect(isValidTypeId(generateId('post'))).toBe(true)
      expect(isValidTypeId(generateId('board'))).toBe(true)
    })

    it('returns false for invalid formats', () => {
      expect(isValidTypeId('invalid')).toBe(false)
      expect(isValidTypeId('post_invalid')).toBe(false)
      expect(isValidTypeId('')).toBe(false)
      expect(isValidTypeId('01893d8c-7e80-7000-8000-000000000000')).toBe(false)
    })

    it('validates prefix when specified', () => {
      const postId = generateId('post')

      expect(isValidTypeId(postId, 'post')).toBe(true)
      expect(isValidTypeId(postId, 'board')).toBe(false)
    })
  })

  describe('isUuid', () => {
    it('returns true for valid UUIDs', () => {
      expect(isUuid('01893d8c-7e80-7000-8000-000000000000')).toBe(true)
      expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
      expect(isUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
    })

    it('returns false for invalid formats', () => {
      expect(isUuid('invalid')).toBe(false)
      expect(isUuid('post_01h455vb4pex5vsknk084sn02q')).toBe(false)
      expect(isUuid('550e8400-e29b-41d4-a716')).toBe(false)
      expect(isUuid('')).toBe(false)
    })
  })

  describe('isTypeIdFormat', () => {
    it('returns true for TypeID-like strings', () => {
      expect(isTypeIdFormat(generateId('post'))).toBe(true)
      expect(isTypeIdFormat(generateId('board'))).toBe(true)
    })

    it('returns false for non-TypeID formats', () => {
      expect(isTypeIdFormat('invalid')).toBe(false)
      expect(isTypeIdFormat('01893d8c-7e80-7000-8000-000000000000')).toBe(false)
    })
  })

  describe('batchFromUuid', () => {
    it('converts multiple UUIDs to TypeIDs', () => {
      const uuids = [
        '01893d8c-7e80-7000-8000-000000000001',
        '01893d8c-7e80-7000-8000-000000000002',
        '01893d8c-7e80-7000-8000-000000000003',
      ]

      const typeIds = batchFromUuid('post', uuids)

      expect(typeIds).toHaveLength(3)
      typeIds.forEach((id, i) => {
        expect(id).toMatch(/^post_/)
        expect(toUuid(id)).toBe(uuids[i])
      })
    })

    it('returns empty array for empty input', () => {
      expect(batchFromUuid('post', [])).toEqual([])
    })
  })

  describe('batchToUuid', () => {
    it('converts multiple TypeIDs to UUIDs', () => {
      const typeIds = [generateId('post'), generateId('post'), generateId('post')]

      const uuids = batchToUuid(typeIds)

      expect(uuids).toHaveLength(3)
      uuids.forEach((uuid) => {
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      })
    })
  })

  describe('normalizeToUuid', () => {
    it('passes through UUIDs unchanged', () => {
      const uuid = '01893d8c-7e80-7000-8000-000000000000'
      expect(normalizeToUuid(uuid)).toBe(uuid)
    })

    it('extracts UUID from TypeID', () => {
      const typeId = generateId('post')
      const uuid = normalizeToUuid(typeId)
      expect(uuid).toBe(toUuid(typeId))
    })

    it('validates prefix when specified', () => {
      const postId = generateId('post')
      expect(normalizeToUuid(postId, 'post')).toBe(toUuid(postId))
      expect(() => normalizeToUuid(postId, 'board')).toThrow('Expected board ID, got post')
    })
  })

  describe('ensureTypeId', () => {
    it('converts UUID to TypeID', () => {
      const uuid = '01893d8c-7e80-7000-8000-000000000000'
      const typeId = ensureTypeId(uuid, 'post')
      expect(typeId).toMatch(/^post_/)
      expect(toUuid(typeId)).toBe(uuid)
    })

    it('passes through valid TypeIDs', () => {
      const original = generateId('post')
      const result = ensureTypeId(original, 'post')
      expect(result).toBe(original)
    })

    it('throws for wrong prefix', () => {
      const boardId = generateId('board')
      expect(() => ensureTypeId(boardId, 'post')).toThrow('Invalid post ID')
    })
  })
})
