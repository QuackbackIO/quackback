import { describe, expect, it } from 'vitest'
import '../schemas'
import { generateOpenAPISpec } from '../openapi'

describe('roadmap OpenAPI contract', () => {
  it('publishes the derived-view contract within API v1', () => {
    const spec = generateOpenAPISpec()
    const roadmapPosts = spec.paths?.['/roadmaps/{roadmapId}/posts']
    const roadmapPaths = JSON.stringify({
      collection: spec.paths?.['/roadmaps'],
      detail: spec.paths?.['/roadmaps/{roadmapId}'],
      posts: roadmapPosts,
    })

    expect(spec.info.version).toBe('1.0.0')
    expect(roadmapPosts).toHaveProperty('get')
    expect(roadmapPosts).not.toHaveProperty('post')
    expect(spec.paths).not.toHaveProperty('/roadmaps/{roadmapId}/posts/{postId}')
    expect(roadmapPaths).not.toContain('isPublic')
    expect(JSON.stringify(roadmapPosts)).not.toContain('position')
  })
})
