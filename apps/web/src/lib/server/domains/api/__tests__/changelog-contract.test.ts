import { describe, expect, it } from 'vitest'
import '../schemas'
import { generateOpenAPISpec } from '../openapi'

describe('changelog OpenAPI contract', () => {
  const spec = generateOpenAPISpec()
  const collection = spec.paths?.['/changelog'] as {
    get?: unknown
    post?: { requestBody?: unknown; responses?: unknown }
  }
  const detail = spec.paths?.['/changelog/{entryId}'] as {
    get?: { responses?: unknown }
    patch?: { requestBody?: unknown; responses?: unknown }
  }

  it('documents linkedPostIds on create and update bodies', () => {
    const createBody = JSON.stringify(collection.post?.requestBody)
    const updateBody = JSON.stringify(detail.patch?.requestBody)

    expect(createBody).toContain('linkedPostIds')
    expect(updateBody).toContain('linkedPostIds')
  })

  it('documents linkedPosts on list, get, create, and update responses', () => {
    const listResponse = JSON.stringify(collection.get)
    const createResponse = JSON.stringify(collection.post?.responses)
    const getResponse = JSON.stringify(detail.get?.responses)
    const patchResponse = JSON.stringify(detail.patch?.responses)

    expect(listResponse).toContain('linkedPosts')
    expect(createResponse).toContain('linkedPosts')
    expect(getResponse).toContain('linkedPosts')
    expect(patchResponse).toContain('linkedPosts')
  })
})
