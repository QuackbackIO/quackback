/**
 * A person's own avatar key is exactly the shape an upload into their folder
 * gets, so no literal or encoded dot segment, slash or backslash can walk a
 * key out of their folder into someone else's.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://app.example.com' },
}))

const { generateStorageKey } = await import('@/lib/server/storage/s3')
const { avatarFolderFor, isOwnAvatarKey } = await import('@/lib/server/storage/avatar-keys')

const ME = 'user_01kaaaaaaaaaaaaaaaaaaaaaaa'
const THEM = 'user_01kbbbbbbbbbbbbbbbbbbbbbbb'
const UUID = '0b8f3c2e-4d1a-4e6b-9a7c-1f2e3d4c5b6a'

describe('isOwnAvatarKey', () => {
  it('accepts every key the upload path issues into their folder', () => {
    for (const name of ['me.png', 'My Photo (1).JPG', '..png', 'a b/c\\d.webp']) {
      expect(isOwnAvatarKey(generateStorageKey(avatarFolderFor(ME), name), ME)).toBe(true)
    }
  })

  it("refuses someone else's upload", () => {
    expect(isOwnAvatarKey(generateStorageKey(avatarFolderFor(THEM), 'x.png'), ME)).toBe(false)
  })

  it.each([
    ['a literal dot segment', `avatars/${ME}/../${THEM}/2026/11/${UUID}-x.png`],
    ['an encoded dot segment', `avatars/${ME}/%2e%2e/${THEM}/2026/11/${UUID}-x.png`],
    ['an upper-case encoded dot segment', `avatars/${ME}/%2E%2E/${THEM}/2026/11/${UUID}-x.png`],
    ['an encoded slash', `avatars/${ME}/2026/11/${UUID}-x%2F..%2F..%2F${THEM}.png`],
    ['a backslash', `avatars/${ME}/2026/11/${UUID}-x\\..\\${THEM}.png`],
    ['an extra folder', `avatars/${ME}/2026/11/extra/${UUID}-x.png`],
    ['a missing date', `avatars/${ME}/${UUID}-x.png`],
    ['a short random part', `avatars/${ME}/2026/11/0b8f3c2e-x.png`],
    ['a folder that only starts with their id', `avatars/${ME}x/2026/11/${UUID}-x.png`],
    ['an older shared-folder key', `avatars/2026/11/${UUID}-x.png`],
  ])('refuses %s', (_label, key) => {
    expect(isOwnAvatarKey(key, ME)).toBe(false)
  })
})
