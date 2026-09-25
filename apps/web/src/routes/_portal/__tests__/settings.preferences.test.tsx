// @vitest-environment happy-dom
/**
 * Portal settings/preferences loader: pre-fetches the notification matrix
 * so NotificationMatrixForm (rendered below) gets it as `initialPreferences`
 * instead of firing its own post-hydration request.
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

describe('settings/preferences loader', () => {
  it('fetches notification preferences once, in the document response', async () => {
    const data = await (
      Route as unknown as { loader: () => Promise<{ notificationPreferences: unknown }> }
    ).loader()

    expect(getNotificationPreferencesFn).toHaveBeenCalledTimes(1)
    expect(data.notificationPreferences).toEqual({
      emailStatusChange: true,
      emailNewComment: true,
      emailMuted: false,
      matrix: {},
    })
  })
})
