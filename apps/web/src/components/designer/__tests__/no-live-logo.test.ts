/**
 * The builder and Appearance only draft: nothing in them replaces the
 * workspace's logo, which the admin and emails use. A publish asked to use
 * the portal's logo there too is the one way it changes from the design.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', '..', '..')
const LIVE_WRITES = /useUploadWorkspaceLogo|saveLogoKey|getLogoUploadUrlFn/

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe('the workspace logo from the builder', () => {
  it('is never written live by the builder, Appearance or the design AI', () => {
    const files = [
      ...sources(join(SRC, 'components', 'designer')),
      ...sources(join(SRC, 'components', 'admin', 'settings', 'appearance')),
      join(SRC, 'lib', 'server', 'functions', 'portal-design-ai.ts'),
      ...sources(join(SRC, 'lib', 'server', 'domains', 'design', 'ai')),
    ]
    const writers = files
      .filter((file) => LIVE_WRITES.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
    expect(writers).toEqual([])
  })
})
