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

/** Whether `key` is an object in this person's own avatar folder. */
export function isOwnAvatarKey(key: string, userId: UserId | string): boolean {
  return key.startsWith(`${avatarFolderFor(userId)}/`) && !key.includes('..')
}
