/**
 * Custom saved inbox views (support platform §4.6): CRUD over the workspace-
 * shared `conversation_views` plus per-teammate pins in `conversation_view_pins`.
 *
 * A view is a saved filter set (see lib/shared/conversation/views.ts) — the
 * server stores + serves it; the running/translation happens client-side. Views
 * are shared by default; listing resolves each view's per-viewer `isPinned` and
 * returns pinned-first. Mutations are gated at the function layer
 * (conversation.manage_views); pinning is a personal action (conversation.view).
 */
import {
  db,
  conversationViews,
  conversationViewPins,
  eq,
  and,
  or,
  asc,
  isNull,
} from '@/lib/server/db'
import type { ConversationViewId, PrincipalId } from '@quackback/ids'
import type {
  ConversationViewDTO,
  ConversationViewFilters,
  TermlessConversationSort,
} from '@/lib/shared/conversation/views'

function toDTO(row: {
  id: ConversationViewId
  name: string
  filters: ConversationViewFilters
  sort: string | null
  isShared: boolean
  isPinned: boolean
}): ConversationViewDTO {
  return {
    id: row.id,
    name: row.name,
    filters: row.filters,
    sort: (row.sort as TermlessConversationSort | null) ?? null,
    isShared: row.isShared,
    isPinned: row.isPinned,
  }
}

/**
 * Every view visible to this teammate — shared views plus their own private
 * ones — with pin state, pinned-first then alphabetical. A LEFT JOIN on the
 * viewer's pins resolves `isPinned` in one query.
 */
export async function listViewsForPrincipal(
  principalId: PrincipalId
): Promise<ConversationViewDTO[]> {
  const rows = await db
    .select({
      id: conversationViews.id,
      name: conversationViews.name,
      filters: conversationViews.filters,
      sort: conversationViews.sort,
      isShared: conversationViews.isShared,
      pinnedAt: conversationViewPins.createdAt,
    })
    .from(conversationViews)
    .leftJoin(
      conversationViewPins,
      and(
        eq(conversationViewPins.viewId, conversationViews.id),
        eq(conversationViewPins.principalId, principalId)
      )
    )
    .where(
      and(
        or(
          eq(conversationViews.isShared, true),
          eq(conversationViews.createdByPrincipalId, principalId)
        ),
        isNull(conversationViews.deletedAt)
      )
    )
    .orderBy(asc(conversationViews.name))

  return rows
    .map((r) =>
      toDTO({
        id: r.id,
        name: r.name,
        // Stored JSON is validated on write (zod), so trust it into the app shape.
        filters: r.filters as ConversationViewFilters,
        sort: r.sort,
        isShared: r.isShared,
        isPinned: r.pinnedAt != null,
      })
    )
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || a.name.localeCompare(b.name))
}

export interface CreateViewInput {
  name: string
  filters: ConversationViewFilters
  sort?: TermlessConversationSort | null
  isShared?: boolean
}

export async function createView(
  input: CreateViewInput,
  createdByPrincipalId: PrincipalId
): Promise<ConversationViewId> {
  const [row] = await db
    .insert(conversationViews)
    .values({
      name: input.name,
      filters: input.filters,
      sort: input.sort ?? null,
      isShared: input.isShared ?? true,
      createdByPrincipalId,
    })
    .returning({ id: conversationViews.id })
  return row.id
}

export interface UpdateViewInput {
  name?: string
  filters?: ConversationViewFilters
  sort?: TermlessConversationSort | null
  isShared?: boolean
}

export async function updateView(id: ConversationViewId, input: UpdateViewInput): Promise<void> {
  await db
    .update(conversationViews)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.filters !== undefined ? { filters: input.filters } : {}),
      ...(input.sort !== undefined ? { sort: input.sort } : {}),
      ...(input.isShared !== undefined ? { isShared: input.isShared } : {}),
    })
    .where(and(eq(conversationViews.id, id), isNull(conversationViews.deletedAt)))
}

/** Soft-delete a view and drop everyone's pins for it (it leaves every nav). */
export async function deleteView(id: ConversationViewId): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(conversationViews)
      .set({ deletedAt: new Date() })
      .where(eq(conversationViews.id, id))
    await tx.delete(conversationViewPins).where(eq(conversationViewPins.viewId, id))
  })
}

/** Pin a view for a teammate (idempotent). */
export async function pinView(principalId: PrincipalId, viewId: ConversationViewId): Promise<void> {
  await db
    .insert(conversationViewPins)
    .values({ principalId, viewId })
    .onConflictDoNothing({
      target: [conversationViewPins.principalId, conversationViewPins.viewId],
    })
}

export async function unpinView(
  principalId: PrincipalId,
  viewId: ConversationViewId
): Promise<void> {
  await db
    .delete(conversationViewPins)
    .where(
      and(
        eq(conversationViewPins.principalId, principalId),
        eq(conversationViewPins.viewId, viewId)
      )
    )
}
