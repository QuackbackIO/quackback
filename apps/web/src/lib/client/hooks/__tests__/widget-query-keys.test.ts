import { describe, it, expect } from 'vitest'
import { widgetQueryKeys, INITIAL_SESSION_VERSION } from '../use-widget-vote'

describe('widgetQueryKeys', () => {
  describe('votedPosts', () => {
    it('all key is stable', () => {
      expect(widgetQueryKeys.votedPosts.all).toEqual(['widget', 'votedPosts'])
    })

    it('bySession includes version number', () => {
      expect(widgetQueryKeys.votedPosts.bySession(0)).toEqual(['widget', 'votedPosts', 0])
      expect(widgetQueryKeys.votedPosts.bySession(3)).toEqual(['widget', 'votedPosts', 3])
    })

    it('different versions produce different keys', () => {
      const key1 = widgetQueryKeys.votedPosts.bySession(1)
      const key2 = widgetQueryKeys.votedPosts.bySession(2)
      expect(key1).not.toEqual(key2)
    })
  })

  describe('postDetail', () => {
    it('all key is stable', () => {
      expect(widgetQueryKeys.postDetail.all).toEqual(['widget', 'post'])
    })

    it('byId includes postId and version', () => {
      expect(widgetQueryKeys.postDetail.byId('post_123', 0)).toEqual([
        'widget',
        'post',
        'post_123',
        0,
      ])
    })

    it('different posts produce different keys', () => {
      const key1 = widgetQueryKeys.postDetail.byId('post_1', 0)
      const key2 = widgetQueryKeys.postDetail.byId('post_2', 0)
      expect(key1).not.toEqual(key2)
    })

    it('same post with different versions produce different keys', () => {
      const key1 = widgetQueryKeys.postDetail.byId('post_1', 0)
      const key2 = widgetQueryKeys.postDetail.byId('post_1', 1)
      expect(key1).not.toEqual(key2)
    })
  })

  it('INITIAL_SESSION_VERSION is 0', () => {
    expect(INITIAL_SESSION_VERSION).toBe(0)
  })
})
