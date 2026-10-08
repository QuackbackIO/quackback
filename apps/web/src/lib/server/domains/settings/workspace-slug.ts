import { slugify } from '@/lib/shared/utils/slugify'

/** The slug for a workspace whose name has nothing to romanize. */
const FALLBACK_WORKSPACE_SLUG = 'workspace'

/**
 * The workspace slug for a name. Any name of two or more characters is a valid
 * workspace name, including one made only of emoji or punctuation, which
 * romanizes to nothing; that name still needs a slug, so it gets the fallback.
 *
 * Unique by construction: the settings table holds a single workspace.
 */
export function workspaceSlugFor(name: string): string {
  const slug = slugify(name)
  return slug.length >= 2 ? slug : FALLBACK_WORKSPACE_SLUG
}
