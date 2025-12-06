import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import {
  posts,
  votes,
  comments,
  postTags,
  postRoadmaps,
  commentReactions,
  REACTION_EMOJIS,
} from '../schema/posts'
import { boards, roadmaps, tags } from '../schema/boards'
import { integrations } from '../schema/integrations'
import { changelogEntries } from '../schema/changelog'
import { user, session, organization, member, invitation } from '../schema/auth'

describe('Schema definitions', () => {
  describe('boards schema', () => {
    it('has correct table name', () => {
      expect(getTableName(boards)).toBe('boards')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(boards))
      expect(columns).toContain('id')
      expect(columns).toContain('organizationId')
      expect(columns).toContain('slug')
      expect(columns).toContain('name')
      expect(columns).toContain('description')
      expect(columns).toContain('isPublic')
      expect(columns).toContain('settings')
      expect(columns).toContain('createdAt')
      expect(columns).toContain('updatedAt')
    })

    it('has correct column count', () => {
      const columns = Object.keys(getTableColumns(boards))
      expect(columns.length).toBe(9)
    })
  })

  describe('roadmaps schema', () => {
    it('has correct table name', () => {
      expect(getTableName(roadmaps)).toBe('roadmaps')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(roadmaps))
      expect(columns).toContain('id')
      expect(columns).toContain('boardId')
      expect(columns).toContain('slug')
      expect(columns).toContain('name')
      expect(columns).toContain('description')
      expect(columns).toContain('isPublic')
      expect(columns).toContain('createdAt')
      expect(columns).toContain('updatedAt')
    })
  })

  describe('tags schema', () => {
    it('has correct table name', () => {
      expect(getTableName(tags)).toBe('tags')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(tags))
      expect(columns).toContain('id')
      expect(columns).toContain('organizationId')
      expect(columns).toContain('name')
      expect(columns).toContain('color')
      expect(columns).toContain('createdAt')
    })
  })

  describe('posts schema', () => {
    it('has correct table name', () => {
      expect(getTableName(posts)).toBe('posts')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(posts))
      expect(columns).toContain('id')
      expect(columns).toContain('boardId')
      expect(columns).toContain('title')
      expect(columns).toContain('content')
      expect(columns).toContain('authorId')
      expect(columns).toContain('authorName')
      expect(columns).toContain('authorEmail')
      expect(columns).toContain('status')
      expect(columns).toContain('ownerId')
      expect(columns).toContain('estimated')
      expect(columns).toContain('voteCount')
      expect(columns).toContain('createdAt')
      expect(columns).toContain('updatedAt')
    })

    it('has correct column count', () => {
      const columns = Object.keys(getTableColumns(posts))
      expect(columns.length).toBe(22)
    })
  })

  describe('postTags schema', () => {
    it('has correct table name', () => {
      expect(getTableName(postTags)).toBe('post_tags')
    })

    it('has junction table columns', () => {
      const columns = Object.keys(getTableColumns(postTags))
      expect(columns).toContain('postId')
      expect(columns).toContain('tagId')
      expect(columns.length).toBe(2)
    })
  })

  describe('postRoadmaps schema', () => {
    it('has correct table name', () => {
      expect(getTableName(postRoadmaps)).toBe('post_roadmaps')
    })

    it('has junction table columns', () => {
      const columns = Object.keys(getTableColumns(postRoadmaps))
      expect(columns).toContain('postId')
      expect(columns).toContain('roadmapId')
      expect(columns.length).toBe(2)
    })
  })

  describe('votes schema', () => {
    it('has correct table name', () => {
      expect(getTableName(votes)).toBe('votes')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(votes))
      expect(columns).toContain('id')
      expect(columns).toContain('postId')
      expect(columns).toContain('userIdentifier')
      expect(columns).toContain('createdAt')
    })

    it('has userIdentifier for anonymous voting', () => {
      const columns = Object.keys(getTableColumns(votes))
      expect(columns).toContain('userIdentifier')
    })
  })

  describe('comments schema', () => {
    it('has correct table name', () => {
      expect(getTableName(comments)).toBe('comments')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(comments))
      expect(columns).toContain('id')
      expect(columns).toContain('postId')
      expect(columns).toContain('parentId')
      expect(columns).toContain('authorId')
      expect(columns).toContain('authorName')
      expect(columns).toContain('authorEmail')
      expect(columns).toContain('content')
      expect(columns).toContain('createdAt')
    })

    it('has parentId for nested comments', () => {
      const columns = Object.keys(getTableColumns(comments))
      expect(columns).toContain('parentId')
    })
  })

  describe('commentReactions schema', () => {
    it('has correct table name', () => {
      expect(getTableName(commentReactions)).toBe('comment_reactions')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(commentReactions))
      expect(columns).toContain('id')
      expect(columns).toContain('commentId')
      expect(columns).toContain('userIdentifier')
      expect(columns).toContain('emoji')
      expect(columns).toContain('createdAt')
    })
  })

  describe('REACTION_EMOJIS', () => {
    it('contains expected emojis', () => {
      expect(REACTION_EMOJIS).toContain('👍')
      expect(REACTION_EMOJIS).toContain('❤️')
      expect(REACTION_EMOJIS).toContain('🎉')
      expect(REACTION_EMOJIS).toContain('😄')
      expect(REACTION_EMOJIS).toContain('🤔')
      expect(REACTION_EMOJIS).toContain('👀')
    })

    it('has 6 emojis', () => {
      expect(REACTION_EMOJIS.length).toBe(6)
    })

    it('is a readonly tuple', () => {
      expect(Array.isArray(REACTION_EMOJIS)).toBe(true)
    })
  })

  describe('integrations schema', () => {
    it('has correct table name', () => {
      expect(getTableName(integrations)).toBe('integrations')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(integrations))
      expect(columns).toContain('id')
      expect(columns).toContain('organizationId')
      expect(columns).toContain('type')
      expect(columns).toContain('status')
      expect(columns).toContain('config')
      expect(columns).toContain('createdAt')
      expect(columns).toContain('updatedAt')
    })
  })

  describe('changelog schema', () => {
    it('has correct table name', () => {
      expect(getTableName(changelogEntries)).toBe('changelog_entries')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(changelogEntries))
      expect(columns).toContain('id')
      expect(columns).toContain('boardId')
      expect(columns).toContain('title')
      expect(columns).toContain('content')
      expect(columns).toContain('publishedAt')
      expect(columns).toContain('createdAt')
      expect(columns).toContain('updatedAt')
    })

    it('has publishedAt for draft/publish workflow', () => {
      const columns = Object.keys(getTableColumns(changelogEntries))
      expect(columns).toContain('publishedAt')
    })
  })
})

