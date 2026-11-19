/**
 * SLA policies (settings), the default policy, the inbox SLA chip and sort,
 * and removing an SLA from a conversation.
 *
 * Policies a test makes carry its marker in the name. The default policy is
 * shared by every test in the database: SLA-05 only ever switches it to a
 * policy of the same shape (DEFAULT_SLA_TARGETS) and back.
 */
import { fromUuid } from '@quackback/ids'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import {
  apiAs,
  callFn,
  clickUntil,
  createSlaPolicy,
  createWorkflow,
  DEFAULT_SLA_TARGETS,
  ensureDefaultSla,
  fnOk,
  isoMinutesFromNow,
  setStampFields,
  slaEventsFor,
  slaStampOf,
  startEmailConversation,
  takeDownWorkflow,
  uuidOf,
  waitForSlaEvent,
  waitForStamp,
  type SlaPolicyDTO,
} from '../../support/sla-csat'

async function policyRow(id: string) {
  const [row] = await supportDb()<
    {
      name: string
      first_response_target_secs: number | null
      time_to_resolve_target_secs: number | null
      pause_on_snooze: boolean
      pause_on_pending: boolean
      deleted_at: Date | null
    }[]
  >`SELECT name, first_response_target_secs, time_to_resolve_target_secs, pause_on_snooze,
           pause_on_pending, deleted_at
    FROM sla_policies WHERE id = ${uuidOf(id)}`
  return row
}

async function policyByName(name: string) {
  return pollFor(`the policy ${name}`, async () => {
    const [row] = await supportDb()<{ id: string }[]>`
      SELECT id FROM sla_policies WHERE name = ${name} LIMIT 1`
    return row ? { id: fromUuid('sla_policy', row.id) } : null
  })
}

/** Two email conversations, the first created due in 10 minutes, the second in 50. */
async function twoDueConversations(
  admin: APIRequestContext,
  request: APIRequestContext,
  marker: string
) {
  await ensureDefaultSla(admin)
  const sooner = await startEmailConversation(request, `${marker}-a`, { text: `Sooner ${marker}` })
  const later = await startEmailConversation(request, `${marker}-b`, { text: `Later ${marker}` })
  for (const c of [later, sooner]) await waitForStamp(c.uuid, 'stamp', () => true)
  await setStampFields('conversations', later.uuid, { firstResponseDueAt: isoMinutesFromNow(50) })
  await setStampFields('conversations', sooner.uuid, { firstResponseDueAt: isoMinutesFromNow(10) })
  return { sooner, later }
}

async function listedIds(admin: APIRequestContext, params: Record<string, unknown>) {
  const listed = await fnOk<{ items?: { id: string }[]; conversations?: { id: string }[] }>(
    admin,
    'listConversationsFn',
    params,
    { method: 'GET' }
  )
  return (listed.items ?? listed.conversations ?? []).map((c) => c.id)
}

