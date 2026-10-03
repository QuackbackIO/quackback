import { describe, expect, it } from 'vitest'
import { parseUserAttributes } from '@/lib/server/domains/users/user.attributes'
import { readOnboardingProgress, withOnboardingMark } from '../onboarding-progress'

const AT = '2026-10-03T10:00:00.000Z'
const EARLIER = '2026-10-01T10:00:00.000Z'

describe('per-person onboarding markers in user metadata', () => {
  it('reads the internal key', () => {
    expect(
      readOnboardingProgress(JSON.stringify({ _onboarding: { tourSeenAt: AT, junk: 1 } }))
    ).toEqual({ tourSeenAt: AT })
  })

  it('still reads markers saved under the old key, the new key winning', () => {
    expect(
      readOnboardingProgress(
        JSON.stringify({
          onboarding: { tourSeenAt: EARLIER, firstWinShownAt: EARLIER },
          _onboarding: { tourSeenAt: AT },
        })
      )
    ).toEqual({ tourSeenAt: AT, firstWinShownAt: EARLIER })
    expect(readOnboardingProgress(JSON.stringify({ onboarding: 'done' }))).toEqual({})
    expect(readOnboardingProgress('not json')).toEqual({})
    expect(readOnboardingProgress(null)).toEqual({})
  })

  it('writes under the internal key, which is never a custom attribute', () => {
    const written = withOnboardingMark(JSON.stringify({ plan: 'pro' }), 'tourSeenAt', AT)
    expect(JSON.parse(written!)).toEqual({ plan: 'pro', _onboarding: { tourSeenAt: AT } })
    expect(parseUserAttributes(written)).toEqual({ plan: 'pro' })
    expect(readOnboardingProgress(written)).toEqual({ tourSeenAt: AT })
  })

  it('moves markers from the old key and stops exposing it as an attribute', () => {
    const written = withOnboardingMark(
      JSON.stringify({ plan: 'pro', onboarding: { tourSeenAt: EARLIER } }),
      'firstWinShownAt',
      AT
    )
    expect(JSON.parse(written!)).toEqual({
      plan: 'pro',
      _onboarding: { tourSeenAt: EARLIER, firstWinShownAt: AT },
    })
    expect(parseUserAttributes(written)).toEqual({ plan: 'pro' })
  })

  it('leaves a customer attribute called onboarding alone', () => {
    for (const onboarding of [
      'complete',
      { stage: 'trial' },
      { stage: 'trial', tourSeenAt: 'x' },
    ]) {
      const written = withOnboardingMark(JSON.stringify({ onboarding }), 'tourDismissedAt', AT)
      expect(JSON.parse(written!).onboarding).toEqual(onboarding)
      expect(parseUserAttributes(written)).toEqual({ onboarding })
    }
  })

  it('writes nothing when the marker is already set under either key', () => {
    expect(
      withOnboardingMark(JSON.stringify({ _onboarding: { tourSeenAt: AT } }), 'tourSeenAt', AT)
    ).toBeNull()
    expect(
      withOnboardingMark(JSON.stringify({ onboarding: { tourSeenAt: AT } }), 'tourSeenAt', AT)
    ).toBeNull()
  })

  it('treats unreadable metadata as an empty profile', () => {
    expect(JSON.parse(withOnboardingMark('[1,2]', 'tourSeenAt', AT)!)).toEqual({
      _onboarding: { tourSeenAt: AT },
    })
    expect(JSON.parse(withOnboardingMark(null, 'tourSeenAt', AT)!)).toEqual({
      _onboarding: { tourSeenAt: AT },
    })
  })
})
