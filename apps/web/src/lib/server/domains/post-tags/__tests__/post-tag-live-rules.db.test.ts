/**
 * Tag rules that only real SQL shows:
 * - FBA-T-31: a deleted tag frees its name, on create and on rename.
 * - FBA-T-32: deleting a tag removes it from every post it was on.
 *
 * Real Postgres in a rolled-back transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { boards, eq, postTagAssignments, posts, principal, user } from '@/lib/server/db'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createPostTag, deletePostTag, updatePostTag } from '../post-tag.service'

const fixture = await createDbTestFixture()
const nameOf = (label: string) =>
  `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

describe.skipIf(!fixture.available)('tag rules (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('FBA-T-31 a tag can be created with the name of a deleted tag', async () => {
    const name = nameOf('Reborn')
    const first = await createPostTag({ name })
    await deletePostTag(first.id)

    const again = await createPostTag({ name: name.toUpperCase() })
    expect(again.id).not.toBe(first.id)
    await expect(createPostTag({ name })).rejects.toMatchObject({ code: 'DUPLICATE_NAME' })
  })

  it('FBA-T-31 a tag can be renamed to the name of a deleted tag', async () => {
    const name = nameOf('Old')
    const gone = await createPostTag({ name })
    await deletePostTag(gone.id)
    const other = await createPostTag({ name: nameOf('Other') })

    const renamed = await updatePostTag(other.id, { name })
    expect(renamed.name).toBe(name)
  })

  it('FBA-T-32 deleting a tag removes it from the posts it was on', async () => {
    const userId = createId('user') as UserId
    const author = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: userId, name: 'Author' })
    await testDb
      .insert(principal)
      .values({ id: author, userId, role: 'admin', type: 'user', createdAt: new Date() })
    const [board] = await testDb
      .insert(boards)
      .values({ slug: `tags-${createId('board')}`, name: 'Tags', access: DEFAULT_BOARD_ACCESS })
      .returning()
    const [post] = await testDb
      .insert(posts)
      .values({ boardId: board.id, title: 'Tagged', content: '', principalId: author })
      .returning()
    const gone = await createPostTag({ name: nameOf('Gone') })
    const kept = await createPostTag({ name: nameOf('Kept') })
    await testDb.insert(postTagAssignments).values([
      { postId: post.id, tagId: gone.id },
      { postId: post.id, tagId: kept.id },
    ])

    await deletePostTag(gone.id)

    const left = await testDb
      .select({ tagId: postTagAssignments.tagId })
      .from(postTagAssignments)
      .where(eq(postTagAssignments.postId, post.id))
    expect(left.map((r) => r.tagId)).toEqual([kept.id])
  })
})
