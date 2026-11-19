/**
 * More ticket helpers for the support suite (the TKT remainder): workflow
 * graphs scoped to a test's marker, linked-ticket reads and run reads.
 *
 * Every live workflow fires workspace-wide, so each graph here starts with a
 * `message.body contains <marker>` condition and the test deletes it in
 * `finally`.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { fromUuid, toUuid } from '@quackback/ids'
import { pollFor, supportDb } from './db'

export interface WorkflowNode {
  id: string
  type: string
  [key: string]: unknown
}

/** trigger -> (message.body contains marker) -> the actions, in order. */
export function markerGraph(marker: string, actions: WorkflowNode[]) {
  const nodes: WorkflowNode[] = [
    { id: 'trigger', type: 'trigger' },
    {
      id: 'scope',
      type: 'condition',
      condition: { field: 'message.body', op: 'contains', value: marker },
    },
    ...actions,
  ]
  const chain = ['trigger', 'scope', ...actions.map((a) => a.id)]
  const edges = chain.slice(1).map((to, i) => ({ from: chain[i], to }))
  return { nodes, edges }
}

/** The customer ticket linked to a conversation (TypeIDs), or null. */
export async function linkedCustomerTicket(conversationId: string) {
  const [row] = await supportDb()<
    {
      id: string
      number: number
      title: string
      requester_principal_id: string | null
      type: string
      ticket_type_id: string | null
    }[]
  >`
    SELECT t.id, t.number, t.title, t.requester_principal_id, t.type, t.ticket_type_id
    FROM ticket_conversations tc JOIN tickets t ON t.id = tc.ticket_id
    WHERE tc.conversation_id = ${toUuid(conversationId as `conversation_${string}`)}
      AND tc.ticket_type = 'customer' AND t.deleted_at IS NULL`
  return row ? { ...row, ticketId: fromUuid('ticket', row.id) } : null
}

/** Count of customer tickets linked to a conversation. */
export async function customerTicketCount(conversationId: string): Promise<number> {
  const [row] = await supportDb()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ticket_conversations
    WHERE conversation_id = ${toUuid(conversationId as `conversation_${string}`)}
      AND ticket_type = 'customer'`
  return row.n
}

/** The conversation row's visitor principal (uuid) and subject. */
export async function conversationVisitor(conversationId: string) {
  const [row] = await supportDb()<{ visitor_principal_id: string; subject: string | null }[]>`
    SELECT visitor_principal_id, subject FROM conversations
    WHERE id = ${toUuid(conversationId as `conversation_${string}`)}`
  return row
}

/** Runs of a workflow on a conversation, oldest first, with their event kinds. */
export async function workflowRuns(conversationId: string, workflowId: string) {
  const runs = await supportDb()<{ id: string; state: string }[]>`
    SELECT id, state FROM workflow_runs
    WHERE conversation_id = ${toUuid(conversationId as `conversation_${string}`)}
      AND workflow_id = ${toUuid(workflowId as `workflow_${string}`)}
    ORDER BY started_at`
  const out: { id: string; state: string; events: string[] }[] = []
  for (const run of runs) {
    const events = await supportDb()<{ kind: string }[]>`
      SELECT kind FROM workflow_run_events WHERE run_id = ${run.id} ORDER BY at, id`
    out.push({ ...run, events: events.map((e) => e.kind) })
  }
  return out
}

/** Wait until `count` runs of the workflow on the conversation have ended. */
export function waitForEndedRuns(
  conversationId: string,
  workflowId: string,
  count: number,
  timeoutMs = 30_000
) {
  return pollFor(
    `${count} ended run(s) of ${workflowId}`,
    async () => {
      const runs = await workflowRuns(conversationId, workflowId)
      const ended = runs.filter((r) => r.state !== 'running' && r.state !== 'waiting')
      return ended.length >= count ? ended : null
    },
    { timeoutMs }
  )
}

/** Every inbox list row (conversation or ticket) whose text contains `text`. */
export function listRows(page: Page, text: string): Locator {
  return page.locator('div.group:not(nav div.group)').filter({ hasText: text })
}

export function bulkBar(page: Page): Locator {
  return page.getByRole('toolbar', { name: 'Bulk actions' })
}

/**
 * Select the rows whose text contains each of `texts`: open the row and press
 * `x`. A live list update can reset the selection mid-way, so start over until
 * the whole set sticks.
 */
export async function selectRows(page: Page, texts: string[]): Promise<void> {
  await expect(async () => {
    const clear = bulkBar(page).getByRole('button', { name: 'Clear selection' })
    if (await clear.isVisible()) await clear.click()
    for (const [i, text] of texts.entries()) {
      await listRows(page, text).getByRole('button').first().click()
      await expect(page.getByText(text).last()).toBeVisible({ timeout: 3_000 })
      await page.getByRole('heading', { level: 2 }).first().click()
      await page.keyboard.press('x')
      await expect(bulkBar(page).getByText(`${i + 1} selected`)).toBeVisible({ timeout: 3_000 })
    }
  }).toPass({ timeout: 40_000 })
}
