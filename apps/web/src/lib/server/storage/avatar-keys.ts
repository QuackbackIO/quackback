/**
 * Where a person's uploaded avatars live in storage. Each person uploads into
 * a folder of their own, `avatars/<userId>/`, so the server can tell a key the
 * caller uploaded from one somebody else did: a person may save, replace and
 * delete only objects in their own folder.
 *
 * Avatars saved before per-person folders sit at `avatars/<yyyy>/<mm>/...`.
 * Their holders keep them, but nobody can newly claim one, and no one's
 * action deletes one from storage.
 */
import type { UserId } from '@quackback/ids'

/** The storage folder (no trailing slash) a person's avatar uploads go into. */
export function avatarFolderFor(userId: UserId | string): string {
  return `avatars/${userId}`
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether `key` is an object in this person's own avatar folder, in exactly
 * the shape `generateStorageKey` gives an upload there:
 * `avatars/<userId>/<yyyy>/<mm>/<uuid>-<safe filename>`. Matching the whole
 * shape (not a prefix) means no encoded or literal dot segment, slash or
 * backslash can walk the key into somebody else's folder.
 */
export function isOwnAvatarKey(key: string, userId: UserId | string): boolean {
  const folder = escapeRegExp(avatarFolderFor(userId))
  const shape = new RegExp(
    `^${folder}/\\d{4}/\\d{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-z0-9._-]+$`
  )
  return shape.test(key)
}
