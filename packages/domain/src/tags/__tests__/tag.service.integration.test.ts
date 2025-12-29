import { describe, it, expect, beforeEach } from 'vitest'
import { TagService } from '../tag.service'
import type { CreateTagInput, UpdateTagInput } from '../tag.types'
import { db, eq, tags, boards, posts, postTags } from '@quackback/db'
import { createId } from '@quackback/ids'
import type { ServiceContext } from '../../shared/service-context'
import '../../__tests__/integration-setup'

describe('TagService - Integration Tests', () => {
  let tagService: TagService
  let ctx: ServiceContext

  beforeEach(() => {
    tagService = new TagService()
    // Default context with team member role
    ctx = {
      userId: createId('user'),
      memberId: createId('member'),
      memberRole: 'admin',
    }
  })

  describe('createTag', () => {
    it('should create tag and persist to database', async () => {
      const input: CreateTagInput = { name: 'Bug', color: '#ff0000' }

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')

      // Verify database state
      const [tag] = await db.select().from(tags).where(eq(tags.id, result.value.id))
      expect(tag.name).toBe('Bug')
      expect(tag.color).toBe('#ff0000')
    })

    it('should use default color when none provided', async () => {
      const input: CreateTagInput = { name: 'Feature' }

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')

      const [tag] = await db.select().from(tags).where(eq(tags.id, result.value.id))
      expect(tag.color).toBe('#6b7280')
    })

    it('should trim whitespace from tag name', async () => {
      const input: CreateTagInput = { name: '  Bug  ' }

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')

      const [tag] = await db.select().from(tags).where(eq(tags.id, result.value.id))
      expect(tag.name).toBe('Bug')
    })

    it('should reject empty tag name', async () => {
      const input: CreateTagInput = { name: '' }

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('VALIDATION_ERROR')

      // Verify nothing persisted
      const allTags = await db.select().from(tags)
      expect(allTags).toHaveLength(0)
    })

    it('should reject tag name exceeding 50 characters', async () => {
      const input: CreateTagInput = { name: 'a'.repeat(51) }

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('VALIDATION_ERROR')
      expect(result.error.message).toContain('50 characters')
    })

    it('should reject duplicate name (case-insensitive)', async () => {
      // Create first tag
      await db.insert(tags).values({ id: createId('tag'), name: 'BUG', color: '#ff0000' })

      const input: CreateTagInput = { name: 'bug' }

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('DUPLICATE_NAME')

      // Verify only one tag exists
      const allTags = await db.select().from(tags)
      expect(allTags).toHaveLength(1)
    })

    it('should reject invalid color format', async () => {
      const input: CreateTagInput = { name: 'Bug', color: 'red' }

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('VALIDATION_ERROR')
      expect(result.error.message).toContain('hex color')
    })

    it('should accept valid uppercase hex color', async () => {
      const input: CreateTagInput = { name: 'Bug', color: '#FF0000' }

      const result = await tagService.createTag(input, ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')

      const [tag] = await db.select().from(tags).where(eq(tags.id, result.value.id))
      expect(tag.color).toBe('#FF0000')
    })

    it('should reject portal user (unauthorized)', async () => {
      const portalCtx: ServiceContext = {
        userId: createId('user'),
        memberId: undefined,
        memberRole: undefined,
      }
      const input: CreateTagInput = { name: 'Bug' }

      const result = await tagService.createTag(input, portalCtx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('UNAUTHORIZED')

      // Verify nothing persisted
      const allTags = await db.select().from(tags)
      expect(allTags).toHaveLength(0)
    })

    it('should allow owner to create tags', async () => {
      const ownerCtx: ServiceContext = { ...ctx, memberRole: 'owner' }
      const input: CreateTagInput = { name: 'Bug' }

      const result = await tagService.createTag(input, ownerCtx)

      expect(result.success).toBe(true)
    })

    it('should allow member to create tags', async () => {
      const memberCtx: ServiceContext = { ...ctx, memberRole: 'member' }
      const input: CreateTagInput = { name: 'Bug' }

      const result = await tagService.createTag(input, memberCtx)

      expect(result.success).toBe(true)
    })
  })

  describe('updateTag', () => {
    it('should update tag name and persist to database', async () => {
      const tagId = createId('tag')
      await db.insert(tags).values({ id: tagId, name: 'Bug', color: '#ff0000' })

      const input: UpdateTagInput = { name: 'Bug Fix' }

      const result = await tagService.updateTag(tagId, input, ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')

      // Verify database state
      const [tag] = await db.select().from(tags).where(eq(tags.id, tagId))
      expect(tag.name).toBe('Bug Fix')
      expect(tag.color).toBe('#ff0000') // unchanged
    })

    it('should update tag color', async () => {
      const tagId = createId('tag')
      await db.insert(tags).values({ id: tagId, name: 'Bug', color: '#ff0000' })

      const input: UpdateTagInput = { color: '#00ff00' }

      const result = await tagService.updateTag(tagId, input, ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')

      const [tag] = await db.select().from(tags).where(eq(tags.id, tagId))
      expect(tag.name).toBe('Bug') // unchanged
      expect(tag.color).toBe('#00ff00')
    })

    it('should update both name and color', async () => {
      const tagId = createId('tag')
      await db.insert(tags).values({ id: tagId, name: 'Bug', color: '#ff0000' })

      const input: UpdateTagInput = { name: 'Feature', color: '#123456' }

      const result = await tagService.updateTag(tagId, input, ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')

      const [tag] = await db.select().from(tags).where(eq(tags.id, tagId))
      expect(tag.name).toBe('Feature')
      expect(tag.color).toBe('#123456')
    })

    it('should return error when tag not found', async () => {
      const input: UpdateTagInput = { name: 'New Name' }

      const result = await tagService.updateTag(createId('tag'), input, ctx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('TAG_NOT_FOUND')
    })

    it('should reject empty name', async () => {
      const tagId = createId('tag')
      await db.insert(tags).values({ id: tagId, name: 'Bug', color: '#ff0000' })

      const input: UpdateTagInput = { name: '' }

      const result = await tagService.updateTag(tagId, input, ctx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('VALIDATION_ERROR')

      // Verify name unchanged
      const [tag] = await db.select().from(tags).where(eq(tags.id, tagId))
      expect(tag.name).toBe('Bug')
    })

    it('should reject duplicate name (case-insensitive)', async () => {
      const tag1 = createId('tag')
      const tag2 = createId('tag')
      await db.insert(tags).values([
        { id: tag1, name: 'Bug', color: '#ff0000' },
        { id: tag2, name: 'Feature', color: '#00ff00' },
      ])

      const input: UpdateTagInput = { name: 'FEATURE' }

      const result = await tagService.updateTag(tag1, input, ctx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('DUPLICATE_NAME')

      // Verify name unchanged
      const [tag] = await db.select().from(tags).where(eq(tags.id, tag1))
      expect(tag.name).toBe('Bug')
    })

    it('should allow renaming to same name with different case', async () => {
      const tagId = createId('tag')
      await db.insert(tags).values({ id: tagId, name: 'bug', color: '#ff0000' })

      const input: UpdateTagInput = { name: 'Bug' }

      const result = await tagService.updateTag(tagId, input, ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')

      const [tag] = await db.select().from(tags).where(eq(tags.id, tagId))
      expect(tag.name).toBe('Bug')
    })

    it('should reject invalid color format', async () => {
      const tagId = createId('tag')
      await db.insert(tags).values({ id: tagId, name: 'Bug', color: '#ff0000' })

      const input: UpdateTagInput = { color: 'invalid' }

      const result = await tagService.updateTag(tagId, input, ctx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('VALIDATION_ERROR')
    })

    it('should reject unauthorized user', async () => {
      const tagId = createId('tag')
      await db.insert(tags).values({ id: tagId, name: 'Bug', color: '#ff0000' })

      const portalCtx: ServiceContext = { ...ctx, memberRole: 'user' }
      const input: UpdateTagInput = { name: 'New Name' }

      const result = await tagService.updateTag(tagId, input, portalCtx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('deleteTag', () => {
    it('should delete tag from database', async () => {
      const tagId = createId('tag')
      await db.insert(tags).values({ id: tagId, name: 'Bug', color: '#ff0000' })

      const result = await tagService.deleteTag(tagId, ctx)

      expect(result.success).toBe(true)

      // Verify tag deleted
      const allTags = await db.select().from(tags)
      expect(allTags).toHaveLength(0)
    })

    it('should return error when tag not found', async () => {
      const result = await tagService.deleteTag(createId('tag'), ctx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('TAG_NOT_FOUND')
    })

    it('should reject unauthorized user', async () => {
      const tagId = createId('tag')
      await db.insert(tags).values({ id: tagId, name: 'Bug', color: '#ff0000' })

      const portalCtx: ServiceContext = { ...ctx, memberRole: 'user' }

      const result = await tagService.deleteTag(tagId, portalCtx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('UNAUTHORIZED')

      // Verify tag not deleted
      const allTags = await db.select().from(tags)
      expect(allTags).toHaveLength(1)
    })

    it('should cascade delete from post_tags junction table', async () => {
      const tagId = createId('tag')
      const boardId = createId('board')
      const postId = createId('post')

      // Create tag, board, post, and junction entry
      await db.insert(tags).values({ id: tagId, name: 'Bug', color: '#ff0000' })
      await db.insert(boards).values({ id: boardId, name: 'Test Board', slug: 'test' })
      await db
        .insert(posts)
        .values({
          id: postId,
          title: 'Test Post',
          content: 'Test content',
          boardId,
          authorId: ctx.userId,
        })
      await db.insert(postTags).values({ postId, tagId })

      const result = await tagService.deleteTag(tagId, ctx)

      expect(result.success).toBe(true)

      // Verify tag deleted
      const allTags = await db.select().from(tags)
      expect(allTags).toHaveLength(0)

      // Verify junction entry deleted (cascade)
      const allPostTags = await db.select().from(postTags)
      expect(allPostTags).toHaveLength(0)
    })
  })

  describe('getTagById', () => {
    it('should return tag when found', async () => {
      const tagId = createId('tag')
      await db.insert(tags).values({ id: tagId, name: 'Bug', color: '#ff0000' })

      const result = await tagService.getTagById(tagId, ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')
      expect(result.value.id).toBe(tagId)
      expect(result.value.name).toBe('Bug')
      expect(result.value.color).toBe('#ff0000')
    })

    it('should return error when tag not found', async () => {
      const result = await tagService.getTagById(createId('tag'), ctx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('TAG_NOT_FOUND')
    })
  })

  describe('listTags', () => {
    it('should return all tags ordered by name', async () => {
      const tag1 = createId('tag')
      const tag2 = createId('tag')
      const tag3 = createId('tag')

      await db.insert(tags).values([
        { id: tag3, name: 'Zebra', color: '#000000' },
        { id: tag1, name: 'Apple', color: '#ff0000' },
        { id: tag2, name: 'Bug', color: '#00ff00' },
      ])

      const result = await tagService.listTags(ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')
      expect(result.value).toHaveLength(3)
      // Verify ordered by name
      expect(result.value[0].name).toBe('Apple')
      expect(result.value[1].name).toBe('Bug')
      expect(result.value[2].name).toBe('Zebra')
    })

    it('should return empty array when no tags exist', async () => {
      const result = await tagService.listTags(ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')
      expect(result.value).toHaveLength(0)
    })
  })

  describe('getTagsByBoard', () => {
    it('should return tags used in board posts', async () => {
      const boardId = createId('board')
      const tag1 = createId('tag')
      const tag2 = createId('tag')
      const tag3 = createId('tag')
      const post1 = createId('post')
      const post2 = createId('post')

      // Create board and tags
      await db.insert(boards).values({ id: boardId, name: 'Test Board', slug: 'test' })
      await db.insert(tags).values([
        { id: tag1, name: 'Bug', color: '#ff0000' },
        { id: tag2, name: 'Feature', color: '#00ff00' },
        { id: tag3, name: 'Unused', color: '#0000ff' }, // Not used in posts
      ])

      // Create posts and assign tags
      await db.insert(posts).values([
        { id: post1, title: 'Post 1', content: 'Content 1', boardId, authorId: ctx.userId },
        { id: post2, title: 'Post 2', content: 'Content 2', boardId, authorId: ctx.userId },
      ])
      await db.insert(postTags).values([
        { postId: post1, tagId: tag1 },
        { postId: post2, tagId: tag2 },
      ])

      const result = await tagService.getTagsByBoard(boardId, ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')
      expect(result.value).toHaveLength(2)

      const tagNames = result.value.map((t) => t.name).sort()
      expect(tagNames).toEqual(['Bug', 'Feature'])
    })

    it('should return error when board not found', async () => {
      const result = await tagService.getTagsByBoard(createId('board'), ctx)

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected error')
      expect(result.error.code).toBe('VALIDATION_ERROR')
      expect(result.error.message).toContain('Board')
    })

    it('should return empty array when board has no tags', async () => {
      const boardId = createId('board')
      await db.insert(boards).values({ id: boardId, name: 'Test Board', slug: 'test' })

      const result = await tagService.getTagsByBoard(boardId, ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')
      expect(result.value).toHaveLength(0)
    })

    it('should only return tags from specified board', async () => {
      const board1 = createId('board')
      const board2 = createId('board')
      const tag1 = createId('tag')
      const tag2 = createId('tag')
      const post1 = createId('post')
      const post2 = createId('post')

      // Create two boards and tags
      await db.insert(boards).values([
        { id: board1, name: 'Board 1', slug: 'board1' },
        { id: board2, name: 'Board 2', slug: 'board2' },
      ])
      await db.insert(tags).values([
        { id: tag1, name: 'Tag 1', color: '#ff0000' },
        { id: tag2, name: 'Tag 2', color: '#00ff00' },
      ])

      // Create posts in different boards with different tags
      await db.insert(posts).values([
        { id: post1, title: 'Post 1', content: 'Content 1', boardId: board1, authorId: ctx.userId },
        { id: post2, title: 'Post 2', content: 'Content 2', boardId: board2, authorId: ctx.userId },
      ])
      await db.insert(postTags).values([
        { postId: post1, tagId: tag1 },
        { postId: post2, tagId: tag2 },
      ])

      const result = await tagService.getTagsByBoard(board1, ctx)

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')
      expect(result.value).toHaveLength(1)
      expect(result.value[0].name).toBe('Tag 1')
    })
  })

  describe('listPublicTags', () => {
    it('should return all tags without authentication', async () => {
      const tag1 = createId('tag')
      const tag2 = createId('tag')

      await db.insert(tags).values([
        { id: tag1, name: 'Bug', color: '#ff0000' },
        { id: tag2, name: 'Feature', color: '#00ff00' },
      ])

      const result = await tagService.listPublicTags()

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')
      expect(result.value).toHaveLength(2)
      expect(result.value[0].name).toBe('Bug')
      expect(result.value[1].name).toBe('Feature')
    })

    it('should return empty array when no tags exist', async () => {
      const result = await tagService.listPublicTags()

      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected success')
      expect(result.value).toHaveLength(0)
    })
  })
})
