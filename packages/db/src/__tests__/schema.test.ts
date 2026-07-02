import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import {
  posts,
  postVotes,
  postComments,
  postTagAssignments,
  postRoadmaps,
  postCommentReactions,
} from '../schema/posts'
import { REACTION_EMOJIS, MODERATION_STATES } from '../types'
import { boards, roadmaps, postTags } from '../schema/boards'
import { integrations } from '../schema/integrations'
import { changelogEntries } from '../schema/changelog'
import { user, session, settings, principal, invitation } from '../schema/auth'

describe('Schema definitions', () => {
  describe('boards schema', () => {
    it('has correct table name', () => {
      expect(getTableName(boards)).toBe('boards')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(boards))
      expect(columns).toContain('id')
      expect(columns).toContain('slug')
      expect(columns).toContain('name')
      expect(columns).toContain('description')
      expect(columns).toContain('access')
      expect(columns).toContain('settings')
      expect(columns).toContain('createdAt')
      expect(columns).toContain('updatedAt')
      expect(columns).toContain('deletedAt')
    })

    it('has correct column count', () => {
      const columns = Object.keys(getTableColumns(boards))
      // 9 columns after T24 (migration 0080) dropped the legacy `audience`
      // column; `access` is now the sole source of truth.
      expect(columns.length).toBe(9)
    })

    it('no longer has the legacy isPublic column', () => {
      // Regression guard for the unified migration that dropped is_public
      // in favour of `audience`. New code reads audience exclusively.
      const columns = Object.keys(getTableColumns(boards))
      expect(columns).not.toContain('isPublic')
    })
  })

  describe('roadmaps schema', () => {
    it('has correct table name', () => {
      expect(getTableName(roadmaps)).toBe('roadmaps')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(roadmaps))
      expect(columns).toContain('id')
      expect(columns).toContain('slug')
      expect(columns).toContain('name')
      expect(columns).toContain('description')
      expect(columns).toContain('isPublic')
      expect(columns).toContain('createdAt')
      expect(columns).toContain('updatedAt')
    })
  })

  describe('postTags schema', () => {
    it('has correct table name', () => {
      expect(getTableName(postTags)).toBe('post_tags')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(postTags))
      expect(columns).toContain('id')
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
      expect(columns).toContain('principalId')
      expect(columns).toContain('statusId')
      expect(columns).toContain('ownerPrincipalId')
      expect(columns).toContain('voteCount')
      expect(columns).toContain('createdAt')
      expect(columns).toContain('updatedAt')
    })

    it('has correct column count', () => {
      const columns = Object.keys(getTableColumns(posts))
      expect(columns.length).toBe(32)
    })

    it('MODERATION_STATES matches the posts.moderation_state column enum', () => {
      // Single source of truth: the shared constant must equal exactly the
      // values the Postgres column accepts. Sorted compare — order is irrelevant.
      expect([...MODERATION_STATES].sort()).toEqual([...posts.moderationState.enumValues].sort())
    })
  })

  describe('postTagAssignments schema', () => {
    it('has correct table name', () => {
      expect(getTableName(postTagAssignments)).toBe('post_tag_assignments')
    })

    it('has junction table columns', () => {
      const columns = Object.keys(getTableColumns(postTagAssignments))
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
      expect(columns).toContain('position')
      expect(columns.length).toBe(3)
    })
  })

  describe('postVotes schema', () => {
    it('has correct table name', () => {
      expect(getTableName(postVotes)).toBe('post_votes')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(postVotes))
      expect(columns).toContain('id')
      expect(columns).toContain('postId')
      expect(columns).toContain('principalId')
      expect(columns).toContain('createdAt')
    })
  })

  describe('postComments schema', () => {
    it('has correct table name', () => {
      expect(getTableName(postComments)).toBe('post_comments')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(postComments))
      expect(columns).toContain('id')
      expect(columns).toContain('postId')
      expect(columns).toContain('parentId')
      expect(columns).toContain('principalId')
      expect(columns).toContain('content')
      expect(columns).toContain('createdAt')
    })

    it('has parentId for nested comments', () => {
      const columns = Object.keys(getTableColumns(postComments))
      expect(columns).toContain('parentId')
    })
  })

  describe('postCommentReactions schema', () => {
    it('has correct table name', () => {
      expect(getTableName(postCommentReactions)).toBe('post_comment_reactions')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(postCommentReactions))
      expect(columns).toContain('id')
      expect(columns).toContain('commentId')
      expect(columns).toContain('principalId')
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
      expect(columns).toContain('integrationType')
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
      expect(columns).toContain('title')
      expect(columns).toContain('content')
      expect(columns).toContain('publishedAt')
      expect(columns).toContain('displayDate')
      expect(columns).toContain('notifiedAt')
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
  })

  describe('settings schema', () => {
    it('has correct table name', () => {
      expect(getTableName(settings)).toBe('settings')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(settings))
      expect(columns).toContain('id')
      expect(columns).toContain('name')
      expect(columns).toContain('slug')
      expect(columns).toContain('createdAt')
    })

    it('has slug for URL-friendly names', () => {
      const columns = Object.keys(getTableColumns(settings))
      expect(columns).toContain('slug')
    })
  })

  describe('principal schema', () => {
    it('has correct table name', () => {
      expect(getTableName(principal)).toBe('principal')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(principal))
      expect(columns).toContain('id')
      expect(columns).toContain('userId')
      expect(columns).toContain('role')
      expect(columns).toContain('createdAt')
    })

    it('has role column', () => {
      const columns = Object.keys(getTableColumns(principal))
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
