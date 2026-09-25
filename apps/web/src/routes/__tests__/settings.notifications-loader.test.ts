/**
 * The admin notifications page loads the viewer's own preferences with the
 * page, so the matrix is in the document rather than behind a spinner and a
 * fetch after hydration. A failed read leaves the form to fetch them itself.
 */
import { describe, expect, it, vi } from 'vitest'

const { getNotificationPreferencesFn } = vi.hoisted(() => ({
  getNotificationPreferencesFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/user')>()),
  getNotificationPreferencesFn,
}))

const { Route } = await import('../admin/settings.notifications')

type LoaderFn = (ctx: { context: Record<string, unknown> }) => Promise<unknown>
const loader = (Route as unknown as { options: { loader: LoaderFn } }).options.loader

describe('notifications settings loader', () => {
  it("loads the viewer's preferences with the page", async () => {
    getNotificationPreferencesFn.mockResolvedValueOnce({
      emailStatusChange: true,
      emailNewComment: true,
      emailMuted: false,
    })
    expect(await loader({ context: {} })).toEqual({
      preferences: expect.objectContaining({ emailMuted: false }),
    })
  })

  it('leaves the preferences to the form when the read fails', async () => {
    getNotificationPreferencesFn.mockRejectedValueOnce(new Error('unavailable'))
    expect(await loader({ context: {} })).toEqual({ preferences: null })
  })
})
