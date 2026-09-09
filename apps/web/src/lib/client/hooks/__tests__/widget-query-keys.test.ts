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

  describe('articleDetail', () => {
    it('byRef includes ref, locale, and version', () => {
      expect(widgetQueryKeys.articleDetail.byRef('article_1', 0, 'en')).toEqual([
        'widget',
        'article',
        'article_1',
        'en',
        0,
      ])
    })

    it('same ref with different locales produce different keys', () => {
      const en = widgetQueryKeys.articleDetail.byRef('article_1', 0, 'en')
      const de = widgetQueryKeys.articleDetail.byRef('article_1', 0, 'de')
      expect(en).not.toEqual(de)
    })
  })

  describe('changelogDetail', () => {
    it('byId includes entryId and version', () => {
      expect(widgetQueryKeys.changelogDetail.byId('changelog_1', 2)).toEqual([
        'widget',
        'changelog',
        'changelog_1',
        2,
      ])
    })
  })

  describe('popularPosts', () => {
    it('list includes board slug and version', () => {
      expect(widgetQueryKeys.popularPosts.list(null, 0)).toEqual([
        'widget',
        'posts',
        'popular',
        'top',
        'all',
        0,
      ])
      expect(widgetQueryKeys.popularPosts.list('bugs', 1)).toEqual([
        'widget',
        'posts',
        'popular',
        'top',
        'bugs',
        1,
      ])
    })
  })

  it('INITIAL_SESSION_VERSION is 0', () => {
    expect(INITIAL_SESSION_VERSION).toBe(0)
  })
})
