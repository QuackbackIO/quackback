// @vitest-environment happy-dom
/**
 * Portal settings/preferences loader: pre-fetches the notification matrix
 * so NotificationMatrixForm (rendered below) gets it as `initialPreferences`
 * instead of firing its own post-hydration request, and reads the matrix's
 * strings, which only this page shows, with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <T extends object>(options: T) => ({ ...options }),
}))

const getNotificationPreferencesFn = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/functions/user', () => ({
  getNotificationPreferencesFn: (...args: unknown[]) => getNotificationPreferencesFn(...args),
}))

import { Route } from '../settings.preferences'

beforeEach(() => {
  getNotificationPreferencesFn.mockReset()
  getNotificationPreferencesFn.mockResolvedValue({
    emailStatusChange: true,
    emailNewComment: true,
    emailMuted: false,
    matrix: {},
  })
})

type Loader = (args: {
  context: { acceptLanguageLocale?: string }
}) => Promise<{ notificationPreferences: unknown; messages: Record<string, string> }>

describe('settings/preferences loader', () => {
  it('fetches notification preferences once, in the document response', async () => {
    const data = await (Route as unknown as { loader: Loader }).loader({ context: {} })

    expect(getNotificationPreferencesFn).toHaveBeenCalledTimes(1)
    expect(data.notificationPreferences).toEqual({
      emailStatusChange: true,
      emailNewComment: true,
      emailMuted: false,
      matrix: {},
    })
  })

  it("reads the matrix's strings in the visitor's language", async () => {
    const data = await (Route as unknown as { loader: Loader }).loader({
      context: { acceptLanguageLocale: 'pl' },
    })

    expect(data.messages['portal.settings.notifications.pauseAll.label']).toBe(
      'Wstrzymaj wszystkie e-maile'
    )
    const ids = Object.keys(data.messages)
    expect(ids.filter((id) => !id.startsWith('portal.settings.notifications.'))).toEqual([])
  })
})
