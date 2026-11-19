/**
 * Inbox and ticket journeys that need a workspace-wide setting (the support
 * product off, a required-to-close attribute, customer stage labels, a default
 * SLA policy) plus the inbox translation journeys. Every test here is tagged
 * `@isolated`: it skips itself in the shared shards and runs in the
 * support-isolated job, one worker on a database of its own. Each test sets
 * the baseline it depends on and puts back everything it changed in
 * `finally`, so no test depends on another's settings.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/inbox'
import { pollFor, supportDb } from '../../support/db'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { fakeAi } from '../../support/fake-ai-client'
import {
  SUPPORT_FLAGS_ON,
  WIDGET_BASELINE,
  isolatedSettingsBaseline,
  snapshotSettings,
  restoreSettings,
  withSettings,
} from '../../support/isolated-settings'
import {
  composer,
  conversationState,
  detailsPanel,
  openConversation,
  sendFromComposer,
  threadMessages,
} from '../../support/inbox'
import { mintVisitor, visitorSend, widgetFn } from '../../support/widget-portal'
import {
  createCustomer,
  createTicket,
  openRequesterThread,
  pairedConversationId,
  pairedCustomerTicket,
  setStatus,
  signedInAs,
  ticketApi,
} from '../../support/tickets'

test.use({ viewport: { width: 1920, height: 1080 } })

const baseline = isolatedSettingsBaseline()

test.beforeEach(async () => {
  test.skip(!ISOLATED, ISOLATED_SKIP)
  // Generous: a flipped setting must never outlive its test on a timeout.
  test.setTimeout(120_000)
  await baseline.apply()
})

test.afterEach(async () => {
  await baseline.restore()
})

// ---------------------------------------------------------------------------
// The support product switched off
// ---------------------------------------------------------------------------

test.describe('the support product switched off', { tag: '@isolated' }, () => {
  test(
    'INB-02 with support off the inbox redirects to the first product; tickets only keeps the shell without chat availability',
    { tag: '@nightly' },
    async ({ asPerson }) => {
      const admin = await asPerson('admin')
      const accountMenu = admin
        .locator('aside[data-admin-rail]')
        .getByRole('button', { name: /Ada Admin/ })
      const availabilityItem = admin.getByRole('menuitem', { name: /Set yourself as/ })

      await withSettings(
        { feature_flags: { supportInbox: false, supportTickets: false } },
        async () => {
          await admin.goto('/admin/inbox')
          await expect(admin).toHaveURL(/\/admin\/feedback/, { timeout: 20_000 })
        }
      )

      await withSettings(
        { feature_flags: { supportInbox: false, supportTickets: true } },
        async () => {
          await admin.goto('/admin/inbox')
          await expect(admin.getByText('All tickets').first()).toBeVisible({ timeout: 20_000 })
          await expect(admin).toHaveURL(/\/admin\/inbox/)
          await expect(async () => {
            await accountMenu.click()
            await expect(admin.getByRole('menuitem', { name: 'Settings' })).toBeVisible({
              timeout: 2_000,
            })
          }).toPass({ timeout: 15_000 })
          await expect(availabilityItem).toHaveCount(0)
          await admin.keyboard.press('Escape')
        }
      )

      // With the inbox on, the same menu offers chat availability.
      await withSettings({ feature_flags: SUPPORT_FLAGS_ON }, async () => {
        await admin.goto('/admin/inbox')
        await expect(admin.getByText('All tickets').first()).toBeVisible({ timeout: 20_000 })
        await expect(async () => {
          await accountMenu.click()
          await expect(availabilityItem).toBeVisible({ timeout: 2_000 })
        }).toPass({ timeout: 15_000 })
        await admin.keyboard.press('Escape')
      })
    }
  )

  test(
    'INB-02 a tickets-only inbox hides the conversation affordances',
    { tag: '@nightly' },
    async ({ asPerson }) => {
      const admin = await asPerson('admin')
      await withSettings(
        { feature_flags: { supportInbox: false, supportTickets: true } },
        async () => {
          await admin.goto('/admin/inbox')
          await expect(admin.getByText('All tickets').first()).toBeVisible({ timeout: 20_000 })
          await expect(admin.getByRole('button', { name: 'New conversation' })).toHaveCount(0)
          await expect(admin.getByText('All conversations')).toHaveCount(0)
        }
      )
    }
  )
})

// ---------------------------------------------------------------------------
// Inbox translation
// ---------------------------------------------------------------------------

/**
 * A real widget visitor's conversation whose language the app has detected
 * as French (detection is lazy and model-driven; the detected language is a
 * precondition here, the translation is what is under test).
 */
