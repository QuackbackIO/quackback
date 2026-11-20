/**
 * NTF-07 reads "who is online", so it runs in the support-serial project
 * (one test at a time, nothing else running) from no presence rows.
 */
import { test, expect } from '../../support/fixtures'
import { waitForBells, waitForEventHandled } from '../../support/bells'
import { waitForPresence } from '../../support/presence'
import { openStream } from '../../support/streams'
import { createVisitor } from '../../support/visitors'
import { clearPresence } from '../../support/workspace-settings'

test.describe('notifications held by presence', () => {
  test.beforeEach(async () => {
    await clearPresence()
  })

  test(
    'NTF-07 a follow-up visitor message is held only while a teammate is online and not Away',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const watcher = await newTeammate({ roleKey: 'support_lead' })
      const awayOne = await newTeammate({ roleKey: 'support_lead', availability: 'away' })
      const available = await newTeammate({ roleKey: 'support_lead' })
      const visitor = await createVisitor(playwright)
      const { conversationId } = await visitor.send(`first ${marker}`)
      await waitForBells(watcher.principalId, conversationId, (r) => r.length === 1)

      // Only an Away teammate has a tab open: not held.
      const awayTab = await openStream({ cookie: awayOne.cookie, query: { scope: 'inbox' } })
      await waitForPresence(awayOne.principalId, true)
      await visitor.send(`while away ${marker}`, conversationId)
      await waitForBells(watcher.principalId, conversationId, (r) =>
        r.some((b) => b.body?.startsWith(`while away ${marker}`))
      )

      // An available teammate online: held.
      const tab = await openStream({ cookie: available.cookie, query: { scope: 'presence' } })
      await waitForPresence(available.principalId, true)
      const held = await visitor.send(`held ${marker}`, conversationId)
      await waitForEventHandled(held.messageId, { type: 'message.created' })
      tab.close()
      await waitForPresence(available.principalId, false, 15_000)

      // Offline again: the next one bells, the held one never did.
      await visitor.send(`after ${marker}`, conversationId)
      const rows = await waitForBells(watcher.principalId, conversationId, (r) =>
        r.some((b) => b.body?.startsWith(`after ${marker}`))
      )
      expect(rows.some((b) => b.body?.startsWith(`held ${marker}`))).toBe(false)
      expect(rows).toHaveLength(3)
      awayTab.close()
    }
  )
})
