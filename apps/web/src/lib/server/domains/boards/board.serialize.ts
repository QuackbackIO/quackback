import type { BoardSettings } from '@/lib/server/db'

/**
 * A board as a portal or widget visitor sees it: no access matrix, and no
 * `readOnly` flag. Read-only state reaches visitors only through the per-board
 * permissions, which name no plan.
 */
export function serializePublicBoard<
  B extends { access: unknown; settings: unknown; readOnly?: boolean },
>({ access: _access, readOnly: _readOnly, ...board }: B) {
  return { ...board, settings: (board.settings ?? {}) as BoardSettings }
}
