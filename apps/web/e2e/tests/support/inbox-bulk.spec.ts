/**
 * Support inbox bulk actions (journeys INB-71..INB-76).
 *
 * Selection is keyboard-first: open a row, press `x` to add it to the
 * selection. Every test lists only its own rows (`?q=<marker>`) and selects
 * only those, so a bulk action can never touch another test's conversation.
 */
import type { Page } from '@playwright/test'
import {
  test,
  expect,
  conversationState,
  inboxUrl,
  listRows,
  messagesOf,
  seedMacro,
  seedTag,
  type SeededConversation,
} from '../../support/inbox'
import { supportDb } from '../../support/db'

test.use({ viewport: { width: 1920, height: 1080 } })

function bulkBar(page: Page) {
  return page.getByRole('toolbar', { name: 'Bulk actions' })
}

/** Open each row and press `x`: the bulk bar counts the selection. */
async function selectRows(page: Page, rows: SeededConversation[]) {
  // A live list update right after an earlier bulk action can reset the
  // selection mid-way; start over until the whole set sticks.
  await expect(async () => {
    const clear = bulkBar(page).getByRole('button', { name: 'Clear selection' })
    if (await clear.isVisible()) await clear.click()
    for (const [i, c] of rows.entries()) {
      const row = listRows(page, c.visitorName)
      await row.getByRole('button').first().click()
      await expect(page).toHaveURL(new RegExp(`i=${c.id}`), { timeout: 3_000 })
      await page.getByRole('heading', { level: 2 }).first().click()
      await page.keyboard.press('x')
      await expect(bulkBar(page).getByText(`${i + 1} selected`)).toBeVisible({ timeout: 3_000 })
    }
  }).toPass({ timeout: 30_000 })
}

test.describe('inbox bulk actions', () => {
  test(
    'INB-71 selecting rows shows the bulk bar with the right count; clearing hides it',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const rows = [
        await seed({ visitorName: `Bulk one ${marker}` }),
        await seed({ visitorName: `Bulk two ${marker}` }),
        await seed({ visitorName: `Bulk three ${marker}` }),
      ]
      await page.goto(inboxUrl({ q: marker }))
      await expect(listRows(page, marker)).toHaveCount(3, { timeout: 15_000 })
      await expect(bulkBar(page)).toHaveCount(0)

      await selectRows(page, rows)
      await expect(bulkBar(page).getByText('3 selected')).toBeVisible()
      // `x` on a selected row takes it out again.
      await page.keyboard.press('x')
      await expect(bulkBar(page).getByText('2 selected')).toBeVisible()
      await bulkBar(page).getByRole('button', { name: 'Clear selection' }).click()
      await expect(bulkBar(page)).toHaveCount(0)
    }
  )

  test(
    'INB-72 bulk tag, assign and close apply to each selected row with a success toast',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page, mate } = await teammate()
      const tag = await seedTag(`Bulk label ${marker}`)
      const rows = [
        await seed({ visitorName: `Bulk one ${marker}` }),
        await seed({ visitorName: `Bulk two ${marker}` }),
        await seed({ visitorName: `Bulk three ${marker}` }),
      ]
      const untouched = await seed({ visitorName: `Left alone ${marker}` })
      await page.goto(inboxUrl({ q: marker }))
      await expect(listRows(page, marker)).toHaveCount(4, { timeout: 15_000 })
      await selectRows(page, rows)

      const bar = bulkBar(page)
      await bar.getByRole('button', { name: 'Tag' }).click()
      await page.getByRole('menuitem', { name: tag.name }).click()
      await expect(page.getByText('Tagged 3 items')).toBeVisible({ timeout: 15_000 })

      // Each bulk action clears the selection; select again for the next.
      await expect(bar).toHaveCount(0)
      await selectRows(page, rows)
      await bar.getByRole('button', { name: 'Assign' }).click()
      await page.getByRole('menuitem', { name: 'Assign to me' }).click()
      await expect(page.getByText('Assigned 3 items')).toBeVisible({ timeout: 15_000 })

      await expect(bar).toHaveCount(0)
      await selectRows(page, rows)
      await bar.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(page.getByText('Closed 3 items')).toBeVisible({ timeout: 15_000 })

      const sql = supportDb()
      for (const c of rows) {
        const state = await conversationState(c.uuid)
        expect(state.status).toBe('closed')
        expect(state.assigned_agent_principal_id).toBe(mate.principalUuid)
        const [tagged] = await sql`SELECT 1 FROM conversation_tag_assignments
        WHERE conversation_id = ${c.uuid} AND conversation_tag_id = ${tag.uuid}`
        expect(tagged).toBeTruthy()
      }
      const other = await conversationState(untouched.uuid)
      expect(other.status).toBe('open')
      expect(other.assigned_agent_principal_id).toBeNull()
      await expect(listRows(page, marker)).toHaveCount(1)
      await expect(listRows(page, untouched.visitorName)).toHaveCount(1)
    }
  )

  test(
    'INB-73 a bulk action where a row fails reports the partial success',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const rows = [
        await seed({ visitorName: `Bulk one ${marker}` }),
        await seed({ visitorName: `Bulk two ${marker}` }),
      ]
      await page.goto(inboxUrl({ q: marker }))
      await expect(listRows(page, marker)).toHaveCount(2, { timeout: 15_000 })
      await selectRows(page, rows)
      // One selected conversation disappears before the action runs.
      await supportDb()`DELETE FROM conversations WHERE id = ${rows[1].uuid}`
      await bulkBar(page).getByRole('button', { name: 'Close', exact: true }).click()
      await expect(page.getByText('1 updated, 1 failed')).toBeVisible({ timeout: 15_000 })
      expect((await conversationState(rows[0].uuid)).status).toBe('closed')
    }
  )

  test(
    'INB-76 a bulk macro reply sends the macro text to each selected conversation',
    {
      tag: '@nightly',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const macro = await seedMacro(`Bulk macro ${marker}`, `Thanks for writing in ${marker}`)
      const rows = [
        await seed({ visitorName: `Macro one ${marker}` }),
        await seed({ visitorName: `Macro two ${marker}` }),
      ]
      const untouched = await seed({ visitorName: `Macro none ${marker}` })
      await page.goto(inboxUrl({ q: marker }))
      await expect(listRows(page, marker)).toHaveCount(3, { timeout: 15_000 })
      await selectRows(page, rows)
      await bulkBar(page).getByRole('button', { name: 'Macro' }).click()
      await page.getByRole('menuitem', { name: macro.name }).click()
      for (const c of rows) {
        await expect
          .poll(async () =>
            (await messagesOf(c.uuid)).some(
              (m) =>
                m.sender_type === 'agent' && m.content.includes(`Thanks for writing in ${marker}`)
            )
          )
          .toBe(true)
      }
      expect((await messagesOf(untouched.uuid)).some((m) => m.sender_type === 'agent')).toBe(false)
    }
  )
})
