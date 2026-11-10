/**
 * Pinned, moderation and merge states in the portal colour with the
 * warning token, which is tuned to read in light and dark; the builder's AI
 * sparkle with the chrome's gold, which has a value per theme. Neither uses
 * the raw amber palette.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '../../..')
const FILES = [
  'components/public/comment-form.tsx',
  'components/public/comment-thread.tsx',
  'components/public/feedback/portal-moderation-section.tsx',
  'components/public/feedback/public-filters-bar.tsx',
  'components/public/post-detail/merge-banner.tsx',
  'components/public/post-detail/metadata-sidebar.tsx',
  'routes/_portal/u.$principalId.tsx',
  'components/designer/ai-pane.tsx',
  'components/designer/designer-ai.tsx',
]

describe('warning colours', () => {
  it.each(FILES)('%s uses tokens, not the amber palette', (file) => {
    const text = readFileSync(path.join(SRC, file), 'utf8')
    expect(text.match(/\bamber-\d+/g) ?? []).toEqual([])
  })
})
