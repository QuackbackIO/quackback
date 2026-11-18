// @vitest-environment happy-dom
/**
 * The words team and channel limits show people: none of the plan limits words
 * that are never shown (the glossary), no em dashes, and the paused person is
 * never told about seats. Scans the values people read (thrown messages, copy
 * helpers, the rendered paused page), never source text, where identifiers
 * and comments may use those words.
 *
 * The plan limits view is a stand-in that says the caps are enforced on the
 * Free plan; whether the refusals happen is proved against a database in
 * plan-limits.team.db.test.ts. Here: only what they say.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', () => ({
  getPlanLimits: async () => ({
    enabled: true,
    phase: 'enforced',
    plan: 'free',
    issues: [{ key: 'maxHelpCenterLocales', cap: 1 }],
  }),
  isCapEnforced: async () => true,
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getHelpCenterConfig: async () => ({ locales: { default: 'en', additional: ['fr'] } }),
}))

import { SEAT_PAUSED_DENIAL } from '@/lib/shared/billing/seat-paused'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { sendingPausedDetail } from '@/components/admin/settings/domains-overview'
import { hiddenLine } from '@/components/admin/status/status-components-view'
import {
  assertCustomRoleAssignable,
  assertCustomRoleEditable,
  customRolesLockedLine,
} from '@/lib/server/domains/roles/role.plan-lock'
import { assertHelpCenterLocaleEditable } from '@/lib/server/domains/plan-limits/plan-limits.locales'

afterEach(cleanup)

const BANNED = [
  /\bgrace\b/i,
  /\bfrozen\b/i,
  /\bfreeze\b/i,
  /\bheld\b/i,
  /\bswitch\b/i,
  /\benforce/i,
  /\bextras\b/i,
  /current plan/i,
  /on your plan/i,
  /choose a plan/i,
  /keep pro/i,
  /choose pro/i,
  /an owner/i,
  /—/,
]

function bannedIn(text: string): string[] {
  return BANNED.filter((pattern) => pattern.test(text)).map(String)
}

const messageOf = async (run: () => Promise<unknown>) =>
  run().then(
    () => '',
    (e: Error) => e.message
  )

describe('team and channel limits copy', () => {
  it('flags a planted banned word, so the scan can fail', () => {
    expect(bannedIn('Held during the grace period. Ask an owner.')).toHaveLength(3)
  })

  it('keeps the copy helpers plain, naming the plan', () => {
    const lines = [
      sendingPausedDetail('Free'),
      sendingPausedDetail(null),
      hiddenLine(1, 'Free'),
      hiddenLine(3, null),
      customRolesLockedLine('Free'),
      SEAT_PAUSED_DENIAL,
    ]
    for (const line of lines) expect(bannedIn(line)).toEqual([])
    expect(sendingPausedDetail('Free')).toBe(
      'Paused on the Free plan. Email goes from your default address.'
    )
  })

  it('keeps the refusals people see plain, naming the plan', async () => {
    const messages = [
      await messageOf(() => assertCustomRoleEditable({ isSystem: false })),
      await messageOf(() => assertCustomRoleAssignable({ isSystem: false })),
      await messageOf(() => assertHelpCenterLocaleEditable('fr')),
    ]
    expect(messages).toEqual([
      'Custom roles are locked on the Free plan. People on them keep their access.',
      'Custom roles are locked on the Free plan. Pick a built-in role.',
      'This language is locked on the Free plan. Its published pages stay live.',
    ])
    for (const message of messages) expect(bannedIn(message)).toEqual([])
  })

  it('never tells the paused person about seats', () => {
    const { container } = render(<DefaultErrorPage error={{ message: SEAT_PAUSED_DENIAL }} />)
    const text = container.textContent ?? ''
    expect(text).toContain('Your admin access is paused')
    expect(text).not.toMatch(/\bseats?\b/i)
    expect(bannedIn(text)).toEqual([])
  })
})
