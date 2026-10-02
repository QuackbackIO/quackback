import { describe, expect, it } from 'vitest'
import '../schemas'
import { generateOpenAPISpec } from '../openapi'

describe('files OpenAPI contract', () => {
  const spec = generateOpenAPISpec()
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  const paths = spec.paths as any

  it('registers the file upload route', () => {
    expect(paths['/files']).toHaveProperty('post')
  })

  it('never uses an em dash in the upload route description (public docs)', () => {
    expect(paths['/files'].post.description).not.toContain('—')
  })
})
