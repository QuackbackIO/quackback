/**
 * Saved feedback-inbox views: CRUD over the workspace-shared `post_views`.
 *
 * A view is a saved filter set (see lib/shared/post/views.ts) — the server
 * stores + serves it; the running/translation happens client-side. Views are
 * shared by default; listing shows shared views plus the caller's own private
 * ones. Mutations are gated at the function layer (post.edit); listing is
 * available to any inbox viewer (post.view_private).
 */
import { db, postViews, eq, and, or, asc, isNull } from '@/lib/server/db'
import type { PostViewId, PrincipalId } from '@quackback/ids'
import type { PostViewDTO, PostViewFilters } from '@/lib/shared/post/views'

function toDTO(row: {
  id: PostViewId
  name: string
  filters: PostViewFilters
  isShared: boolean
}): PostViewDTO {
  return { id: row.id, name: row.name, filters: row.filters, isShared: row.isShared }
}

/** Every view visible to this teammate — shared views plus their own private
 *  ones — alphabetical. */
export async function listViewsForPrincipal(principalId: PrincipalId): Promise<PostViewDTO[]> {
  const rows = await db
    .select({
      id: postViews.id,
      name: postViews.name,
      filters: postViews.filters,
      isShared: postViews.isShared,
    })
    .from(postViews)
    .where(
      and(
        or(eq(postViews.isShared, true), eq(postViews.createdByPrincipalId, principalId)),
        isNull(postViews.deletedAt)
      )
    )
    .orderBy(asc(postViews.name))

  return rows.map((r) =>
    toDTO({
      id: r.id,
      name: r.name,
      // Stored JSON is validated on write (zod), so trust it into the app shape.
      filters: r.filters as PostViewFilters,
      isShared: r.isShared,
    })
  )
}

export interface CreatePostViewInput {
  name: string
  filters: PostViewFilters
  isShared?: boolean
}

export async function createView(
  input: CreatePostViewInput,
  createdByPrincipalId: PrincipalId
): Promise<PostViewId> {
  const [row] = await db
    .insert(postViews)
    .values({
      name: input.name,
      filters: input.filters,
      isShared: input.isShared ?? true,
      createdByPrincipalId,
    })
    .returning({ id: postViews.id })
  return row.id
}

/** Soft-delete a view (it leaves every teammate's listing). */
export async function deleteView(id: PostViewId): Promise<void> {
  await db.update(postViews).set({ deletedAt: new Date() }).where(eq(postViews.id, id))
}
