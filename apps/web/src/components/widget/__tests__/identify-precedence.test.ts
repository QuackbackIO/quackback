import { describe, it, expect } from 'vitest'
import { resolveIdentifyAction } from '../identify-precedence'

/**
 * Tests for widget identify precedence logic.
 *
 * When the widget receives an identify call, the action depends on:
 * - Whether a portal session exists (same-origin context)
 * - Whether the identify is anonymous or named
 * - Whether the session source was portal or SDK
 *
 * Precedence:
 * 1. SDK identified (id+email) — always wins
 * 2. Portal session — wins over anonymous
 * 3. SDK anonymous — lowest priority when portal session exists
 */

describe('resolveIdentifyAction', () => {
  describe('anonymous identify', () => {
    it('runs anonymous identify on external sites (no portal session)', () => {
      const action = resolveIdentifyAction({
        identifyData: { anonymous: true },
        hasPortalSession: false,
        sessionSource: null,
      })
      expect(action).toBe('anonymous')
    })

    it('skips anonymous identify when portal session exists', () => {
      const action = resolveIdentifyAction({
        identifyData: { anonymous: true },
        hasPortalSession: true,
        sessionSource: null,
      })
      expect(action).toBe('skip')
    })

    it('skips anonymous identify when portal session is already hydrated', () => {
      const action = resolveIdentifyAction({
        identifyData: { anonymous: true },
        hasPortalSession: true,
        sessionSource: 'portal',
      })
      expect(action).toBe('skip')
    })

    it('runs anonymous identify after explicit SDK override (user logged out)', () => {
      // SDK previously called identify with a named user, now calling anonymous
      // This means the host app is explicitly requesting anonymous mode
      const action = resolveIdentifyAction({
        identifyData: { anonymous: true },
        hasPortalSession: false,
        sessionSource: 'sdk',
      })
      expect(action).toBe('anonymous')
    })
  })

  describe('named identify (SDK)', () => {
    it('runs SDK identify on external sites', () => {
      const action = resolveIdentifyAction({
        identifyData: { id: 'user_1', email: 'jane@example.com' },
        hasPortalSession: false,
        sessionSource: null,
      })
      expect(action).toBe('identify')
    })

    it('runs SDK identify even when portal session exists (explicit override)', () => {
      const action = resolveIdentifyAction({
        identifyData: { id: 'user_1', email: 'jane@example.com' },
        hasPortalSession: true,
        sessionSource: 'portal',
      })
      expect(action).toBe('identify')
    })

    it('runs SDK identify when overriding a previous SDK session', () => {
      const action = resolveIdentifyAction({
        identifyData: { id: 'user_2', email: 'bob@example.com' },
        hasPortalSession: false,
        sessionSource: 'sdk',
      })
      expect(action).toBe('identify')
    })
  })

  describe('clear identify (null)', () => {
    it('always clears regardless of portal session', () => {
      const action = resolveIdentifyAction({
        identifyData: null,
        hasPortalSession: true,
        sessionSource: 'portal',
      })
      expect(action).toBe('clear')
    })

    it('clears on external sites', () => {
      const action = resolveIdentifyAction({
        identifyData: null,
        hasPortalSession: false,
        sessionSource: 'sdk',
      })
      expect(action).toBe('clear')
    })
  })
})
