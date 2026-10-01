// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// A deployment that shipped the module without its wasm.
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: (path: string) => !String(path).endsWith('mupdf-wasm.wasm'),
}))

import { loadMupdf } from '../mupdf'
import { PreviewDependencyError } from '../result'

describe('loadMupdf', () => {
  it('reports a missing wasm as a dependency fault instead of importing the module', async () => {
    await expect(loadMupdf()).rejects.toBeInstanceOf(PreviewDependencyError)
  })
})