test.describe('SLA policies', () => {
  test(
    'SLA-01 an admin creates a policy with targets; a teammate without sla.manage gets no create control',
    { tag: '@core' },
    async ({ asPerson, marker }) => {
      const page = await asPerson('admin')
      await page.goto('/admin/settings/sla')
      const dialog = page.getByRole('dialog')
      await clickUntil(page.getByRole('button', { name: 'New policy' }), dialog)
      const name = `Gold ${marker}`
      await dialog.getByLabel('Name').fill(name)
      await dialog.locator('#sla-firstResponseTargetSecs').fill('2')
      await dialog.locator('#sla-timeToResolveTargetSecs').fill('3')
      await dialog.getByRole('button', { name: 'Create policy' }).click()
      await expect(page.getByText('Policy created')).toBeVisible()

      // The row, with the default pause toggles shown as badges.
      const row = page.locator('[data-slot="settings-list-row"]').filter({ hasText: name })
      await expect(row).toBeVisible()
      await expect(row).toContainText('Pauses on snooze')
      await expect(row).toContainText('Pauses while pending')
      const { id } = await policyByName(name)
      expect(await policyRow(id)).toMatchObject({
        first_response_target_secs: 2 * 3600,
        time_to_resolve_target_secs: 3 * 3600,
        pause_on_snooze: true,
        pause_on_pending: true,
      })

      // A teammate without sla.manage sees no create control.
      const contributor = await asPerson('contributor')
      await contributor.goto('/admin/settings/sla')
      await expect(contributor.locator('body')).toBeVisible()
      await contributor.waitForLoadState('networkidle')
      await expect(contributor.getByRole('button', { name: 'New policy' })).toHaveCount(0)
      await expect(contributor.getByText(name)).toHaveCount(0)
    }
  )

  test(
    'SLA-02 creating a policy without sla.manage, with no targets, no name or a bad schedule is refused',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const admin = await apiAs(playwright, 'admin')
      const noTargets = await callFn(admin, 'createSlaPolicyFn', { name: `Empty ${marker}` })
      expect(noTargets.ok).toBe(false)
      expect(noTargets.error).toContain('Set at least one target')
      const noName = await callFn(admin, 'createSlaPolicyFn', {
        name: '   ',
        firstResponseTargetSecs: 3600,
      })
      expect(noName.ok).toBe(false)
      const badSchedule = await callFn(admin, 'createSlaPolicyFn', {
        name: `Bad schedule ${marker}`,
        firstResponseTargetSecs: 3600,
        officeHoursScheduleId: 'not-a-schedule',
      })
      expect(badSchedule.ok).toBe(false)
      expect(badSchedule.code).toBe('INVALID_OFFICE_HOURS_ID')

      const contributor = await apiAs(playwright, 'contributor')
      const denied = await callFn(contributor, 'createSlaPolicyFn', {
        name: `Denied ${marker}`,
        firstResponseTargetSecs: 3600,
      })
      expect(denied.ok).toBe(false)
      const [count] = await supportDb()<{ n: number }[]>`
        SELECT count(*)::int AS n FROM sla_policies WHERE name LIKE ${`%${marker}%`}`
      expect(count.n).toBe(0)
      await admin.dispose()
      await contributor.dispose()
    }
  )

  test(
    'SLA-03 editing a policy can change a target but never remove one',
    { tag: '@nightly' },
    async ({ playwright, asPerson, marker }) => {
      const admin = await apiAs(playwright, 'admin')
      const name = `Editable ${marker}`
      const policy = await createSlaPolicy(admin, { name, firstResponseTargetSecs: 4 * 3600 })

      const page = await asPerson('admin')
      await page.goto('/admin/settings/sla')
      const actions = page.getByRole('button', { name: `Actions for ${name}` })
      const editItem = page.getByRole('menuitem', { name: 'Edit' })
      await clickUntil(actions, editItem)
      await editItem.click()
      const dialog = page.getByRole('dialog')
      const firstResponse = dialog.locator('#sla-firstResponseTargetSecs')
      await expect(firstResponse).toHaveValue('4')
      await firstResponse.fill('2')
      await dialog.getByRole('button', { name: 'Save changes' }).click()
      await expect(page.getByText('Policy updated')).toBeVisible()
      await expect
        .poll(async () => (await policyRow(policy.id)).first_response_target_secs)
        .toBe(2 * 3600)

      // Clearing a set target is refused in the editor and by the server.
      await expect(dialog).toBeHidden()
      await clickUntil(actions, editItem)
      await editItem.click()
      await dialog.locator('#sla-firstResponseTargetSecs').fill('')
      await dialog.getByRole('button', { name: 'Save changes' }).click()
      await expect(
        dialog.getByText('Targets can be changed but not removed once set', { exact: true })
      ).toBeVisible()
      const removal = await fnOk<{ ok: boolean; code?: string }>(admin, 'updateSlaPolicyFn', {
        id: policy.id,
        firstResponseTargetSecs: null,
      })
      expect(removal).toMatchObject({ ok: false, code: 'TARGET_REMOVAL' })
      expect((await policyRow(policy.id)).first_response_target_secs).toBe(2 * 3600)
      await admin.dispose()
    }
  )

  test(
    'SLA-04 a policy a live workflow applies cannot be archived; otherwise it archives and restores',
    { tag: '@nightly' },
    async ({ playwright, asPerson, marker }) => {
      const admin = await apiAs(playwright, 'admin')
      const name = `Archivable ${marker}`
      const policy = await createSlaPolicy(admin, { name, firstResponseTargetSecs: 3600 })
      // Scoped to an address no conversation has: it never runs.
      const workflow = await createWorkflow(admin, {
        name: `Uses ${marker}`,
        triggerType: 'conversation.created',
        onlyFor: `${marker}-nobody@customers.example`,
        steps: [
          { id: 'apply', type: 'action', action: { type: 'apply_sla', policyId: policy.id } },
        ],
      })
      try {
        await fnOk(admin, 'setWorkflowStatusFn', { id: workflow.id, status: 'live' })
        const page = await asPerson('admin')
        await page.goto('/admin/settings/sla')
        const actions = page.getByRole('button', { name: `Actions for ${name}` })
        const archiveItem = page.getByRole('menuitem', { name: 'Archive' })
        await clickUntil(actions, archiveItem)
        await archiveItem.click()
        await expect(page.getByText(`In use by live workflow: e2e-4b Uses ${marker}`)).toBeVisible()
        expect((await policyRow(policy.id)).deleted_at).toBeNull()

        await fnOk(admin, 'setWorkflowStatusFn', { id: workflow.id, status: 'paused' })
        await page.reload()
        await clickUntil(actions, archiveItem)
        await archiveItem.click()
        await expect(page.getByText('Policy archived')).toBeVisible()
        await expect.poll(async () => (await policyRow(policy.id)).deleted_at).not.toBeNull()
        // Archived policies cannot be edited.
        const edit = await callFn(admin, 'updateSlaPolicyFn', { id: policy.id, name: 'x' })
        expect(edit.code).toBe('SLA_POLICY_NOT_FOUND')

        await page.getByRole('tab', { name: /^Archived/ }).click()
        const restoreItem = page.getByRole('menuitem', { name: 'Restore' })
        await clickUntil(actions, restoreItem)
        await restoreItem.click()
        await expect(page.getByText('Policy restored')).toBeVisible()
        await expect.poll(async () => (await policyRow(policy.id)).deleted_at).toBeNull()
      } finally {
        await takeDownWorkflow(admin, workflow.id)
        await admin.dispose()
      }
    }
  )

  test(
    'SLA-05 setting a policy as the default saves it and shows it as the default',
    { tag: '@core' },
    async ({ playwright, asPerson, marker }) => {
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      const before = await fnOk<{ policyId: string | null }>(
        admin,
        'fetchDefaultSlaPolicyFn',
        undefined,
        { method: 'GET' }
      )
      // Same shape as every default in this suite, so other tests never notice.
      const name = `Default ${marker}`
      const policy = await createSlaPolicy(admin, { name, ...DEFAULT_SLA_TARGETS })
      try {
        const page = await asPerson('admin')
        await page.goto('/admin/settings/sla')
        const select = page.getByRole('combobox').first()
        const option = page.getByRole('option', { name })
        await clickUntil(select, option)
        await option.click()
        await expect
          .poll(
            async () =>
              (
                await fnOk<{ policyId: string | null }>(
                  admin,
                  'fetchDefaultSlaPolicyFn',
                  undefined,
                  {
                    method: 'GET',
                  }
                )
              ).policyId
          )
          .toBe(policy.id)
        await page.reload()
        await expect(page.getByRole('combobox').first()).toHaveText(name)

        // An archived or unknown policy is refused as the default.
        const archived = await createSlaPolicy(admin, {
          name: `Archived ${marker}`,
          ...DEFAULT_SLA_TARGETS,
        })
        await fnOk(admin, 'archiveSlaPolicyFn', { id: archived.id })
        const refused = await callFn(admin, 'updateDefaultSlaPolicyFn', { policyId: archived.id })
        expect(refused.ok).toBe(false)
        expect(refused.code).toBe('SLA_POLICY_NOT_FOUND')
      } finally {
        // Back to the previous default (a policy of the same shape).
        await fnOk(admin, 'updateDefaultSlaPolicyFn', { policyId: before.policyId })
        await admin.dispose()
      }
    }
  )

  test(
    'SLA-31 a teammate with conversation.view gets the SLA option list but not the settings list',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const admin = await apiAs(playwright, 'admin')
      const withTtr = await createSlaPolicy(admin, {
        name: `Options TTR ${marker}`,
        timeToResolveTargetSecs: 3600,
      })
      const withoutTtr = await createSlaPolicy(admin, {
        name: `Options FR ${marker}`,
        firstResponseTargetSecs: 3600,
      })
      const contributor = await apiAs(playwright, 'contributor')
      const options = await fnOk<
        { id: string; name: string; hasTimeToResolveTarget: boolean; targetsSummary: string }[]
      >(contributor, 'listSlaPolicyOptionsFn', undefined, { method: 'GET' })
      expect(options.find((o) => o.id === withTtr.id)?.hasTimeToResolveTarget).toBe(true)
      expect(options.find((o) => o.id === withoutTtr.id)?.hasTimeToResolveTarget).toBe(false)

      const settingsList = await callFn<SlaPolicyDTO[]>(
        contributor,
        'listSlaPoliciesFn',
        undefined,
        {
          method: 'GET',
        }
      )
      expect(settingsList.ok).toBe(false)
      const noAccess = await apiAs(playwright, 'noAccess')
      expect(
        (await callFn(noAccess, 'listSlaPolicyOptionsFn', undefined, { method: 'GET' })).ok
      ).toBe(false)
      await Promise.all([admin.dispose(), contributor.dispose(), noAccess.dispose()])
    }
  )
})