async function frenchConversation(
  request: import('@playwright/test').APIRequestContext,
  opening: string
) {
  const visitor = await mintVisitor()
  const { conversation } = await visitorSend(request, visitor.token, opening)
  await supportDb()`UPDATE conversations SET detected_customer_language = 'fr'
    WHERE id = ${toUuid(conversation.id as `conversation_${string}`)}`
  return { visitor, conversationId: conversation.id }
}

const TRANSLATION_BASELINE = { feature_flags: SUPPORT_FLAGS_ON, widget_config: WIDGET_BASELINE }

test.describe('inbox translation', { tag: '@isolated' }, () => {
  test(
    "INB-36 a reply is sent in the customer's language; the visitor sees only the translation, the team the original on request",
    { tag: '@nightly' },
    async ({ asPerson, request, marker }) => {
      await withSettings(TRANSLATION_BASELINE, async () => {
        const opening = `${marker} Bonjour, mon export ne marche pas`
        const { visitor, conversationId } = await frenchConversation(request, opening)
        const original = `${marker} Thanks, we are looking into your export now`
        const translated = `${marker} Merci, nous regardons votre export`
        await fakeAi.script({ marker: original, json: { content: translated } })
        try {
          const admin = await asPerson('admin')
          await openConversation(admin, conversationId, opening)
          const toggle = admin.getByRole('button', {
            name: 'Turn on translation for this conversation',
          })
          await toggle.click()
          await expect(
            admin.getByRole('button', { name: 'Translation is on for this conversation' })
          ).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })

          await sendFromComposer(admin, original, 'reply')
          await expect(threadMessages(admin, translated)).toBeVisible({ timeout: 20_000 })
          const marked = admin.getByRole('button', { name: 'Translated to French · Show original' })
          await expect(marked).toBeVisible()
          await marked.click()
          await expect(threadMessages(admin, original)).toBeVisible()

          // Stored and sent as the translation; the original rides in metadata.
          const [row] = await supportDb()`SELECT content, metadata FROM conversation_messages
            WHERE conversation_id = ${toUuid(conversationId as `conversation_${string}`)}
              AND sender_type = 'agent' AND content LIKE ${`${marker}%`}`
          expect(row.content).toBe(translated)
          expect(row.metadata.translatedFrom).toMatchObject({
            originalContent: original,
            targetLocale: 'fr',
          })

          // The visitor's thread carries the translation and never the original.
          const thread = await widgetFn<{ messages: Array<Record<string, unknown>> }>(
            request,
            'widgetGetMyConversationFn',
            { bearer: visitor.token, data: { conversationId } }
          )
          const wire = JSON.stringify(thread.value)
          expect(wire).toContain(translated)
          expect(wire).not.toContain(original)
        } finally {
          await fakeAi.clear(original)
        }
      })
    }
  )

  test(
    'INB-37 a failed translation blocks the send and "Send untranslated" sends the original',
    { tag: '@nightly' },
    async ({ asPerson, request, marker }) => {
      await withSettings(TRANSLATION_BASELINE, async () => {
        const opening = `${marker} Bonjour, une question`
        const { conversationId } = await frenchConversation(request, opening)
        const uuid = toUuid(conversationId as `conversation_${string}`)
        await supportDb()`UPDATE conversations SET translation_enabled = true WHERE id = ${uuid}`
        const agentMessages = async () =>
          (
            await supportDb()`SELECT content, metadata FROM conversation_messages
              WHERE conversation_id = ${uuid} AND sender_type = 'agent'
                AND content LIKE ${`%${marker}%`}`
          ).map((r) => r as { content: string; metadata: Record<string, unknown> | null })

        const admin = await asPerson('admin')
        await openConversation(admin, conversationId, opening)
        // The model fails: the send is blocked and nothing is stored.
        const reply = `${marker} We will call you tomorrow`
        await fakeAi.script({ marker: reply, status: 500, error: 'translation model down' })
        await sendFromComposer(admin, reply, 'reply')
        await expect(admin.getByText('Could not translate your reply.')).toBeVisible({
          timeout: 30_000,
        })
        // The model was asked (and failed) for this very reply.
        const asked = await fakeAi.requests({ contains: reply, endpoint: 'chat' })
        expect(asked.length).toBeGreaterThan(0)
        expect(asked.every((r) => r.matched === reply && r.status === 500)).toBe(true)
        expect(await agentMessages()).toEqual([])

        await admin.getByRole('button', { name: 'Send untranslated' }).click()
        const sent = await pollFor('the untranslated reply', async () => {
          const rows = await agentMessages()
          return rows.length ? rows : null
        })
        expect(sent).toHaveLength(1)
        expect(sent[0].content).toBe(reply)
        expect(sent[0].metadata?.translatedFrom ?? null).toBeNull()
        await expect(threadMessages(admin, `${marker} We will call you tomorrow`)).toBeVisible()
      })
    }
  )

  test(
    'INB-38 the suggestion translates incoming messages when accepted, and stays gone once dismissed',
    { tag: '@nightly' },
    async ({ asPerson, request, marker }) => {
      await withSettings(TRANSLATION_BASELINE, async () => {
        const incoming = `${marker} Ma facture est fausse`
        const english = `${marker} My invoice is wrong`
        await fakeAi.script({ marker: incoming, json: { content: english } })
        try {
          const accept = await frenchConversation(request, incoming)
          const admin = await asPerson('admin')
          await openConversation(admin, accept.conversationId, incoming)
          const banner = admin.getByText(
            'This customer writes in French. Translate this conversation?'
          )
          await expect(banner).toBeVisible({ timeout: 15_000 })
          await admin.getByRole('button', { name: 'Translate', exact: true }).click()
          await expect(threadMessages(admin, english)).toBeVisible({ timeout: 20_000 })
          await expect(
            admin.getByRole('button', { name: 'Translated from French · Show original' })
          ).toBeVisible()
          await expect(banner).toHaveCount(0)
          // Display only: the stored message is untouched.
          const [stored] = await supportDb()`SELECT content FROM conversation_messages
            WHERE conversation_id = ${toUuid(accept.conversationId as `conversation_${string}`)}
              AND sender_type = 'visitor'`
          expect(stored.content).toBe(incoming)

          const dismissOpening = `${marker} Bonjour encore`
          const dismiss = await frenchConversation(request, dismissOpening)
          await openConversation(admin, dismiss.conversationId, dismissOpening)
          await expect(banner).toBeVisible({ timeout: 15_000 })
          await admin
            .locator('div', { has: banner })
            .getByRole('button', { name: 'Dismiss' })
            .last()
            .click()
          await expect(banner).toHaveCount(0)
          await pollFor('the dismissal', async () => {
            const [row] = await supportDb()`SELECT translation_dismissed_at FROM conversations
              WHERE id = ${toUuid(dismiss.conversationId as `conversation_${string}`)}`
            return row.translation_dismissed_at ? row : null
          })
          await openConversation(admin, dismiss.conversationId, dismissOpening)
          await expect(composer(admin)).toBeVisible()
          await expect(banner).toHaveCount(0)
        } finally {
          await fakeAi.clear(incoming)
        }
      })
    }
  )
})

