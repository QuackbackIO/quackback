/**
 * Self-test: presence stays off for an automated admin browser by default,
 * turns on with the harness flag, and can be held from the test process.
 */
import { test, expect } from '../../../support/fixtures'
import {
  holdPresence,
  presenceRows,
  waitForPresence,
  withPresenceFlag,
} from '../../../support/presence'

test.describe('presence helper', { tag: '@smoke' }, () => {
  // These tests read one person's presence rows; run them one at a time.
  test.describe.configure({ mode: 'serial' })

  test('an automated admin browser is not online without the flag, and is with it', async ({
    asPerson,
    people,
  }) => {
    const agentB = people.people.agentB.principalId
    await waitForPresence(agentB, false)

    // Not the inbox: its own live stream counts as presence, flag or not.
    const plain = await asPerson('agentB')
    await plain.goto('/admin/settings')
    await expect(plain.getByRole('navigation').first()).toBeVisible({ timeout: 15_000 })
    // Give a stream time to open if the app were going to open one.
    await plain.waitForTimeout(2_000)
    expect(await presenceRows(agentB)).toEqual([])
    await plain.close()

    const flagged = await asPerson('agentB')
    await flagged.goto(withPresenceFlag('/admin/settings'))
    const rows = await waitForPresence(agentB, true)
    expect(rows[0].is_agent).toBe(true)

    // A later page in the same tab keeps the flag (remembered for the tab).
    await flagged.goto('/admin/feedback')
    await waitForPresence(agentB, true)

    await flagged.close()
    await waitForPresence(agentB, false, 15_000)
  })

  test('holdPresence keeps a teammate online from the test process until released', async ({
    people,
  }) => {
    const contributor = people.people.contributor.principalId
    await waitForPresence(contributor, false)
    const held = await holdPresence('contributor')
    await waitForPresence(contributor, true)
    held.release()
    await waitForPresence(contributor, false, 15_000)
  })
})