test.describe('SLA in the inbox', () => {
  test(
    'SLA-26 the chip counts down, turns overdue on a later clock, and the sla sort orders by due time',
    { tag: '@core' },
    async ({ playwright, request, asPerson, marker }) => {
      test.setTimeout(90_000)
      const admin = await apiAs(playwright, 'admin')
      const { sooner, later } = await twoDueConversations(admin, request, marker)

      const page = await asPerson('admin')
      await page.goto(`/admin/inbox?i=${sooner.id}`)
      const chip = page.locator('span[title$="· first response target"]').first()
      await expect(chip).toHaveText(/^(9|10)m$/, { timeout: 20_000 })
      await expect(chip).toHaveClass(/text-warning/)

      // Half an hour later on the teammate's clock it is 20 minutes over.
      const overdue = await asPerson('admin')
      await overdue.clock.install({ time: new Date(Date.now() + 30 * 60_000) })
      await overdue.goto(`/admin/inbox?i=${sooner.id}`)
      const overdueChip = overdue.locator('span[title$="· first response target"]').first()
      await expect(overdueChip).toHaveText(/^(19|20)m over$/, { timeout: 20_000 })
      await expect(overdueChip).toHaveClass(/text-destructive/)

      // The conversation list's sla sort: due first, listed first (most recent
      // would list the later-created one first).
      const ids = await listedIds(admin, { sort: 'sla', status: 'open', search: marker })
      expect(ids.indexOf(sooner.id)).toBeGreaterThanOrEqual(0)
      expect(ids.indexOf(sooner.id)).toBeLessThan(ids.indexOf(later.id))
      const recent = await listedIds(admin, { sort: 'recent', status: 'open', search: marker })
      expect(recent.indexOf(later.id)).toBeLessThan(recent.indexOf(sooner.id))
      await admin.dispose()
    }
  )

  test(
    'SLA-26 picking "SLA breach soonest" in All conversations orders the list by due time',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'The sort menu offers the sla sort on the unified list scopes, which clamp it to most recent (inbox-scope.ts INBOX_UNIFIED_SORTS). See QUARANTINE.md.',
      },
    },
    async ({ playwright, request, asPerson, marker }) => {
      test.setTimeout(90_000)
      const admin = await apiAs(playwright, 'admin')
      const { sooner } = await twoDueConversations(admin, request, marker)
      const page = await asPerson('admin')
      await page.goto(`/admin/inbox?i=${sooner.id}`)
      const sortButton = page.getByRole('button', { name: /^Sort: / })
      const slaOption = page
        .getByRole('menuitemradio', { name: 'SLA breach soonest' })
        .or(page.getByRole('option', { name: 'SLA breach soonest' }))
        .or(page.getByRole('menuitem', { name: 'SLA breach soonest' }))
        .first()
      await clickUntil(sortButton, slaOption)
      await slaOption.click()
      await expect(sortButton).toHaveText(/SLA breach soonest/)
      const soonerRow = page
        .locator('button')
        .filter({ hasText: `Sooner ${marker}` })
        .first()
      const laterRow = page
        .locator('button')
        .filter({ hasText: `Later ${marker}` })
        .first()
      await expect(soonerRow).toBeAttached({ timeout: 20_000 })
      await expect(laterRow).toBeAttached()
      const y = async (l: typeof soonerRow) => (await l.boundingBox())?.y ?? Number.NaN
      await expect
        .poll(async () => (await y(soonerRow)) < (await y(laterRow)), { timeout: 15_000 })
        .toBe(true)
      await admin.dispose()
    }
  )

  test(
    'SLA-27 removing the SLA clears the chip in every open inbox; a teammate without permission is refused',
    { tag: '@core' },
    async ({ playwright, request, asPerson, marker }) => {
      test.setTimeout(90_000)
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      const conversation = await startEmailConversation(request, marker)
      const stamp = await waitForStamp(conversation.uuid, 'stamp', () => true)

      const noAccess = await apiAs(playwright, 'noAccess')
      const refused = await callFn(noAccess, 'removeConversationSlaFn', {
        conversationId: conversation.id,
      })
      expect(refused.ok).toBe(false)
      expect(await slaStampOf(conversation.uuid)).not.toBeNull()

      const url = `/admin/inbox?i=${conversation.id}`
      const watcher = await asPerson('agentB')
      await watcher.goto(url)
      await expect(watcher.locator('span[title$="· first response target"]').first()).toBeVisible({
        timeout: 20_000,
      })

      const page = await asPerson('admin')
      await page.goto(url)
      await expect(page.locator('span[title$="· first response target"]').first()).toBeVisible({
        timeout: 20_000,
      })
      await page.getByRole('button', { name: 'More conversation actions' }).click()
      await page.getByRole('menuitem', { name: `Remove SLA (${stamp.policyName})` }).click()
      await expect(page.getByText('SLA removed')).toBeVisible()
      await expect(page.locator('span[title$="· first response target"]')).toHaveCount(0)
      // The other open inbox drops the chip from the broadcast, with no reload.
      await expect(watcher.locator('span[title$="· first response target"]')).toHaveCount(0, {
        timeout: 15_000,
      })

      expect(await slaStampOf(conversation.uuid)).toBeNull()
      await waitForSlaEvent({ conversationUuid: conversation.uuid }, 'removed')
      const again = await fnOk<{ removed: boolean }>(admin, 'removeConversationSlaFn', {
        conversationId: conversation.id,
      })
      expect(again.removed).toBe(false)
      expect(await slaEventsFor({ conversationUuid: conversation.uuid }, 'removed')).toHaveLength(1)
      await Promise.all([admin.dispose(), noAccess.dispose()])
    }
  )
})
