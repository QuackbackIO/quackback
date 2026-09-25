// @vitest-environment happy-dom
/**
 * NotificationMatrixForm's mount fetch.
 *
 * The portal preferences page's loader now fetches this data itself (folded
 * into the document response, same session/principal lookup the parent
 * layout already pays for) and hands it down as `initialPreferences`. The
 * form must use that seed instead of firing its own request; admin's
 * settings page has no such loader and keeps fetching on mount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const getNotificationPreferencesFn = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/functions/user', () => ({
  getNotificationPreferencesFn: (...args: unknown[]) => getNotificationPreferencesFn(...args),
  updateNotificationPreferencesFn: vi.fn(),
}))

import { NotificationMatrixForm } from '../notification-matrix-form'

const preferences = {
  emailStatusChange: true,
  emailNewComment: true,
  emailMuted: false,
  matrix: {},
}

beforeEach(() => {
  getNotificationPreferencesFn.mockReset()
  getNotificationPreferencesFn.mockResolvedValue(preferences)
})

afterEach(cleanup)

describe('NotificationMatrixForm', () => {
  it('uses initialPreferences instead of fetching, when the loader already supplied it', async () => {
    render(<NotificationMatrixForm surface="portal" initialPreferences={preferences} />)

    // Renders straight from the seed: the "pause all email" switch is on
    // screen with no loading spinner in between.
    expect(await screen.findByLabelText('Pause all email notifications')).toBeTruthy()
    expect(getNotificationPreferencesFn).not.toHaveBeenCalled()
  })

  it('falls back to its own fetch when no seed is supplied (admin surface)', async () => {
    render(<NotificationMatrixForm surface="admin" />)

    expect(await screen.findByLabelText('Pause all email notifications')).toBeTruthy()
    expect(getNotificationPreferencesFn).toHaveBeenCalledTimes(1)
  })
})
