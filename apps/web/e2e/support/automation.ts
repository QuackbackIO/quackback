/**
 * Helpers for the workflow (automation) specs: create workflows through the
 * app's own service, drive the widget as a visitor, and read runs.
 *
 * Every live workflow fires workspace-wide, so scope each one to the test's
 * own data (a `message.body contains <marker>` condition, or the test's own
 * tag/attribute), and delete it in `finally` (or use `withWorkflow`).
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type APIRequestContext, type FrameLocator, type Page } from '@playwright/test'
import { supportEnv } from './env'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { sendInboundEmail, supportInboxAddress } from './inbound-email'
import { pollFor, supportDb } from './db'

const here = dirname(fileURLToPath(import.meta.url))

function runScript(file: string, args: string[]): string {
  const envFile = process.env.E2E_ENV_FILE ?? '../../.env'
  try {
    return execFileSync(
      'bun',
      [`--env-file=${envFile}`, resolve(here, '../scripts', file), ...args],
      {
        encoding: 'utf-8',
        cwd: resolve(here, '../..'),
      }
    ).trim()
  } catch (error) {
    const err = error as { stderr?: string; message: string }
    throw new Error(`${file} failed: ${err.stderr || err.message}`, { cause: error })
  }
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string
  type: string
  [key: string]: unknown
}
export interface GraphEdge {
  from: string
  to: string
  branch?: string
}
export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** A TipTap doc with one paragraph, the shape block bodies take. */
export function doc(text: string): Record<string, unknown> {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

/** Trigger -> condition (body contains marker) -> the given chain. */
export function markerChain(
  marker: string,
  chain: GraphNode[],
  extraEdges: GraphEdge[] = []
): Graph {
  const nodes: GraphNode[] = [
    { id: 'trigger', type: 'trigger' },
    {
      id: 'scope',
      type: 'condition',
      condition: { field: 'message.body', op: 'contains', value: marker },
    },
    ...chain,
  ]
  const edges: GraphEdge[] = [
    { from: 'trigger', to: 'scope' },
    ...(chain.length ? [{ from: 'scope', to: chain[0].id }] : []),
  ]
  // Default: a linear chain unless the caller wires its own edges.
  if (extraEdges.length === 0) {
    for (let i = 1; i < chain.length; i++) edges.push({ from: chain[i - 1].id, to: chain[i].id })
  } else {
    edges.push(...extraEdges)
  }
  return { nodes, edges }
}

// ---------------------------------------------------------------------------
// Workflows (through e2e/scripts/create-support-workflow.ts)
// ---------------------------------------------------------------------------

export interface WorkflowSpec {
  name: string
  class: 'customer_facing' | 'background'
  triggerType: string
  triggerSettings?: Record<string, unknown>
  graph: Graph
  sortOrder?: number
  live?: boolean
}

/**
 * Create a workflow (validated like the builder's save). When nothing was
 * live before, the app may hold a cached "no live workflow" for 30 s, so wait
 * that out once (callers raise their timeout; the sentinel keeps it rare).
 */
export async function createWorkflow(spec: WorkflowSpec): Promise<string> {
  const out = JSON.parse(runScript('create-support-workflow.ts', [JSON.stringify(spec)])) as {
    id: string
    coldCache: boolean
  }
  if (out.coldCache) await new Promise((r) => setTimeout(r, 31_000))
  return out.id
}

export function setWorkflowStatus(id: string, status: 'draft' | 'live' | 'paused'): void {
  runScript('create-support-workflow.ts', ['--status', id, status])
}

export function deleteWorkflow(id: string): void {
  runScript('create-support-workflow.ts', ['--delete', id])
}

/** Create, run `body`, and always soft-delete the workflows afterwards. */
export async function withWorkflows<T>(
  specs: WorkflowSpec[],
  body: (ids: string[]) => Promise<T>
): Promise<T> {
  const ids: string[] = []
  try {
    for (const spec of specs) ids.push(await createWorkflow(spec))
    return await body(ids)
  } finally {
    for (const id of ids) {
      try {
        deleteWorkflow(id)
      } catch {
        // Best effort: a leftover workflow is still scoped to this test's marker.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface RunRow {
  id: string
  workflow_id: string
  state: string
  cursor: Record<string, unknown>
  ended_at: Date | null
  subject_principal_id: string | null
}

function uuid(typeId: string): string {
  return toUuid(typeId as `conversation_${string}`)
}

export async function runsFor(conversationId: string, workflowId?: string): Promise<RunRow[]> {
  const sql = supportDb()
  const rows = workflowId
    ? await sql`SELECT id, workflow_id, state, cursor, ended_at, subject_principal_id
                FROM workflow_runs WHERE conversation_id = ${uuid(conversationId)}
                AND workflow_id = ${uuid(workflowId)} ORDER BY started_at`
    : await sql`SELECT id, workflow_id, state, cursor, ended_at, subject_principal_id
                FROM workflow_runs WHERE conversation_id = ${uuid(conversationId)} ORDER BY started_at`
  return rows as unknown as RunRow[]
}

export async function waitForRun(
  conversationId: string,
  workflowId: string,
  state?: string | string[],
  timeoutMs = 20_000
): Promise<RunRow> {
  const states = state === undefined ? null : Array.isArray(state) ? state : [state]
  return pollFor(
    `a ${states?.join('/') ?? ''} run of ${workflowId}`,
    async () => {
      const runs = await runsFor(conversationId, workflowId)
      return runs.find((r) => !states || states.includes(r.state)) ?? null
    },
    { timeoutMs }
  )
}

export async function runEventKinds(runId: string): Promise<string[]> {
  const rows = await supportDb()`SELECT kind FROM workflow_run_events WHERE run_id = ${runId}
                                 ORDER BY at, id`
  return rows.map((r) => r.kind as string)
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/** The conversation (TypeID) holding a message whose plain text contains `text`. */
export async function conversationWithMessage(text: string, timeoutMs = 15_000): Promise<string> {
  const sql = supportDb()
  const row = await pollFor(
    `a conversation with a message containing "${text}"`,
    async () => {
      const [r] = await sql`SELECT conversation_id FROM conversation_messages
                            WHERE content LIKE ${`%${text}%`} ORDER BY created_at LIMIT 1`
      return r ?? null
    },
    { timeoutMs }
  )
  return fromUuid('conversation', row.conversation_id as string)
}

export interface MessageRow {
  id: string
  content: string
  sender_type: string
  is_internal: boolean
  metadata: Record<string, unknown> | null
  principal_id: string | null
}

export async function messagesOf(conversationId: string): Promise<MessageRow[]> {
  const rows =
    await supportDb()`SELECT id, content, sender_type, is_internal, metadata, principal_id
                                 FROM conversation_messages
                                 WHERE conversation_id = ${uuid(conversationId)}
                                 ORDER BY created_at, id`
  return rows as unknown as MessageRow[]
}

export async function conversationRow(conversationId: string): Promise<Record<string, unknown>> {
  const [row] = await supportDb()`SELECT * FROM conversations WHERE id = ${uuid(conversationId)}`
  return row as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Widget (anonymous visitor on the /widget route)
// ---------------------------------------------------------------------------

/** Open the widget as a fresh anonymous visitor and send the first message. */
export async function widgetStartConversation(page: Page, text: string): Promise<string> {
  await page.goto('/widget')
  await page.getByRole('button', { name: 'Messages', exact: true }).click()
  await page.getByRole('button', { name: /Ask a question/ }).click()
  await widgetSend(page, text)
  return conversationWithMessage(text)
}

/** Type and send a message in the open widget thread (page or widget frame). */
export async function widgetSend(page: Page | FrameLocator, text: string): Promise<void> {
  const composer = page.locator('.ProseMirror[contenteditable="true"]')
  await expect(composer).toBeVisible({ timeout: 15_000 })
  await composer.click()
  await composer.fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  // Accepted: the composer clears and the message is in the thread.
  await expect(composer).toHaveText('', { timeout: 15_000 })
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 15_000 })
}

/**
 * Open the widget on a host page as an identified customer of the test's own
 * (unique email), signed in with a minted ssoToken, and start a conversation.
 * Returns the widget frame and the conversation id.
 */
export async function identifiedWidgetConversation(
  page: Page,
  customer: { id: string; email: string; name: string },
  text: string
): Promise<{ widget: FrameLocator; conversationId: string }> {
  const ssoToken = runScript('support-widget-token.ts', [JSON.stringify(customer)])
  const hostPath = `/__e2e-host-${customer.id}`
  await page.route(`**${hostPath}`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta charset="utf-8"><title>host</title></head><body>
<script src="/api/widget/sdk.js"></script>
<script>
  Quackback('on', 'identify', function (ev) {
    document.documentElement.dataset.identified = ev && ev.success ? '1' : '0'
  })
  Quackback('init', ${JSON.stringify({ instanceUrl: supportEnv().baseUrl, identity: { ssoToken } })})
  Quackback('open')
</script></body></html>`,
    })
  )
  await page.goto(hostPath)
  await expect(page.locator('html')).toHaveAttribute('data-identified', '1', { timeout: 20_000 })
  const widget = page.frameLocator('iframe.quackback-widget-iframe')
  await widget.getByRole('button', { name: /^(?:\d+ unread )?Messages$/ }).click()
  await widget
    .getByRole('button', { name: /Ask a question/ })
    .first()
    .click()
  await widgetSend(widget, text)
  return { widget, conversationId: await conversationWithMessage(text) }
}

// ---------------------------------------------------------------------------
// Email visitors (cold inbound mail opens an email-channel conversation)
// ---------------------------------------------------------------------------

/** Send a signed cold email whose body carries `text`; returns the conversation. */
export async function emailConversation(
  request: APIRequestContext,
  from: string,
  text: string,
  subject = `Help ${text}`
): Promise<string> {
  const res = await sendInboundEmail(request, {
    from,
    to: supportInboxAddress(),
    subject,
    text,
  })
  expect(res.status(), await res.text()).toBe(200)
  return conversationWithMessage(text)
}

// ---------------------------------------------------------------------------
// Scoping by conversation attribute (for triggers that carry no message)
// ---------------------------------------------------------------------------

/** Store `value` under custom attribute `key` on the conversation (teammate envelope). */
export async function setScopeAttribute(
  conversationId: string,
  key: string,
  value: string
): Promise<void> {
  const sql = supportDb()
  const envelope = { v: value, src: 'teammate', at: new Date().toISOString() }
  await sql`UPDATE conversations
    SET custom_attributes = COALESCE(custom_attributes, '{}'::jsonb) || ${sql.json({ [key]: envelope })}
    WHERE id = ${uuid(conversationId)}`
}

/** A condition node that passes only for conversations tagged by setScopeAttribute. */
export function attrScope(key: string, value: string): GraphNode {
  return {
    id: 'scope',
    type: 'condition',
    condition: { field: `conversation.attr.${key}`, op: 'eq', value },
  }
}

/** Trigger -> attribute scope -> chain (linear unless edges are given). */
export function attrChain(
  key: string,
  value: string,
  chain: GraphNode[],
  extraEdges: GraphEdge[] = []
): Graph {
  const graph = markerChain('unused', chain, extraEdges)
  graph.nodes[1] = attrScope(key, value)
  return graph
}

/** A conversation attribute definition with a unique key; returns the key. */
export async function createAttributeDefinition(opts: {
  key: string
  label: string
  fieldType: 'text' | 'number' | 'select' | 'date'
  options?: Array<{ id: string; label: string }>
}): Promise<string> {
  const sql = supportDb()
  const id = toUuid(generateId('conv_attr'))
  await sql`INSERT INTO conversation_attribute_definitions (id, key, label, field_type, options)
    VALUES (${id}, ${opts.key}, ${opts.label}, ${opts.fieldType},
            ${opts.options ? sql.json(opts.options) : null})`
  return opts.key
}

/** Read a conversation attribute envelope ({ v, src, at }) or undefined. */
export async function attributeOf(
  conversationId: string,
  key: string
): Promise<{ v: unknown; src: string } | undefined> {
  const row = await conversationRow(conversationId)
  const attrs = (row.custom_attributes ?? {}) as Record<string, { v: unknown; src: string }>
  return attrs[key]
}

// ---------------------------------------------------------------------------
// Inbox (teammate actions through the real UI)
// ---------------------------------------------------------------------------

/** Open a thread in the inbox (at the suite's 1600 px viewport the triage
 *  controls sit in the thread header; there is no detail panel). */
export async function openInboxThread(page: Page, conversationId: string): Promise<void> {
  await page.goto(`/admin/inbox?i=${conversationId}`)
  await expect(
    page
      .getByRole('button', { name: 'Close', exact: true })
      .or(page.getByRole('button', { name: 'Reopen', exact: true }))
      .first()
  ).toBeVisible({ timeout: 20_000 })
}

/** Close the thread with the header's Close button, as a teammate. */
export async function closeInInbox(page: Page, conversationId: string): Promise<void> {
  await openInboxThread(page, conversationId)
  const id = uuid(conversationId)
  await expect(async () => {
    await page.getByRole('button', { name: 'Close', exact: true }).first().click({ timeout: 2_000 })
    await expect
      .poll(
        async () =>
          (await supportDb()`SELECT status FROM conversations WHERE id = ${id}`)[0].status,
        {
          timeout: 3_000,
        }
      )
      .toBe('closed')
  }).toPass({ timeout: 25_000 })
}

/** Send a public reply from the thread's composer. */
export async function replyInInbox(
  page: Page,
  conversationId: string,
  text: string
): Promise<void> {
  await openInboxThread(page, conversationId)
  const composer = page.locator('.ProseMirror[contenteditable="true"]').last()
  await expect(composer).toBeVisible({ timeout: 15_000 })
  await composer.click()
  await composer.fill(text)
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 10_000 })
}

// ---------------------------------------------------------------------------
// Isolated tests (their own job and database: support-isolated in ci.yml)
// ---------------------------------------------------------------------------

/** True in the support-isolated job, where workspace-wide switches may be flipped. */
export const ISOLATED = process.env.E2E_SUPPORT_ISOLATED === '1'

/** Why an isolated test is skipped in the shared shards. */
export const ISOLATED_SKIP =
  'needs its own database: turns on a workspace-wide switch (runs in the support-isolated job)'

/**
 * Turn the AI agent's widget answers on (messenger.assistant.respond). Only
 * ever called in the isolated job: it makes the AI answer every widget message.
 */
export async function enableAssistantRespond(): Promise<void> {
  if (!ISOLATED) throw new Error('enableAssistantRespond outside the isolated job')
  await supportDb()`UPDATE settings SET widget_config = (
      COALESCE(NULLIF(widget_config, '')::jsonb, '{}'::jsonb)
      || jsonb_build_object('messenger',
           COALESCE(NULLIF(widget_config, '')::jsonb -> 'messenger', '{}'::jsonb)
           || jsonb_build_object('assistant',
                COALESCE(NULLIF(widget_config, '')::jsonb -> 'messenger' -> 'assistant', '{}'::jsonb)
                || '{"respond": true}'::jsonb))
    )::text`
  await supportDb()`DELETE FROM kv_store WHERE key LIKE '%settings%'`
}

/** The workflow-wait job rows of a run (uuid as stored on workflow_runs). */
export async function waitJobsOf(runUuid: string): Promise<
  Array<{
    dedupe_key: string
    status: string
    run_at: Date
    payload: { runId: string; waitSeq: number }
  }>
> {
  const runId = fromUuid('workflow_run', runUuid)
  const rows = await supportDb()`SELECT dedupe_key, status, run_at, payload FROM job_queue
    WHERE queue = 'workflow-wait' AND payload ->> 'runId' = ${runId} ORDER BY created_at`
  return rows as never
}

/** Make every pending workflow-wait job of this run due now. */
export async function fireWaitJobsNow(runUuid: string): Promise<number> {
  const runId = fromUuid('workflow_run', runUuid)
  const rows = await supportDb()`UPDATE job_queue SET run_at = now()
    WHERE queue = 'workflow-wait' AND status = 'pending' AND payload ->> 'runId' = ${runId}
    RETURNING job_id`
  return rows.length
}
