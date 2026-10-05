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
    expect(JSON.stringify(roadmapPosts)).not.toContain('position')
  })

  it('accepts isPublic only as a deprecated request alias for visibility', () => {
    const spec = generateOpenAPISpec()
    type Body = { properties?: Record<string, { deprecated?: boolean }> }
    const bodyOf = (op: unknown) =>
      (op as { requestBody: { content: { 'application/json': { schema: Body } } } }).requestBody
        .content['application/json'].schema
    const create = bodyOf(spec.paths?.['/roadmaps']?.post)
    const update = bodyOf(spec.paths?.['/roadmaps/{roadmapId}']?.patch)

    expect(create.properties?.isPublic?.deprecated).toBe(true)
    expect(update.properties?.isPublic?.deprecated).toBe(true)
    const responses = JSON.stringify({
      list: spec.paths?.['/roadmaps']?.get?.responses,
      detail: spec.paths?.['/roadmaps/{roadmapId}']?.get?.responses,
    })
    expect(responses).not.toContain('isPublic')
  })
})
