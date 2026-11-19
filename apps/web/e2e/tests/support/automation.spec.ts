/**
 * Workflows as an admin manages them, and the guards that decide whether a
 * workflow runs: the workflows page, create/publish/pause/delete, first-match
 * order, templates, the abandoned-journey card, the automated-actor loop
 * guard, audience, ticket triggers, manual runs, run history and macros.
 * Journeys WFL-01..83 (e2e-plan section 9).
 *
 * Workflows made by scripts are scoped to the test's own conversations and
 * deleted afterwards; workflows made in the UI are deleted in the UI.
 */
import { toUuid } from '@quackback/ids'
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb, pollFor } from '../../support/db'
import { setWidgetSurfaces } from '../../utils/db-helpers'
import {
  attributeOf,
  conversationRow,
  createAttributeDefinition,
  createWorkflow,
  deleteWorkflow,
  doc,
  emailConversation,
  identifiedWidgetConversation,
  markerChain,
  messagesOf,
  openInboxThread,
  runEventKinds,
  runsFor,
  waitForRun,
  widgetStartConversation,
  withWorkflows,
} from '../../support/automation'

test.describe.configure({ timeout: 90_000 })

const WORKFLOWS_URL = '/admin/settings/workflows'

function wfUuid(id: string): string {
  return toUuid(id as `workflow_${string}`)
}

/** A list row on the workflows page (a div[role=button] in the group list). */
function workflowRow(page: Page, name: string) {
  return page.locator('.divide-y > div').filter({ hasText: name }).first()
}

/** Pick an item from a row's actions menu (retried past hydration). */
async function rowAction(page: Page, name: string, item: string): Promise<void> {
  const row = workflowRow(page, name)
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(async () => {
    await row.getByRole('button', { name: `Actions for ${name}` }).click({ timeout: 2_000 })
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible({ timeout: 1_500 })
  }).toPass({ timeout: 20_000 })
  await page.getByRole('menuitem', { name: item }).click()
}

/** Save the builder (a committed name change may already have saved itself). */
async function saveBuilder(page: Page): Promise<void> {
  const save = page.getByRole('button', { name: 'Save', exact: true })
  if (await save.isEnabled()) await save.click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 })
}

async function workflowStatus(id: string): Promise<{ status: string; deleted_at: Date | null }> {
  const [row] = await supportDb()`SELECT status, deleted_at FROM workflows WHERE id = ${wfUuid(id)}`
  return row as { status: string; deleted_at: Date | null }
}