describe('Auth schema definitions', () => {
  describe('user schema', () => {
    it('has correct table name', () => {
      expect(getTableName(user)).toBe('user')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(user))
      expect(columns).toContain('id')
      expect(columns).toContain('email')
      expect(columns).toContain('name')
      expect(columns).toContain('emailVerified')
      expect(columns).toContain('image')
      expect(columns).toContain('createdAt')
      expect(columns).toContain('updatedAt')
    })
  })

  describe('session schema', () => {
    it('has correct table name', () => {
      expect(getTableName(session)).toBe('session')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(session))
      expect(columns).toContain('id')
      expect(columns).toContain('userId')
      expect(columns).toContain('token')
      expect(columns).toContain('expiresAt')
    })

    it('has activeOrganizationId for org plugin', () => {
      const columns = Object.keys(getTableColumns(session))
      expect(columns).toContain('activeOrganizationId')
    })
  })

  describe('organization schema', () => {
    it('has correct table name', () => {
      expect(getTableName(organization)).toBe('organization')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(organization))
      expect(columns).toContain('id')
      expect(columns).toContain('name')
      expect(columns).toContain('slug')
      expect(columns).toContain('createdAt')
    })

    it('has slug for URL-friendly names', () => {
      const columns = Object.keys(getTableColumns(organization))
      expect(columns).toContain('slug')
    })
  })

  describe('member schema', () => {
    it('has correct table name', () => {
      expect(getTableName(member)).toBe('member')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(member))
      expect(columns).toContain('id')
      expect(columns).toContain('userId')
      expect(columns).toContain('organizationId')
      expect(columns).toContain('role')
      expect(columns).toContain('createdAt')
    })

    it('has role column', () => {
      const columns = Object.keys(getTableColumns(member))
      expect(columns).toContain('role')
    })
  })

  describe('invitation schema', () => {
    it('has correct table name', () => {
      expect(getTableName(invitation)).toBe('invitation')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(invitation))
      expect(columns).toContain('id')
      expect(columns).toContain('email')
      expect(columns).toContain('organizationId')
      expect(columns).toContain('status')
      expect(columns).toContain('expiresAt')
    })

    it('has status and expiresAt for invitation workflow', () => {
      const columns = Object.keys(getTableColumns(invitation))
      expect(columns).toContain('status')
      expect(columns).toContain('expiresAt')
    })
  })
})
