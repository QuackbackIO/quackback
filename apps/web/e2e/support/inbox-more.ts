/**
 * Helpers for the second batch of inbox journeys (attributes, participants,
 * SLA removal, shared posts, mixed bulk). Preconditions only: the action under
 * test always goes through the product.
 */
import { generateId, toUuid } from '@quackback/ids'
import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { pollFor, supportDb } from './db'
import { getMail, mailTo } from './mailpit'
import { detailsPanel } from './inbox'

/** A select attribute definition of this test's own (key and labels carry `tag`). */
export async function seedSelectAttribute(tag: string) {
  const id = generateId('conv_attr')
  const key = `e2e_${tag.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`.slice(0, 60)
  const label = `Plan ${tag}`
  const options = [
    { id: 'opt_basic', label: `Basic ${tag}` },
    { id: 'opt_pro', label: `Pro ${tag}` },
  ]
  await supportDb()`INSERT INTO conversation_attribute_definitions (id, key, label, field_type, options)
    VALUES (${toUuid(id)}, ${key}, ${label}, 'select', ${supportDb().json(options)})`
  return { id, key, label, options }
}

/** Archive a definition so it stops showing in every other test's panel. */
export async function archiveAttribute(id: string): Promise<void> {
  await supportDb()`UPDATE conversation_attribute_definitions SET archived_at = NOW()
                    WHERE id = ${toUuid(id as `conv_attr_${string}`)}`
}

/** The details panel's editor row for an attribute label. */
export function attributeRow(page: Page, label: string): Locator {
  return detailsPanel(page)
    .locator('div.flex.justify-between')
    .filter({ has: page.getByText(label, { exact: true }) })
}

/**
 * An SLA stamp on one conversation: a policy row of this test's own (policies
 * only apply through a workflow, so the row changes nothing elsewhere) and the
 * applied stamp written straight onto the conversation.
 */
export async function seedSlaOnConversation(conversationUuid: string, policyName: string) {
  const sql = supportDb()
  const policyId = generateId('sla_policy')
  await sql`INSERT INTO sla_policies (id, name, first_response_target_secs)
            VALUES (${toUuid(policyId)}, ${policyName}, 86400)`
  const now = new Date()
  const due = new Date(now.getTime() + 30 * 86_400_000)
  const stamp = {
    policyId,
    policyName,
    appliedAt: now.toISOString(),
    firstResponseDueAt: due.toISOString(),
    nextResponseDueAt: null,
    timeToCloseDueAt: null,
    pauseOnSnooze: true,
  }
  await sql`UPDATE conversations SET sla_applied = ${sql.json(stamp)} WHERE id = ${conversationUuid}`
  return { policyId, policyName }
}

/** The SLA chip in the open thread's header (its title names the policy). */
export function slaChip(page: Page, policyName: string): Locator {
  return page.locator(`span[title^="${policyName} ·"]`)
}

/** Every mail to `to` whose text body contains `text`. */
export async function mailsContaining(to: string, text: string) {
  const out = []
  for (const summary of await mailTo(to)) {
    const mail = await getMail(summary.ID)
    if (`${mail.Text}\n${mail.HTML}`.includes(text)) out.push(mail)
  }
  return out
}

/** Wait for a mail to `to` whose body contains `text`. */
export async function waitForMailContaining(to: string, text: string, timeoutMs = 30_000) {
  return pollFor(
    `mail to ${to} containing "${text}"`,
    async () => (await mailsContaining(to, text))[0] ?? null,
    { timeoutMs, intervalMs: 500 }
  )
}

/** Open the thread's overflow menu and pick an item. */
export async function threadMenu(page: Page, item: string | RegExp): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: 'More conversation actions' }).click()
    await page.getByRole('menuitem', { name: item }).click({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}
