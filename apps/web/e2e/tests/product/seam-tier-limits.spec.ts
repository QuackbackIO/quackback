/**
 * The plan limits writer (`withTierLimits`, e2e/support/isolated-settings.ts):
 * an `@isolated` test sets stored tier limits, the app enforces them on the
 * next request, and the previous limits come back afterwards.
 *
 * Tier limits are workspace-wide, so this runs only in the product-isolated
 * job (E2E_SUPPORT_ISOLATED=1, one worker, its own database).
 */
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { supportDb } from '../../support/db'
import { snapshotTierLimits, withTierLimits } from '../../support/isolated-settings'
import { createBoard, workspaceApi } from '../../product/rest'

test(
  'a board cap in the stored plan limits refuses one more board, and lifts after',
  { tag: ['@isolated', '@core'] },
  async ({ playwright, baseURL, people, marker }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    const api = await workspaceApi(playwright, baseURL, people)
    const before = await snapshotTierLimits()

    const [{ count }] = await supportDb()<{ count: number }[]>`
      SELECT count(*)::int AS count FROM boards WHERE deleted_at IS NULL`

    await withTierLimits({ maxBoards: count }, async () => {
      const res = await api.post('/api/v1/boards', { data: { name: `${marker} over the cap` } })
      expect(res.status(), await res.text()).toBe(402)
      expect(await res.json()).toMatchObject({
        error: 'tier_limit_exceeded',
        limit: 'maxBoards',
        max: count,
      })
    })

    // The previous limits are back exactly, and so is room for a board.
    expect(await snapshotTierLimits()).toBe(before)
    await createBoard(api, `${marker} after the cap`)
  }
)
