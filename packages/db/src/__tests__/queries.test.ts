import { describe, it, expect } from 'vitest'
import * as boardQueries from '../queries/boards'
import * as postQueries from '../queries/posts'
import * as roadmapQueries from '../queries/roadmaps'
import * as integrationQueries from '../queries/integrations'
import * as changelogQueries from '../queries/changelog'

describe('Query Function Exports', () => {
  describe('Board queries', () => {
    it('exports createBoard', () => {
      expect(typeof boardQueries.createBoard).toBe('function')
    })

    it('exports getBoardById', () => {
      expect(typeof boardQueries.getBoardById).toBe('function')
    })

    it('exports getBoardBySlug', () => {
      expect(typeof boardQueries.getBoardBySlug).toBe('function')
    })

    it('exports getBoardsByOrganization', () => {
      expect(typeof boardQueries.getBoardsByOrganization).toBe('function')
    })

    it('exports getPublicBoardsByOrganization', () => {
      expect(typeof boardQueries.getPublicBoardsByOrganization).toBe('function')
    })

    it('exports updateBoard', () => {
      expect(typeof boardQueries.updateBoard).toBe('function')
    })

    it('exports deleteBoard', () => {
      expect(typeof boardQueries.deleteBoard).toBe('function')
    })

    it('exports createTag', () => {
      expect(typeof boardQueries.createTag).toBe('function')
    })

    it('exports getTagsByOrganization', () => {
      expect(typeof boardQueries.getTagsByOrganization).toBe('function')
    })

    it('exports deleteTag', () => {
      expect(typeof boardQueries.deleteTag).toBe('function')
    })
  })

  describe('Post queries', () => {
    it('exports createPost', () => {
      expect(typeof postQueries.createPost).toBe('function')
    })

    it('exports getPostById', () => {
      expect(typeof postQueries.getPostById).toBe('function')
    })

    it('exports getPostWithDetails', () => {
      expect(typeof postQueries.getPostWithDetails).toBe('function')
    })

    it('exports getPostList', () => {
      expect(typeof postQueries.getPostList).toBe('function')
    })

    it('exports updatePost', () => {
      expect(typeof postQueries.updatePost).toBe('function')
    })

    it('exports updatePostStatus', () => {
      expect(typeof postQueries.updatePostStatus).toBe('function')
    })

    it('exports deletePost', () => {
      expect(typeof postQueries.deletePost).toBe('function')
    })

    it('exports addTagsToPost', () => {
      expect(typeof postQueries.addTagsToPost).toBe('function')
    })

    it('exports removeTagsFromPost', () => {
      expect(typeof postQueries.removeTagsFromPost).toBe('function')
    })

    it('exports setPostTags', () => {
      expect(typeof postQueries.setPostTags).toBe('function')
    })

    it('exports toggleVote', () => {
      expect(typeof postQueries.toggleVote).toBe('function')
    })

    it('exports getUserVotes', () => {
      expect(typeof postQueries.getUserVotes).toBe('function')
    })

    it('exports getCommentsWithReplies', () => {
      expect(typeof postQueries.getCommentsWithReplies).toBe('function')
    })

    it('exports createComment', () => {
      expect(typeof postQueries.createComment).toBe('function')
    })

    it('exports deleteComment', () => {
      expect(typeof postQueries.deleteComment).toBe('function')
    })

    it('exports toggleCommentReaction', () => {
      expect(typeof postQueries.toggleCommentReaction).toBe('function')
    })

    it('exports getReactionCounts', () => {
      expect(typeof postQueries.getReactionCounts).toBe('function')
    })
  })

  describe('Roadmap queries', () => {
    it('exports createRoadmap', () => {
      expect(typeof roadmapQueries.createRoadmap).toBe('function')
    })

    it('exports getRoadmapById', () => {
      expect(typeof roadmapQueries.getRoadmapById).toBe('function')
    })

    it('exports getRoadmapsByBoard', () => {
      expect(typeof roadmapQueries.getRoadmapsByBoard).toBe('function')
    })

    it('exports getRoadmapWithPosts', () => {
      expect(typeof roadmapQueries.getRoadmapWithPosts).toBe('function')
    })

    it('exports updateRoadmap', () => {
      expect(typeof roadmapQueries.updateRoadmap).toBe('function')
    })

    it('exports deleteRoadmap', () => {
      expect(typeof roadmapQueries.deleteRoadmap).toBe('function')
    })

    it('exports addPostToRoadmap', () => {
      expect(typeof roadmapQueries.addPostToRoadmap).toBe('function')
    })

    it('exports removePostFromRoadmap', () => {
      expect(typeof roadmapQueries.removePostFromRoadmap).toBe('function')
    })
  })

  describe('Integration queries', () => {
    it('exports createIntegration', () => {
      expect(typeof integrationQueries.createIntegration).toBe('function')
    })

    it('exports getIntegrationById', () => {
      expect(typeof integrationQueries.getIntegrationById).toBe('function')
    })

    it('exports getIntegrationsByOrganization', () => {
      expect(typeof integrationQueries.getIntegrationsByOrganization).toBe('function')
    })

    it('exports getIntegrationByType', () => {
      expect(typeof integrationQueries.getIntegrationByType).toBe('function')
    })

    it('exports updateIntegration', () => {
      expect(typeof integrationQueries.updateIntegration).toBe('function')
    })

    it('exports updateIntegrationStatus', () => {
      expect(typeof integrationQueries.updateIntegrationStatus).toBe('function')
    })

    it('exports deleteIntegration', () => {
      expect(typeof integrationQueries.deleteIntegration).toBe('function')
    })
  })

  describe('Changelog queries', () => {
    it('exports createChangelogEntry', () => {
      expect(typeof changelogQueries.createChangelogEntry).toBe('function')
    })

    it('exports getChangelogEntryById', () => {
      expect(typeof changelogQueries.getChangelogEntryById).toBe('function')
    })

    it('exports getChangelogEntriesByBoard', () => {
      expect(typeof changelogQueries.getChangelogEntriesByBoard).toBe('function')
    })

    it('exports getPublishedChangelogEntries', () => {
      expect(typeof changelogQueries.getPublishedChangelogEntries).toBe('function')
    })

    it('exports updateChangelogEntry', () => {
      expect(typeof changelogQueries.updateChangelogEntry).toBe('function')
    })

    it('exports publishChangelogEntry', () => {
      expect(typeof changelogQueries.publishChangelogEntry).toBe('function')
    })

    it('exports unpublishChangelogEntry', () => {
      expect(typeof changelogQueries.unpublishChangelogEntry).toBe('function')
    })

    it('exports deleteChangelogEntry', () => {
      expect(typeof changelogQueries.deleteChangelogEntry).toBe('function')
    })
  })
})

describe('Query Function Signatures', () => {
  describe('Board query functions are async', () => {
    it('createBoard is async', () => {
      expect(boardQueries.createBoard.constructor.name).toBe('AsyncFunction')
    })

    it('getBoardById is async', () => {
      expect(boardQueries.getBoardById.constructor.name).toBe('AsyncFunction')
    })
  })

  describe('Post query functions are async', () => {
    it('createPost is async', () => {
      expect(postQueries.createPost.constructor.name).toBe('AsyncFunction')
    })

    it('getPostList is async', () => {
      expect(postQueries.getPostList.constructor.name).toBe('AsyncFunction')
    })

    it('toggleVote is async', () => {
      expect(postQueries.toggleVote.constructor.name).toBe('AsyncFunction')
    })
  })
})