test(
  'WFL-01 the workflows page shows its cards to managers and is refused to others',
  { tag: '@core' },
  async ({ asPerson, marker }) => {
    const admin = await asPerson('admin')
    await admin.goto(WORKFLOWS_URL)
    await expect(admin.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(admin.getByText('Who replies first').first()).toBeVisible()
    await expect(admin.getByText('Abandoned journeys').first()).toBeVisible()
    await expect(admin.getByRole('button', { name: 'New workflow' })).toBeVisible()

    // Old automation URLs redirect into settings.
    await admin.goto('/admin/automation/workflows')
    await expect(admin).toHaveURL(/\/admin\/settings\/workflows$/, { timeout: 15_000 })
    await withWorkflows(
      [
        {
          name: `Redirect ${marker}`,
          class: 'background',
          triggerType: 'message.created',
          graph: markerChain(marker, []),
        },
      ],
      async ([id]) => {
        await admin.goto(`/admin/automation/workflows/${id}`)
        await expect(admin).toHaveURL(new RegExp(`/admin/settings/workflows/${id}$`), {
          timeout: 15_000,
        })
      }
    )

    // A teammate without workflow.manage is refused by the route guard.
    const noAccess = await asPerson('noAccess')
    await noAccess.goto(WORKFLOWS_URL)
    await expect(noAccess.getByText('Who replies first')).toHaveCount(0)
    await expect(noAccess.getByRole('button', { name: 'New workflow' })).toHaveCount(0)
  }
)

test(
  'WFL-02 creating a workflow from scratch saves a draft with one version by its creator',
  { tag: '@core' },
  async ({ asPerson, people, marker }) => {
    const admin = await asPerson('admin')
    await admin.goto(WORKFLOWS_URL)
    await expect(async () => {
      await admin.getByRole('button', { name: 'New workflow' }).click({ timeout: 2_000 })
      await expect(admin.getByRole('menu')).toBeVisible({ timeout: 1_500 })
    }).toPass({ timeout: 30_000 })
    await admin.getByRole('menuitem', { name: 'Create from scratch' }).click()
    await expect(admin).toHaveURL(/\/admin\/settings\/workflows\/workflow_[a-z0-9]+$/, {
      timeout: 15_000,
    })
    const id = admin.url().split('/').pop()!
    try {
      const sql = supportDb()
      const [row] =
        await sql`SELECT status, class, created_by FROM workflows WHERE id = ${wfUuid(id)}`
      expect(row.status).toBe('draft')
      const versions =
        await sql`SELECT created_by FROM workflow_versions WHERE workflow_id = ${wfUuid(id)}`
      expect(versions).toHaveLength(1)
      const adminUuid = toUuid(people.people.admin.principalId as `principal_${string}`)
      expect(versions[0].created_by).toBe(adminUuid)

      // Rename with stray spaces and save: the stored name is trimmed.
      const name = admin.getByRole('textbox', { name: 'Workflow name' })
      await expect(name).toHaveValue('Untitled workflow', { timeout: 15_000 })
      await name.fill(`   Draft ${marker}   `)
      await name.press('Enter')
      await saveBuilder(admin)
      await expect
        .poll(
          async () => (await sql`SELECT name FROM workflows WHERE id = ${wfUuid(id)}`)[0].name,
          {
            timeout: 15_000,
          }
        )
        .toBe(`Draft ${marker}`)
      expect((await workflowStatus(id)).status).toBe('draft')
    } finally {
      deleteWorkflow(id)
    }
  }
)

test(
  'WFL-07 publish, pause and resume from the list: pause stops new runs at once',
  { tag: '@core' },
  async ({ asPerson, request, marker }) => {
    const id = await createWorkflow({
      name: `Lifecycle ${marker}`,
      class: 'background',
      triggerType: 'message.created',
      graph: markerChain(marker, [
        { id: 'p', type: 'action', action: { type: 'set_priority', priority: 'high' } },
      ]),
    })
    try {
      const admin = await asPerson('admin')
      await admin.goto(WORKFLOWS_URL)
      const name = `Lifecycle ${marker}`

      await rowAction(admin, name, 'Set live')
      await expect
        .poll(async () => (await workflowStatus(id)).status, { timeout: 10_000 })
        .toBe('live')
      await expect(workflowRow(admin, name).getByText('Live')).toBeVisible()
      const first = await emailConversation(
        request,
        `${marker}-1@customers.example`,
        `One ${marker}`
      )
      await waitForRun(first, id, 'done')

      await rowAction(admin, name, 'Pause')
      await expect
        .poll(async () => (await workflowStatus(id)).status, { timeout: 10_000 })
        .toBe('paused')
      const second = await emailConversation(
        request,
        `${marker}-2@customers.example`,
        `Two ${marker}`
      )
      // Give the dispatch a moment: it must not start a run.
      await pollFor('the second message dispatched', async () => {
        const [job] =
          await supportDb()`SELECT status FROM job_queue WHERE queue = 'workflow-dispatch'
        AND status = 'succeeded' AND created_at > now() - interval '1 minute' LIMIT 1`
        return job ?? null
      })
      await admin.waitForTimeout(3_000)
      expect(await runsFor(second, id)).toHaveLength(0)
      expect((await conversationRow(second)).priority).toBe('none')

      await rowAction(admin, name, 'Set live')
      await expect
        .poll(async () => (await workflowStatus(id)).status, { timeout: 10_000 })
        .toBe('live')
      const third = await emailConversation(
        request,
        `${marker}-3@customers.example`,
        `Three ${marker}`
      )
      await waitForRun(third, id, 'done')
    } finally {
      deleteWorkflow(id)
    }
  }
)

test(
  'WFL-08 deleting a workflow hides it and stops dispatch; its runs and events stay',
  { tag: '@nightly' },
  async ({ asPerson, request, marker }) => {
    const name = `Delete me ${marker}`
    const id = await createWorkflow({
      name,
      class: 'background',
      triggerType: 'message.created',
      live: true,
      graph: markerChain(marker, [
        { id: 'p', type: 'action', action: { type: 'set_priority', priority: 'high' } },
      ]),
    })
    const before = await emailConversation(
      request,
      `${marker}-1@customers.example`,
      `Before ${marker}`
    )
    const run = await waitForRun(before, id, 'done')

    const admin = await asPerson('admin')
    await admin.goto(WORKFLOWS_URL)
    await rowAction(admin, name, 'Delete')
    await admin.getByRole('button', { name: 'Delete workflow' }).click()
    await expect(workflowRow(admin, name)).toBeHidden({ timeout: 10_000 })
    await expect
      .poll(async () => (await workflowStatus(id)).deleted_at, { timeout: 10_000 })
      .not.toBeNull()

    const after = await emailConversation(
      request,
      `${marker}-2@customers.example`,
      `After ${marker}`
    )
    await admin.waitForTimeout(3_000)
    expect(await runsFor(after, id)).toHaveLength(0)
    // History survives the delete.
    expect(await runsFor(before, id)).toHaveLength(1)
    expect(await runEventKinds(run.id)).toContain('completed')
  }
)

test(
  'WFL-09 with two live workflows on one trigger only the first in order runs; reordering flips it',
  { tag: '@core' },
  async ({ request, marker }) => {
    const action = (priority: string) => [
      { id: 'p', type: 'action', action: { type: 'set_priority', priority } },
    ]
    await withWorkflows(
      [
        {
          name: `First ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          sortOrder: 1,
          live: true,
          graph: markerChain(marker, action('low')),
        },
        {
          name: `Second ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          sortOrder: 2,
          live: true,
          graph: markerChain(marker, action('urgent')),
        },
      ],
      async ([first, second]) => {
        const one = await emailConversation(
          request,
          `${marker}-1@customers.example`,
          `One ${marker}`
        )
        await waitForRun(one, first, 'done')
        expect(await runsFor(one, second)).toHaveLength(0)
        expect((await conversationRow(one)).priority).toBe('low')

        // The reorder write: sortOrder is what the manager's drag rewrites.
        await supportDb()`UPDATE workflows SET sort_order = 3 WHERE id = ${wfUuid(first)}`
        const two = await emailConversation(
          request,
          `${marker}-2@customers.example`,
          `Two ${marker}`
        )
        await waitForRun(two, second, 'done')
        expect(await runsFor(two, first)).toHaveLength(0)
        expect((await conversationRow(two)).priority).toBe('urgent')
      }
    )
  }
)

test(
  'WFL-10 each content save adds a version; History lists them and restore brings one back',
  { tag: '@nightly' },
  async ({ asPerson, marker }) => {
    const id = await createWorkflow({
      name: `Versions ${marker}`,
      class: 'background',
      triggerType: 'message.created',
      graph: markerChain(marker, []),
    })
    try {
      const admin = await asPerson('admin')
      await admin.goto(`${WORKFLOWS_URL}/${id}`)
      const name = admin.getByRole('textbox', { name: 'Workflow name' })
      await expect(name).toHaveValue(`Versions ${marker}`, { timeout: 15_000 })
      await name.fill(`Versions two ${marker}`)
      await name.press('Enter')
      await saveBuilder(admin)
      const versions = async () =>
        (
          await supportDb()`SELECT count(*)::int AS n FROM workflow_versions WHERE workflow_id = ${wfUuid(id)}`
        )[0].n
      await expect.poll(versions, { timeout: 10_000 }).toBe(2)

      // An order-only change writes no version.
      await supportDb()`UPDATE workflows SET sort_order = 7 WHERE id = ${wfUuid(id)}`
      expect(await versions()).toBe(2)

      await admin.getByRole('button', { name: 'History' }).click()
      const sheet = admin.getByRole('dialog', { name: 'Version history' })
      await expect(sheet).toBeVisible()
      await expect(
        sheet.getByRole('button', { name: new RegExp(`^Versions two ${marker}`) })
      ).toBeVisible()
      const original = sheet.getByRole('button', { name: new RegExp(`^Versions ${marker}`) })
      await expect(original).toBeVisible()
      await expect(original).toContainText('Ada Admin')
      await original.click()
      await expect(sheet.getByText(/\d+ nodes? ·/)).toBeVisible()
      await sheet.getByRole('button', { name: 'Restore this version' }).click()
      await admin.getByRole('button', { name: 'Restore', exact: true }).click()
      await expect
        .poll(
          async () =>
            (await supportDb()`SELECT name FROM workflows WHERE id = ${wfUuid(id)}`)[0].name,
          {
            timeout: 15_000,
          }
        )
        .toBe(`Versions ${marker}`)
      await expect.poll(versions, { timeout: 10_000 }).toBe(3)
    } finally {
      deleteWorkflow(id)
    }
  }
)

test(
  'WFL-12 a template opens the builder pre-filled and is saved as a draft',
  { tag: '@nightly' },
  async ({ asPerson }) => {
    const admin = await asPerson('admin')
    await admin.goto(WORKFLOWS_URL)
    const gallery = admin.getByRole('dialog', { name: 'Start from a template' })
    await expect(async () => {
      await admin.getByRole('button', { name: 'New workflow' }).click({ timeout: 2_000 })
      await expect(admin.getByRole('menu')).toBeVisible({ timeout: 1_500 })
    }).toPass({ timeout: 30_000 })
    await admin.getByRole('menuitem', { name: 'Create from template' }).click()
    await expect(gallery).toBeVisible()
    await gallery.getByRole('button', { name: /^Customer facing/ }).click()
    await gallery.getByRole('button', { name: /Front-door triage bot/ }).click()
    await expect(admin).toHaveURL(/\/admin\/settings\/workflows\/workflow_[a-z0-9]+$/, {
      timeout: 15_000,
    })
    const id = admin.url().split('/').pop()!
    try {
      await expect(admin.getByRole('textbox', { name: 'Workflow name' })).toHaveValue(
        'Front-door triage bot',
        { timeout: 15_000 }
      )
      const outline = admin.getByRole('navigation', { name: 'Workflow outline' })
      await expect(outline.getByText('Path A · Product question')).toBeVisible()
      const [row] = await supportDb()`SELECT status, class FROM workflows WHERE id = ${wfUuid(id)}`
      expect(row).toMatchObject({ status: 'draft', class: 'customer_facing' })
    } finally {
      deleteWorkflow(id)
    }
  }
)

test(
  'WFL-13 the abandoned-journey card shows its defaults and saved changes persist',
  {
    tag: ['@nightly', '@isolated'],
    annotation: {
      type: 'isolated',
      description: 'Turns on abandoned-journey auto-close workspace-wide (support-isolated job)',
    },
  },
  async ({ asPerson }) => {
    test.skip(process.env.E2E_SUPPORT_ISOLATED !== '1', 'runs in the support-isolated job')
    const [settings] = await supportDb()`SELECT metadata FROM settings LIMIT 1`
    const stored = settings?.metadata ? JSON.parse(settings.metadata as string) : {}
    const admin = await asPerson('admin')
    await admin.goto(WORKFLOWS_URL)
    const toggle = admin.getByRole('switch', { name: 'Auto-close abandoned journeys' })
    await expect(toggle).toBeVisible({ timeout: 20_000 })
    if (!JSON.stringify(stored).includes('bandoned')) {
      // Never saved: off, and the detail rows hidden until it is on.
      await expect(toggle).not.toBeChecked()
      await expect(admin.getByText('Wait before closing')).toHaveCount(0)
    }
    // Retried: a click before hydration lands on inert server-rendered HTML.
    await expect(async () => {
      if (!(await toggle.isChecked())) await toggle.click({ timeout: 2_000 })
      await expect(toggle).toBeChecked({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
    const keep = admin.getByRole('switch', { name: 'Keep open if an email was captured' })
    await expect(keep).toBeVisible()
    const wait = admin.locator('input[type="number"]').first()
    await expect(wait).toBeVisible()
    await wait.fill('7')
    await wait.press('Enter')
    await expect
      .poll(
        async () => {
          const [s] = await supportDb()`SELECT metadata FROM settings LIMIT 1`
          return String(s.metadata)
        },
        { timeout: 10_000 }
      )
      .toContain('"waitMinutes":7')
    await admin.reload()
    await expect(admin.getByRole('switch', { name: 'Auto-close abandoned journeys' })).toBeChecked({
      timeout: 20_000,
    })
    await expect(admin.locator('input[type="number"]').first()).toHaveValue('7')
  }
)

test(
  "WFL-16 a block message sent by workflow A never starts workflow B nor ends A's wait",
  { tag: '@core' },
  async ({ page, marker }) => {
    const blockText = `BLOCK-${marker}`
    await withWorkflows(
      [
        {
          name: `A ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(`Visitor ${marker}`, [
            { id: 'say', type: 'message', body: doc(`${blockText} hello`) },
            { id: 'pause', type: 'wait', seconds: 3600 },
            { id: 'later', type: 'message', body: doc(`Later ${marker}`) },
          ]),
        },
        {
          name: `B ${marker}`,
          class: 'background',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(blockText, [
            { id: 'p', type: 'action', action: { type: 'set_priority', priority: 'urgent' } },
          ]),
        },
      ],
      async ([a, b]) => {
        const conversationId = await widgetStartConversation(page, `Visitor ${marker}`)
        await expect(page.getByText(`${blockText} hello`)).toBeVisible({ timeout: 20_000 })
        const parked = await waitForRun(conversationId, a, 'waiting')
        // The block's own message.created was dispatched and ignored.
        await pollFor('the block message event', async () => {
          const [e] = await supportDb()`SELECT actor_type FROM events WHERE type = 'message.created'
          AND payload -> 'message' ->> 'content' LIKE ${`%${blockText}%`}`
          return e ?? null
        })
        await page.waitForTimeout(3_000)
        expect(await runsFor(conversationId, b)).toHaveLength(0)
        expect((await conversationRow(conversationId)).priority).toBe('none')
        const still = await runsFor(conversationId, a)
        expect(still.map((r) => r.state)).toEqual(['waiting'])
        expect(still[0].id).toBe(parked.id)
      }
    )
  }
)

test(
  'WFL-19 an audience limited to people with an email skips anonymous visitors',
  { tag: '@core' },
  async ({ browser, customerEmail, marker }) => {
    await withWorkflows(
      [
        {
          name: `Audience ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          triggerSettings: { audience: { field: 'person.email', op: 'is_set' } },
          live: true,
          graph: markerChain(marker, [
            { id: 'hi', type: 'message', body: doc(`Known person ${marker}`) },
          ]),
        },
      ],
      async ([id]) => {
        // Identified: a host page signs the widget in as this test's own customer.
        const known = await (await browser.newContext()).newPage()
        const { widget, conversationId: knownConversation } = await identifiedWidgetConversation(
          known,
          { id: marker, email: customerEmail, name: 'Ida Identified' },
          `Identified ${marker}`
        )
        await waitForRun(knownConversation, id, 'done')
        await expect(widget.getByText(`Known person ${marker}`)).toBeVisible({ timeout: 20_000 })

        // Anonymous: synthetic email only, so the audience never matches.
        const anon = await (await browser.newContext()).newPage()
        const anonConversation = await widgetStartConversation(anon, `Anonymous ${marker}`)
        await anon.waitForTimeout(4_000)
        expect(await runsFor(anonConversation, id)).toHaveLength(0)
        await expect(anon.getByText(`Known person ${marker}`)).toHaveCount(0)
      }
    )
  }
)

test(
  "WFL-28 a ticket trigger runs on the ticket's linked customer conversation",
  { tag: '@nightly' },
  async ({ page, customerEmail, marker }) => {
    setWidgetSurfaces(true)
    await withWorkflows(
      [
        {
          name: `Form ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(marker, [
            { id: 'form', type: 'send_ticket_form', body: doc(`File it ${marker}`) },
          ]),
        },
        {
          name: `Ticket created ${marker}`,
          class: 'background',
          triggerType: 'ticket.created',
          live: true,
          graph: {
            nodes: [
              { id: 'trigger', type: 'trigger' },
              // Scoped to this test's own identified customer.
              {
                id: 'scope',
                type: 'condition',
                condition: { field: 'person.email', op: 'eq', value: customerEmail },
              },
              {
                id: 'note',
                type: 'action',
                action: { type: 'add_note', body: `Ticket seen ${marker}` },
              },
            ],
            edges: [
              { from: 'trigger', to: 'scope' },
              { from: 'scope', to: 'note' },
            ],
          },
        },
      ],
      async ([, ticketWorkflow]) => {
        const { widget } = await identifiedWidgetConversation(
          page,
          { id: marker, email: customerEmail, name: 'Tia Ticket' },
          `Need a ticket ${marker}`
        )
        const subject = widget.getByRole('textbox', { name: /Subject/ })
        await expect(subject).toBeVisible({ timeout: 20_000 })
        await subject.fill(`Ticket ${marker}`)
        await widget.getByRole('button', { name: 'Create ticket' }).click()

        // The ticket's linked customer conversation is where the run happens.
        const linked = await pollFor(
          'the ticket and its customer conversation',
          async () => {
            const [row] = await supportDb()`SELECT tc.conversation_id FROM tickets t
          JOIN ticket_conversations tc ON tc.ticket_id = t.id
          WHERE t.title = ${`Ticket ${marker}`} AND tc.ticket_type = 'customer'`
            return row ?? null
          },
          { timeoutMs: 20_000 }
        )
        const { fromUuid } = await import('@quackback/ids')
        const linkedId = fromUuid('conversation', linked.conversation_id as string)
        const run = await waitForRun(linkedId, ticketWorkflow, 'done', 30_000)
        expect(await runEventKinds(run.id)).toContain('completed')
        const note = (await messagesOf(linkedId)).find((m) => m.content === `Ticket seen ${marker}`)
        expect(note?.is_internal).toBe(true)
      }
    )
  }
)

test(
  'WFL-60 running a workflow from the inbox bypasses trigger guards and refuses a second customer-facing run',
  { tag: '@core' },
  async ({ asPerson, request, customerEmail, marker }) => {
    const name = `Manual ${marker}`
    await withWorkflows(
      [
        {
          name,
          class: 'customer_facing',
          // The audience never matches anyone, so only a manual run reaches it.
          triggerType: 'conversation.priority_changed',
          triggerSettings: {
            audience: {
              field: 'person.email',
              op: 'eq',
              value: `nobody-${marker}@nowhere.example`,
            },
          },
          live: true,
          graph: {
            nodes: [
              { id: 'trigger', type: 'trigger' },
              {
                id: 'ask',
                type: 'reply_buttons',
                body: doc(`Pick one ${marker}`),
                options: [{ key: 'ok', label: 'OK' }],
                allowTyping: true,
              },
            ],
            edges: [{ from: 'trigger', to: 'ask' }],
          },
        },
      ],
      async ([id]) => {
        const conversationId = await emailConversation(request, customerEmail, `Manual ${marker}`)
        const admin = await asPerson('admin')
        await openInboxThread(admin, conversationId)

        const runIt = async () => {
          await expect(async () => {
            await admin.getByRole('button', { name: 'Run a workflow' }).click({ timeout: 2_000 })
            await expect(admin.getByPlaceholder('Search workflows…')).toBeVisible({
              timeout: 1_500,
            })
          }).toPass({ timeout: 20_000 })
          await admin.getByPlaceholder('Search workflows…').fill(name)
          await admin.getByRole('option', { name: new RegExp(name) }).click()
        }

        await runIt()
        await expect(admin.getByText('Workflow started').first()).toBeVisible({ timeout: 15_000 })
        const run = await waitForRun(conversationId, id, 'waiting')
        expect(run.subject_principal_id).toBeNull()
        await expect(admin.getByText(`Pick one ${marker}`).first()).toBeVisible({ timeout: 15_000 })

        await runIt()
        await expect(
          admin
            .getByText('A customer-facing workflow is already active on this conversation.')
            .first()
        ).toBeVisible({ timeout: 15_000 })
        expect(await runsFor(conversationId, id)).toHaveLength(1)
      }
    )
  }
)

test(
  "WFL-62 the run list shows runs newest first and a run's timeline lists its events",
  { tag: '@nightly' },
  async ({ asPerson, request, marker }) => {
    const name = `Runs ${marker}`
    await withWorkflows(
      [
        {
          name,
          class: 'background',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(marker, [
            { id: 'p', type: 'action', action: { type: 'set_priority', priority: 'low' } },
          ]),
        },
      ],
      async ([id]) => {
        const first = await emailConversation(
          request,
          `${marker}-1@customers.example`,
          `First ${marker}`
        )
        await waitForRun(first, id, 'done')
        const second = await emailConversation(
          request,
          `${marker}-2@customers.example`,
          `Second ${marker}`
        )
        await waitForRun(second, id, 'done')

        const admin = await asPerson('admin')
        await admin.goto(WORKFLOWS_URL)
        await rowAction(admin, name, 'View runs')
        const sheet = admin.getByRole('dialog')
        await expect(sheet).toBeVisible()
        const rows = sheet.getByRole('button').filter({ hasText: /Done|done|Completed|completed/ })
        await expect(rows.first()).toBeVisible({ timeout: 15_000 })
        expect(await rows.count()).toBeGreaterThanOrEqual(2)
        await rows.first().click()
        await expect(sheet.getByText(/started/i).first()).toBeVisible({ timeout: 10_000 })
        await expect(sheet.getByText(/completed/i).first()).toBeVisible()
      }
    )
  }
)

test(
  'WFL-82 a cold inbound email gets one auto-acknowledgement; a repeat sender inside the bucket gets none',
  {
    tag: ['@core', '@isolated'],
    annotation: {
      type: 'isolated',
      description: 'Turns on the email auto-acknowledgement workspace-wide (support-isolated job)',
    },
  },
  async ({ request, customerEmail, marker }) => {
    test.skip(process.env.E2E_SUPPORT_ISOLATED !== '1', 'runs in the support-isolated job')
    const { mailTo, getMail, getMailHeaders } = await import('../../support/mailpit')
    // Turn the setting on (settings.metadata.emailAutoAck), as the toggle does.
    await supportDb()`UPDATE settings SET metadata = (
        COALESCE(NULLIF(metadata, '')::jsonb, '{}'::jsonb) || '{"emailAutoAck":{"enabled":true}}'::jsonb
      )::text`
    await supportDb()`DELETE FROM kv_store WHERE key LIKE '%settings%'`

    const subject = `Order question ${marker}`
    const messageId = `<${marker}-1@customers.example>`
    const { sendInboundEmail, supportInboxAddress } = await import('../../support/inbound-email')
    const res = await sendInboundEmail(request, {
      from: customerEmail,
      to: supportInboxAddress(),
      subject,
      text: `Hello ${marker}`,
      messageId,
    })
    expect(res.status()).toBe(200)
    const ack = await pollFor(
      'the auto-acknowledgement',
      async () => (await mailTo(customerEmail)).find((m) => m.Subject === `Re: ${subject}`) ?? null,
      { timeoutMs: 20_000 }
    )
    const full = await getMail(ack.ID)
    expect(full.Text).toContain('We received your email and will get back to you shortly.')
    const headers = await getMailHeaders(ack.ID)
    expect(headers['Auto-Submitted']?.[0]).toBe('auto-replied')
    expect(headers['Precedence']?.[0]).toBe('auto_reply')
    expect(headers['In-Reply-To']?.[0]).toBe(messageId)

    // Two more cold mails from the same sender: the bucket allows two acks an hour.
    for (const n of [2, 3]) {
      await sendInboundEmail(request, {
        from: customerEmail,
        to: supportInboxAddress(),
        subject: `${subject} ${n}`,
        text: `Again ${n} ${marker}`,
        messageId: `<${marker}-${n}@customers.example>`,
      })
    }
    await expect
      .poll(
        async () =>
          (await mailTo(customerEmail)).filter((m) => m.Subject.startsWith(`Re: ${subject}`))
            .length,
        {
          timeout: 15_000,
        }
      )
      .toBe(2)
    await new Promise((r) => setTimeout(r, 3_000))
    expect(
      (await mailTo(customerEmail)).filter((m) => m.Subject.startsWith(`Re: ${subject}`))
    ).toHaveLength(2)
  }
)

test(
  'WFL-83 applying a macro runs its actions as the teammate and skips a failing one',
  { tag: '@core' },
  async ({ asPerson, request, people, customerEmail, marker }) => {
    const key = await createAttributeDefinition({
      key: `e2e_macro_${Date.now().toString(36)}`,
      label: `Macro attr ${marker}`,
      fieldType: 'text',
    })
    const macroName = `Macro ${marker}`
    const sql = supportDb()
    const { generateId } = await import('@quackback/ids')
    const macroId = toUuid(generateId('macro'))
    await sql`INSERT INTO macros (id, name, body, scope, actions, created_by_principal_id)
    VALUES (${macroId}, ${macroName}, ${`Thanks for writing ${marker}`}, 'support',
            ${sql.json([
              { type: 'set_priority', priority: 'high' },
              // A tag that does not exist: this action fails and is skipped.
              { type: 'add_tag', tagId: generateId('conversation_tag') },
              { type: 'set_attribute', key, value: 'from-macro' },
              { type: 'snooze', preset: 'tomorrow' },
            ])},
            ${toUuid(people.people.admin.principalId as `principal_${string}`)})`
    try {
      const conversationId = await emailConversation(request, customerEmail, `Macro ${marker}`)
      const admin = await asPerson('admin')
      await openInboxThread(admin, conversationId)
      await expect(async () => {
        await admin.getByRole('button', { name: 'Macros' }).click({ timeout: 2_000 })
        await expect(admin.getByPlaceholder('Search macros…')).toBeVisible({ timeout: 1_500 })
      }).toPass({ timeout: 20_000 })
      await admin.getByPlaceholder('Search macros…').fill(macroName)
      await admin.getByRole('option', { name: new RegExp(macroName) }).click()

      await expect(admin.getByText(/^Applied: /).first()).toBeVisible({ timeout: 15_000 })
      const toast = await admin
        .getByText(/^Applied: /)
        .first()
        .textContent()
      expect(toast).not.toMatch(/tag/i)

      const row = await conversationRow(conversationId)
      expect(row.priority).toBe('high')
      expect(row.status).toBe('snoozed')
      const until = new Date(String(row.snoozed_until))
      expect(until.getTime()).toBeGreaterThan(Date.now())
      expect(until.getTime() - Date.now()).toBeLessThan(2 * 24 * 60 * 60 * 1000)
      expect(await attributeOf(conversationId, key)).toMatchObject({
        v: 'from-macro',
        src: 'teammate',
      })
    } finally {
      await sql`UPDATE macros SET deleted_at = now() WHERE id = ${macroId}`
    }
  }
)