// ---------------------------------------------------------------------------
// Required-to-close attributes
// ---------------------------------------------------------------------------

test.describe('required-to-close attributes', { tag: '@isolated' }, () => {
  test(
    'INB-58 a close is blocked naming the required attribute until it is set, then succeeds',
    { tag: '@core' },
    async ({ asPerson, seed, marker }) => {
      const key = `reason_${randomBytes(4).toString('hex')}`
      const label = `Close reason ${marker.slice(-8)}`
      const id = toUuid(generateId('conv_attr'))
      await supportDb()`INSERT INTO conversation_attribute_definitions
          (id, key, label, field_type, required_to_close)
        VALUES (${id}, ${key}, ${label}, 'text', true)`
      try {
        const conversation = await seed()
        const admin = await asPerson('admin')
        await openConversation(admin, conversation.id, conversation.messages[0])

        const close = admin.getByRole('button', { name: 'Close', exact: true }).first()
        await close.click()
        const dialog = admin.getByRole('alertdialog')
        await expect(dialog.getByText('Required attributes missing')).toBeVisible({
          timeout: 15_000,
        })
        await expect(dialog).toContainText(label)
        expect((await conversationState(conversation.uuid)).status).toBe('open')
        await dialog.getByRole('button', { name: 'OK' }).click()

        // Fill it in the details panel's Attributes section, then close.
        const panel = detailsPanel(admin)
        // The value input sits beside the attribute's label (it has no name of its own).
        const field = panel
          .getByText(label, { exact: true })
          .locator('xpath=ancestor::div[.//input][1]//input')
        await field.fill('Answered by phone')
        await field.press('Enter')
        await pollFor('the attribute to be saved', async () => {
          const [row] = await supportDb()`SELECT custom_attributes FROM conversations
            WHERE id = ${conversation.uuid}`
          return row.custom_attributes?.[key] ? row : null
        })
        await close.click()
        await pollFor('the close', async () => {
          const state = await conversationState(conversation.uuid)
          return state.status === 'closed' ? state : null
        })
        await expect(dialog).toHaveCount(0)
      } finally {
        await supportDb()`DELETE FROM conversation_attribute_definitions WHERE id = ${id}`
      }
    }
  )
})

