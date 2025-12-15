import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  typeIdSchema,
  flexibleIdSchema,
  flexibleToTypeIdSchema,
  anyTypeIdSchema,
  uuidSchema,
  postIdSchema,
  boardIdSchema,
  flexiblePostIdSchema,
  flexibleBoardIdSchema,
  tagIdsSchema,
} from '../zod'
import { generateId, toUuid } from '../core'

describe('Zod TypeID Schemas', () => {
  describe('typeIdSchema', () => {
    it('accepts valid TypeIDs with correct prefix', () => {
      const schema = typeIdSchema('post')
      const postId = generateId('post')

      expect(schema.parse(postId)).toBe(postId)
    })

    it('rejects TypeIDs with wrong prefix', () => {
      const schema = typeIdSchema('post')
      const boardId = generateId('board')

      expect(() => schema.parse(boardId)).toThrow()
    })

    it('rejects raw UUIDs', () => {
      const schema = typeIdSchema('post')
      const uuid = '01893d8c-7e80-7000-8000-000000000000'

      expect(() => schema.parse(uuid)).toThrow()
    })

    it('rejects invalid strings', () => {
      const schema = typeIdSchema('post')

      expect(() => schema.parse('invalid')).toThrow()
      expect(() => schema.parse('')).toThrow()
      expect(() => schema.parse('post_invalid')).toThrow()
    })
  })

  describe('flexibleIdSchema', () => {
    it('accepts TypeIDs and returns UUID', () => {
      const schema = flexibleIdSchema('post')
      const postId = generateId('post')

      const result = schema.parse(postId)
      expect(result).toBe(toUuid(postId))
    })

    it('accepts raw UUIDs and passes through', () => {
      const schema = flexibleIdSchema('post')
      const uuid = '01893d8c-7e80-7000-8000-000000000000'

      expect(schema.parse(uuid)).toBe(uuid)
    })

    it('rejects TypeIDs with wrong prefix', () => {
      const schema = flexibleIdSchema('post')
      const boardId = generateId('board')

      expect(() => schema.parse(boardId)).toThrow('Expected post ID, got board ID')
    })

    it('rejects invalid strings', () => {
      const schema = flexibleIdSchema('post')

      expect(() => schema.parse('invalid')).toThrow()
      expect(() => schema.parse('')).toThrow()
    })
  })

  describe('flexibleToTypeIdSchema', () => {
    it('converts UUID to TypeID', () => {
      const schema = flexibleToTypeIdSchema('post')
      const uuid = '01893d8c-7e80-7000-8000-000000000000'

      const result = schema.parse(uuid)
      expect(result).toMatch(/^post_/)
      expect(toUuid(result)).toBe(uuid)
    })

    it('passes through valid TypeIDs', () => {
      const schema = flexibleToTypeIdSchema('post')
      const postId = generateId('post')

      expect(schema.parse(postId)).toBe(postId)
    })

    it('rejects TypeIDs with wrong prefix', () => {
      const schema = flexibleToTypeIdSchema('post')
      const boardId = generateId('board')

      expect(() => schema.parse(boardId)).toThrow()
    })
  })

  describe('anyTypeIdSchema', () => {
    it('accepts any valid TypeID', () => {
      expect(anyTypeIdSchema.parse(generateId('post'))).toBeTruthy()
      expect(anyTypeIdSchema.parse(generateId('board'))).toBeTruthy()
      expect(anyTypeIdSchema.parse(generateId('comment'))).toBeTruthy()
    })

    it('rejects non-TypeID strings', () => {
      expect(() => anyTypeIdSchema.parse('invalid')).toThrow()
      expect(() => anyTypeIdSchema.parse('01893d8c-7e80-7000-8000-000000000000')).toThrow()
    })
  })

  describe('uuidSchema', () => {
    it('accepts valid UUIDs', () => {
      const uuid = '01893d8c-7e80-7000-8000-000000000000'
      expect(uuidSchema.parse(uuid)).toBe(uuid)
    })

    it('rejects TypeIDs', () => {
      expect(() => uuidSchema.parse(generateId('post'))).toThrow()
    })

    it('rejects invalid strings', () => {
      expect(() => uuidSchema.parse('invalid')).toThrow()
    })
  })

  describe('pre-built schemas', () => {
    it('postIdSchema validates post IDs', () => {
      const postId = generateId('post')
      expect(postIdSchema.parse(postId)).toBe(postId)
      expect(() => postIdSchema.parse(generateId('board'))).toThrow()
    })

    it('boardIdSchema validates board IDs', () => {
      const boardId = generateId('board')
      expect(boardIdSchema.parse(boardId)).toBe(boardId)
      expect(() => boardIdSchema.parse(generateId('post'))).toThrow()
    })

    it('flexiblePostIdSchema accepts TypeID or UUID', () => {
      const postId = generateId('post')
      const uuid = toUuid(postId)

      expect(flexiblePostIdSchema.parse(postId)).toBe(uuid)
      expect(flexiblePostIdSchema.parse(uuid)).toBe(uuid)
    })

    it('flexibleBoardIdSchema accepts TypeID or UUID', () => {
      const boardId = generateId('board')
      const uuid = toUuid(boardId)

      expect(flexibleBoardIdSchema.parse(boardId)).toBe(uuid)
      expect(flexibleBoardIdSchema.parse(uuid)).toBe(uuid)
    })
  })

  describe('array schemas', () => {
    it('tagIdsSchema validates array of tag TypeIDs', () => {
      const tagIds = [generateId('tag'), generateId('tag'), generateId('tag')]

      const result = tagIdsSchema.parse(tagIds)
      // Strict TypeID schema returns TypeIDs unchanged
      expect(result).toEqual(tagIds)
    })

    it('tagIdsSchema rejects raw UUIDs', () => {
      const tagId1 = generateId('tag')
      const uuid2 = '01893d8c-7e80-7000-8000-000000000002'
      const tagId3 = generateId('tag')

      // Strict schema does not accept UUIDs
      expect(() => tagIdsSchema.parse([tagId1, uuid2, tagId3])).toThrow()
    })

    it('tagIdsSchema rejects wrong prefix', () => {
      const postId = generateId('post')
      expect(() => tagIdsSchema.parse([postId])).toThrow()
    })
  })

  describe('schema composition', () => {
    it('works in complex object schemas', () => {
      const createPostSchema = z.object({
        title: z.string().min(1),
        boardId: flexibleIdSchema('board'),
        tagIds: z.array(flexibleIdSchema('tag')),
      })

      const boardId = generateId('board')
      const tagId1 = generateId('tag')
      const tagId2 = '01893d8c-7e80-7000-8000-000000000002'

      const result = createPostSchema.parse({
        title: 'Test Post',
        boardId,
        tagIds: [tagId1, tagId2],
      })

      expect(result.title).toBe('Test Post')
      expect(result.boardId).toBe(toUuid(boardId))
      expect(result.tagIds).toEqual([toUuid(tagId1), tagId2])
    })

    it('provides helpful error messages', () => {
      const schema = z.object({
        postId: flexibleIdSchema('post'),
      })

      try {
        schema.parse({ postId: generateId('board') })
        expect.fail('Should have thrown')
      } catch (error) {
        if (error instanceof z.ZodError) {
          expect(error.issues[0].message).toContain('Expected post ID')
        }
      }
    })
  })
})
