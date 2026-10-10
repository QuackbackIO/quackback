import { describe, it, expect } from 'vitest'
import { slugify } from '@/lib/shared/utils/slugify'
import { workspaceSlugFor } from '../workspace-slug'

describe('workspaceSlugFor', () => {
  it('slugifies a name with letters in it', () => {
    expect(workspaceSlugFor('Fernhill Outdoor & Co.')).toBe('fernhill-outdoor-and-co')
  })

  it('keeps a romanized slug for a non-Latin name', () => {
    expect(workspaceSlugFor('日本語')).toBe(slugify('日本語'))
    expect(workspaceSlugFor('日本語').length).toBeGreaterThanOrEqual(2)
  })

  // Any name of two or more characters is a valid workspace name, so a name
  // with nothing to romanize still gets a slug rather than an error.
  it.each(['🦆🦆', '!!', '✨ ✨', 'A!'])('falls back for %s', (name) => {
    expect(workspaceSlugFor(name)).toBe('workspace')
  })
})