// ---------------------------------------------------------------------------
// Ticket settings: stage labels and the default SLA
// ---------------------------------------------------------------------------

test.describe('ticket settings', { tag: '@isolated' }, () => {
  test(
    'TKT-22 renaming a customer stage changes what the requester sees on their ticket',
    { tag: '@nightly' },
    async ({ asPerson, playwright, baseURL, browser, marker, customerEmail }) => {
      const snapshot = await snapshotSettings(['metadata'])
      const label = `Being fixed ${randomBytes(2).toString('hex')}`
      try {
        const admin = await asPerson('admin')
        await admin.goto('/admin/settings/ticket-statuses')
        const input = admin.getByLabel('A teammate is working on it')
        await expect(input).toBeVisible({ timeout: 20_000 })
        await expect(input).toHaveValue('In progress')
        await input.fill(label)
        await input.blur()
        await pollFor('the saved label', async () => {
          const [row] = await supportDb()`SELECT metadata FROM settings LIMIT 1`
          const meta = JSON.parse((row.metadata as string | null) ?? '{}')
          return meta.ticketStageLabels?.in_progress === label ? meta : null
        })

        const api = await ticketApi(playwright, baseURL)
        const { customer, ticket, conversationId } = await pairedCustomerTicket(
          api,
          customerEmail,
          `Stage labels ${marker}`
        )
        const page = await signedInAs(browser, customer.userId)
        await openRequesterThread(page, conversationId)
        const progress = page.getByRole('list', { name: 'Ticket progress' })
        await expect(progress).toContainText(label, { timeout: 15_000 })
        await expect(progress).not.toContainText('In progress')

        await setStatus(api, ticket.id, 'Investigating')
        await expect(page.getByText(`Status updated to ${label}`)).toBeVisible({ timeout: 15_000 })
        await expect(progress.locator('li[aria-current="step"]')).toHaveText(label)
        await api.dispose()
      } finally {
        await restoreSettings(snapshot)
      }
    }
  )

  test(
    'TKT-03 a customer ticket for a requester takes the default SLA: the conversation and the ticket carry it',
    { tag: '@smoke' },
    async ({ playwright, baseURL, marker, customerEmail }) => {
      const policyUuid = randomUUID()
      const policyName = `Default ${marker.slice(-10)}`
      await supportDb()`INSERT INTO sla_policies
          (id, name, first_response_target_secs, time_to_resolve_target_secs)
        VALUES (${policyUuid}, ${policyName}, 3600, 86400)`
      const policyId = fromUuid('sla_policy', policyUuid)
      try {
        await withSettings({ metadata: { 'defaultSlaPolicy.policyId': policyId } }, async () => {
          const api = await ticketApi(playwright, baseURL)
          const customer = await createCustomer(api, customerEmail)
          const ticket = await createTicket(api, {
            title: `SLA ticket ${marker}`,
            requesterPrincipalId: customer.principalId,
            description: `Opening ${marker}`,
          })
          const conversationId = await pairedConversationId(ticket.id)
          expect(conversationId).not.toBeNull()
          const [conversation] = await supportDb()`SELECT sla_applied FROM conversations
            WHERE id = ${toUuid(conversationId as `conversation_${string}`)}`
          expect(conversation.sla_applied).toMatchObject({ policyId, policyName })
          expect(conversation.sla_applied.firstResponseDueAt).toEqual(expect.any(String))
          expect(conversation.sla_applied.firstResponseAt ?? null).toBeNull()

          const [row] = await supportDb()`SELECT sla_applied FROM tickets
            WHERE id = ${toUuid(ticket.id as `ticket_${string}`)}`
          expect(row.sla_applied).toMatchObject({ policyName })
          expect(row.sla_applied.timeToResolveDueAt).toEqual(expect.any(String))

          // The REST create answers with the SLA the ticket took.
          expect(ticket.sla).toMatchObject({
            policyName,
            timeToResolveDueAt: row.sla_applied.timeToResolveDueAt,
            resolvedAt: null,
            paused: false,
          })
          await api.dispose()
        })
      } finally {
        await supportDb()`UPDATE sla_policies SET deleted_at = NOW() WHERE id = ${policyUuid}`
      }
    }
  )
})
