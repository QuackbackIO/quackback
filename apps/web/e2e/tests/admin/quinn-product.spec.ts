import { test, expect, type Page } from '@playwright/test'
import postgres from 'postgres'
import { zipSync, strToU8 } from 'fflate'
import { randomUUID } from 'node:crypto'
import { fromUuid } from '@quackback/ids'
import type { AssistantConfig } from '../../../src/lib/shared/assistant/config'
import { bustWorkspaceSettings, parseJson } from '../../scripts/_lib'

const connection = process.env.QUINN_E2E_DATABASE_URL
// Opt in explicitly: this suite changes settings and creates fixtures in an isolated database.
const sql = postgres(connection ?? 'postgresql://localhost/quinn_e2e_not_configured', { max: 2 })
const tag = `Quinn E2E ${Date.now()}`
const publicUrl = `https://example.com/?quinn_e2e=${randomUUID()}`
const ids = {
  document: randomUUID(),
  webpage: randomUUID(),
  skill: randomUUID(),
  category: randomUUID(),
  article: randomUUID(),
}
const articleId = fromUuid('article', ids.article)
const documentId = fromUuid('assistant_document', ids.document)
const longInstructions = 'Preserve this legacy instruction. '.repeat(230)
let original: {
  id: string
  assistant_config: AssistantConfig
  widget_config: string | null
  feature_flags: string | null
  metadata: string | null
}
async function open(page: Page, path: string, heading: string) {
  await page.goto(path)
  await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible()
}
async function addGuidance(page: Page) {
  await open(page, '/admin/automation/guidance', 'Guidance')
  // Retry the action only until hydrated; SSR markup can precede handlers.
  await expect(async () => {
    if (!(await page.getByRole('dialog').isVisible()))
      await page.getByRole('button', { name: 'Add guidance', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15000 })
  return page.getByRole('dialog')
}
async function searchGuidance(page: Page, value: string) {
  await expect(async () => {
    await page.getByPlaceholder('Search guidance').fill('')
    await page.getByPlaceholder('Search guidance').fill(value)
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(1, {
      timeout: 1000,
    })
  }).toPass({ timeout: 15000 })
}
async function citation(request: Page['request'], type: string, id: string) {
  return request.get(`/api/widget/quinn-source?type=${type}&id=${id}`)
}

test.describe('Quinn implemented product acceptance', () => {
  test.describe.configure({ mode: 'default' })
  test.skip(!connection, 'Set QUINN_E2E_DATABASE_URL to the isolated application database')
  test.beforeAll(async () => {
    original = (
      await sql<
        (typeof original)[]
      >`SELECT id, assistant_config, widget_config, feature_flags, metadata FROM settings ORDER BY created_at LIMIT 1`
    )[0]
    if (!original) throw new Error('Seed the isolated E2E database first')
    const flags = { ...parseJson(original.feature_flags), supportInbox: true, helpCenter: true }
    const config = structuredClone(original.assistant_config)
    for (const role of ['agent', 'copilot'] as const)
      Object.assign(config.agents[role].knowledge, {
        helpCenter: true,
        documents: true,
        webPages: true,
      })
    await sql`UPDATE settings SET feature_flags=${JSON.stringify(flags)}, assistant_config=${sql.json(config)}, assistant_config_revision=assistant_config_revision+1 WHERE id=${original.id}`
    await bustWorkspaceSettings(sql)
    await sql`INSERT INTO assistant_documents (id,title,file_name,mime_type,content) VALUES (${ids.document},${tag + ' document'},'e2e.pdf','application/pdf','Public document evidence for Quinn E2E.')`
    await sql`INSERT INTO assistant_web_sources (id,title,url,content,fetched_at) VALUES (${ids.webpage},${tag + ' webpage'},${'https://example.com/' + ids.webpage},'Public web evidence for Quinn E2E.',now())`
    await sql`INSERT INTO agent_skills (id,name,when_to_use,instructions,assignments) VALUES (${ids.skill},${tag + ' legacy'},'When preserving a legacy procedure',${longInstructions},${sql.json({ agent: true, copilot: true, workspace: true })})`
    const author = (
      await sql`SELECT principal.id FROM principal JOIN "user" ON principal.user_id="user".id WHERE "user".email='demo@example.com' LIMIT 1`
    )[0]
    await sql`INSERT INTO kb_categories (id,name,slug) VALUES (${ids.category},${tag},${ids.category})`
    await sql`INSERT INTO kb_articles (id,category_id,title,slug,content,principal_id,published_at) VALUES (${ids.article},${ids.category},${tag + ' article'},${ids.article},'Public article evidence.',${author.id},now())`
  })
  test.afterAll(async () => {
    if (original) {
      await sql`UPDATE settings SET assistant_config=${sql.json(original.assistant_config)}, assistant_config_revision=assistant_config_revision+1, widget_config=${original.widget_config}, feature_flags=${original.feature_flags}, metadata=${original.metadata} WHERE id=${original.id}`
      await bustWorkspaceSettings(sql)
    }
    await sql`DELETE FROM assistant_guidance_rules WHERE name LIKE ${tag + '%'}`
    await sql`DELETE FROM agent_skills WHERE id=${ids.skill}`
    await sql`DELETE FROM assistant_documents WHERE id=${ids.document} OR title LIKE ${tag + '%'}`
    await sql`DELETE FROM assistant_web_sources WHERE id=${ids.webpage} OR url=${publicUrl}`
    await sql`DELETE FROM kb_categories WHERE id=${ids.category}`
    await sql.end()
  })
  test('navigation and all legacy aliases', async ({ page }) => {
    for (const [path, heading] of [
      ['', 'Quinn'],
      ['knowledge', 'Knowledge'],
      ['guidance', 'Guidance'],
      ['connectors', 'Connections'],
      ['deploy', 'Deploy'],
      ['performance', 'Improve'],
    ])
      await open(page, '/admin/automation/' + path, heading)
    for (const role of ['agent', 'copilot'])
      for (const [tab, destination] of [
        ['basics', 'deploy'],
        ['knowledge', 'knowledge'],
        ['guidance', 'guidance'],
        ['actions', 'connectors'],
      ]) {
        await page.goto(`/admin/automation/${role}?tab=${tab}`)
        await expect(page).toHaveURL(new RegExp(`/automation/${destination}$`))
      }
    await page.goto('/admin/automation/skills')
    await expect(page).toHaveURL(/\/automation\/guidance$/)
  })
  test('Guidance create, edit, disable, search and delete persist', async ({ page }) => {
    const dialog = await addGuidance(page)
    await dialog.getByLabel('Name', { exact: true }).fill(tag + ' rule')
    await dialog.getByLabel('Applies when').selectOption('always')
    await dialog.getByLabel('What should Quinn do?').fill('Explain the next step clearly.')
    await dialog.getByLabel('Uses', { exact: true }).selectOption('copilot')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await page.reload()
    await searchGuidance(page, tag + ' rule')
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await dialog
      .getByLabel('What should Quinn do?')
      .fill('Explain the next step and verify the result.')
    await dialog.getByRole('switch', { name: 'Enabled' }).uncheck()
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect
      .poll(
        async () =>
          (
            await sql`SELECT agent,enabled,instruction FROM assistant_guidance_rules WHERE name=${tag + ' rule'}`
          )[0]
      )
      .toEqual({
        agent: 'copilot',
        enabled: false,
        instruction: 'Explain the next step and verify the result.',
      })
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await sql`SELECT id FROM assistant_guidance_rules WHERE name=${tag + ' rule'}`).length
      )
      .toBe(0)
  })
  test('invalid Guidance and canceled discard retain the draft', async ({ page }) => {
    const dialog = await addGuidance(page)
    await dialog.getByLabel('Name', { exact: true }).fill(tag + ' invalid')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    const confirm = page.getByRole('alertdialog')
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(tag + ' invalid')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await confirm.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(
      await sql`SELECT id FROM assistant_guidance_rules WHERE name=${tag + ' invalid'}`
    ).toHaveLength(0)
  })
  test('legacy guidance preserves long content and all assignments', async ({ page }) => {
    await open(page, '/admin/automation/guidance', 'Guidance')
    await searchGuidance(page, tag + ' legacy')
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('What should Quinn do?')).toHaveValue(longInstructions)
    await expect(
      dialog.getByText('Customer conversations, Support teammates, Workspace and Slack', {
        exact: true,
      })
    ).toBeVisible()
    await dialog.getByLabel('Name', { exact: true }).fill(tag + ' legacy edited')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    const [saved] =
      await sql`SELECT instructions,assignments FROM agent_skills WHERE id=${ids.skill}`
    expect(saved.instructions).toBe(longInstructions.trim())
    expect(saved.assignments).toEqual({ agent: true, copilot: true, workspace: true })
  })
  test('document switches persist independently and revoke old citations', async ({
    page,
    request,
  }) => {
    await open(page, '/admin/automation/knowledge', 'Knowledge')
    const customer = page.getByRole('switch', {
      name: tag + ' document: Customer conversations',
      exact: true,
    })
    const team = page.getByRole('switch', {
      name: tag + ' document: Support teammates',
      exact: true,
    })
    await expect(customer).toBeChecked()
    expect((await citation(request, 'document', documentId)).status()).toBe(200)
    await customer.click()
    await expect
      .poll(async () => (await citation(request, 'document', documentId)).status())
      .toBe(404)
    await page.reload()
    await expect(customer).not.toBeChecked()
    await expect(team).toBeChecked()
    await team.click()
    await expect
      .poll(
        async () =>
          (
            await sql`SELECT assistant_customer_use,assistant_team_use FROM assistant_documents WHERE id=${ids.document}`
          )[0]
      )
      .toEqual({ assistant_customer_use: false, assistant_team_use: false })
    await customer.click()
    await expect
      .poll(async () => (await citation(request, 'document', documentId)).status())
      .toBe(200)
    await expect(team).not.toBeChecked()
  })
  test('type master caps row controls and access without rewriting row preferences', async ({
    page,
    request,
  }) => {
    await open(page, '/admin/automation/knowledge', 'Knowledge')
    const master = page.getByRole('switch', {
      name: 'Documents: Customer conversations',
      exact: true,
    })
    const source = page.getByRole('switch', {
      name: tag + ' document: Customer conversations',
      exact: true,
    })
    await expect(source).toBeEnabled()
    await master.click()
    await expect(source).toBeDisabled()
    await expect(source).toBeChecked()
    await expect
      .poll(async () => (await citation(request, 'document', documentId)).status())
      .toBe(404)
    expect(
      (await sql`SELECT assistant_config FROM settings WHERE id=${original.id}`)[0].assistant_config
        .agents.copilot.knowledge.documents
    ).toBe(true)
    await master.click()
    await expect(source).toBeEnabled()
    await expect
      .poll(async () => (await citation(request, 'document', documentId)).status())
      .toBe(200)
  })
  test('web-page switches and removal revoke citations', async ({ page, request }) => {
    await open(page, '/admin/automation/knowledge', 'Knowledge')
    const id = fromUuid('assistant_web_source', ids.webpage)
    const customer = page.getByRole('switch', {
      name: tag + ' webpage: Customer conversations',
      exact: true,
    })
    await customer.click()
    await expect.poll(async () => (await citation(request, 'webpage', id)).status()).toBe(404)
    await customer.click()
    await expect.poll(async () => (await citation(request, 'webpage', id)).status()).toBe(200)
    const row = page
      .locator('div.border-t')
      .filter({ has: page.getByText(tag + ' webpage', { exact: true }) })
    await row.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect.poll(async () => (await citation(request, 'webpage', id)).status()).toBe(404)
  })
  test('article exclusions persist, appear in the filter, and revoke citations', async ({
    page,
    request,
  }) => {
    await page.goto(`/admin/help-center?article=${articleId}`)
    const dialog = page.getByRole('dialog')
    const customer = dialog.getByRole('checkbox', {
      name: 'Use in customer conversations',
      exact: true,
    })
    await expect(customer).toBeEnabled()
    expect((await citation(request, 'article', articleId)).status()).toBe(200)
    await customer.click()
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await expect
      .poll(async () => (await citation(request, 'article', articleId)).status())
      .toBe(404)
    await page.goto('/admin/help-center')
    await page.getByText('Excluded from Quinn', { exact: true }).click()
    await expect(page.getByText(tag + ' article', { exact: true })).toBeVisible()
    await page.goto(`/admin/help-center?article=${articleId}`)
    await expect(customer).not.toBeChecked()
    await expect(
      dialog.getByRole('checkbox', { name: 'Use for support teammates', exact: true })
    ).toBeChecked()
  })
  test('source reads reject private, segmented, deleted and malformed sources without caching', async ({
    request,
  }) => {
    await sql`UPDATE kb_articles SET assistant_customer_use=true WHERE id=${ids.article}`
    const response = await citation(request, 'article', articleId)
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(await response.text()).toContain('Public article evidence.')
    await sql`UPDATE kb_categories SET is_public=false WHERE id=${ids.category}`
    expect((await citation(request, 'article', articleId)).status()).toBe(404)
    await sql`UPDATE kb_categories SET is_public=true,segment_ids='["restricted"]'::jsonb WHERE id=${ids.category}`
    expect((await citation(request, 'article', articleId)).status()).toBe(404)
    await sql`UPDATE kb_categories SET segment_ids='[]'::jsonb WHERE id=${ids.category}`
    await sql`UPDATE kb_articles SET deleted_at=now() WHERE id=${ids.article}`
    expect((await citation(request, 'article', articleId)).status()).toBe(404)
    expect((await citation(request, 'article', 'bad-id')).status()).toBe(404)
    expect((await citation(request, 'ticket', articleId)).status()).toBe(404)
  })
  test('mobile pages and editor have no overflow or browser exceptions', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, '/admin/automation/knowledge', 'Knowledge')
    await expect(
      page.getByRole('switch', { name: tag + ' document: Customer conversations', exact: true })
    ).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    const dialog = await addGuidance(page)
    await expect(dialog.getByLabel('What should Quinn do?')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(errors).toEqual([])
  })
  test('stale voice edits are rejected while retaining the unsaved instructions', async ({
    page,
    context,
  }) => {
    const other = await context.newPage()
    const editVoice = async (target: Page) => {
      await open(target, '/admin/automation/guidance', 'Guidance')
      await searchGuidance(target, 'Everyday instructions')
      await target.getByRole('button', { name: 'Edit', exact: true }).click()
      return target.getByRole('dialog')
    }
    const first = await editVoice(page)
    const stale = await editVoice(other)
    await first.getByLabel('What should Quinn do?').fill(tag + ' current voice')
    await first.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(first).toBeHidden()
    await stale.getByLabel('What should Quinn do?').fill(tag + ' stale voice')
    await stale.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(stale.getByRole('alert')).toContainText(/changed|conflict/i)
    await expect(stale.getByLabel('What should Quinn do?')).toHaveValue(tag + ' stale voice')
    expect(
      (await sql`SELECT assistant_config FROM settings WHERE id=${original.id}`)[0].assistant_config
        .agents.agent.voice.additionalInstructions
    ).toBe(tag + ' current voice')
    await other.close()
  })

  test('Messenger and Email clocks save independently; channel edits preserve a Quinn draft', async ({
    page,
  }) => {
    await page.goto('/admin/settings/channels/messenger')
    const team = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Conversation behavior', exact: true }) })
      .first()
    const quinn = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Quinn conversations', exact: true }) })
      .last()
    await expect(quinn.getByLabel('Close after', { exact: true })).toBeVisible()
    const teamClose = team.getByLabel('Close after', { exact: true }).first()
    const quinnClose = quinn.getByLabel('Close after', { exact: true })
    await expect(async () => {
      await quinnClose.fill('')
      await quinnClose.fill('25')
      await expect(quinn.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled({
        timeout: 1000,
      })
    }).toPass({ timeout: 15000 })
    await teamClose.fill('45')
    await expect(quinnClose).toHaveValue('25')
    await expect(quinnClose).toBeDisabled()
    await team.getByRole('button', { name: 'Cancel', exact: true }).last().click()
    await expect(quinnClose).toBeEnabled()
    await expect(quinnClose).toHaveValue('25')
    await quinn.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect
      .poll(
        async () =>
          JSON.parse((await sql`SELECT metadata FROM settings WHERE id=${original.id}`)[0].metadata)
            ?.conversationInactivity?.assistant.closeMinutes
      )
      .toBe(25)
    await page.reload()
    await expect(quinnClose).toHaveValue('25')
    await page.goto('/admin/settings/channels/email')
    await expect(quinn.getByLabel('Close after', { exact: true })).toHaveValue('72')
    await expect(async () => {
      await quinn.getByLabel('Close after', { exact: true }).fill('')
      await quinn.getByLabel('Close after', { exact: true }).fill('96')
      await expect(quinn.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled({
        timeout: 1000,
      })
    }).toPass({ timeout: 15000 })
    await quinn.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect
      .poll(
        async () =>
          JSON.parse((await sql`SELECT metadata FROM settings WHERE id=${original.id}`)[0].metadata)
            ?.conversationInactivity?.assistant.email.closeHours
      )
      .toBe(96)
    expect(
      JSON.parse((await sql`SELECT metadata FROM settings WHERE id=${original.id}`)[0].metadata)
        ?.conversationInactivity?.assistant.closeMinutes
    ).toBe(25)
  })

  test('channel ownership Custom workflows and Off hide built-in Quinn controls', async ({
    page,
  }) => {
    await page.goto('/admin/settings/channels/messenger')
    const mode = page.getByLabel('Inactivity handling', { exact: true })
    await expect(async () => {
      await mode.selectOption('custom')
      await expect(
        page.getByRole('heading', { name: 'Quinn conversations', exact: true })
      ).toBeHidden({ timeout: 1000 })
    }).toPass({ timeout: 15000 })
    await expect(page.getByText(/Custom workflows handle/).first()).toBeVisible()
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect
      .poll(
        async () =>
          JSON.parse((await sql`SELECT metadata FROM settings WHERE id=${original.id}`)[0].metadata)
            ?.conversationInactivity?.channels.messenger
      )
      .toBe('custom')
    await page.reload()
    await expect(mode).toHaveValue('custom')
    await expect(async () => {
      await mode.selectOption('off')
      await expect(
        page.getByText(
          'Inactivity automation is off for Messenger conversations. Saved built-in settings are retained.'
        )
      ).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 15000 })
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect
      .poll(
        async () =>
          JSON.parse((await sql`SELECT metadata FROM settings WHERE id=${original.id}`)[0].metadata)
            ?.conversationInactivity?.channels.messenger
      )
      .toBe('off')
    await mode.selectOption('built_in')
    await page.getByRole('button', { name: 'Save changes', exact: true }).last().click()
    await expect
      .poll(
        async () =>
          JSON.parse((await sql`SELECT metadata FROM settings WHERE id=${original.id}`)[0].metadata)
            ?.conversationInactivity?.channels.messenger
      )
      .toBe('built_in')
    await expect(
      page.getByRole('heading', { name: 'Quinn conversations', exact: true })
    ).toBeVisible()
  })

  test('deployment confirmation can be canceled and confirmed without changing teammate capability', async ({
    page,
  }) => {
    await open(page, '/admin/automation/deploy', 'Deploy')
    const teammateBefore = (
      await sql`SELECT assistant_config FROM settings WHERE id=${original.id}`
    )[0].assistant_config.agents.copilot.capabilities.qa
    const action = page.getByRole('button', { name: /^(Pause|Enable) automatic replies$/ })
    await expect(action).toBeVisible()
    const initial = await action.innerText()
    await expect(async () => {
      if (!(await page.getByRole('alertdialog').isVisible())) await action.click()
      await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(action).toHaveText(initial)
    await action.click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^(Pause|Enable) replies$/ })
      .click()
    await expect(action).not.toHaveText(initial)
    await page.reload()
    await expect(action).not.toHaveText(initial)
    expect(
      (await sql`SELECT assistant_config FROM settings WHERE id=${original.id}`)[0].assistant_config
        .agents.copilot.capabilities.qa
    ).toBe(teammateBefore)
  })

  test('anonymous callers cannot replay a source mutation or open Quinn admin routes', async ({
    page,
    browser,
    baseURL,
  }) => {
    await open(page, '/admin/automation/knowledge', 'Knowledge')
    const source = page.getByRole('switch', {
      name: tag + ' document: Customer conversations',
      exact: true,
    })
    await expect(source).toBeEnabled()
    const pending = page.waitForResponse((response) => {
      const req = response.request()
      return (
        req.method() === 'POST' &&
        req.url().includes('/_serverFn/') &&
        Boolean(req.postData()?.includes(documentId))
      )
    })
    await source.click()
    const response = await pending
    await response.finished()
    const captured = response.request()
    await expect(source).toBeEnabled()
    // Revert the legitimate mutation, so replaying it would cause an observable write.
    await sql`UPDATE assistant_documents SET assistant_customer_use=NOT assistant_customer_use WHERE id=${ids.document}`
    const before = (
      await sql`SELECT assistant_customer_use FROM assistant_documents WHERE id=${ids.document}`
    )[0].assistant_customer_use
    const anon = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
    try {
      const headers = await captured.allHeaders()
      delete headers.cookie
      delete headers.authorization
      const result = await anon.request.post(captured.url(), {
        data: captured.postData()!,
        headers,
      })
      // TanStack serializes thrown server-function errors in a 200 response.
      expect(await result.text()).toContain('Authentication required')
      expect(
        (
          await sql`SELECT assistant_customer_use FROM assistant_documents WHERE id=${ids.document}`
        )[0].assistant_customer_use
      ).toBe(before)
      const visitor = await anon.newPage()
      for (const route of [
        'knowledge',
        'guidance',
        'deploy',
        'agent?tab=knowledge',
        'copilot?tab=guidance',
        'skills',
      ]) {
        await visitor.goto('/admin/automation/' + route)
        await expect(visitor).not.toHaveURL(/\/admin\//)
      }
    } finally {
      await anon.close()
    }
  })

  for (const format of ['pdf', 'docx'] as const)
    test(`real ${format} upload extracts content, persists and can be removed`, async ({
      page,
      request,
    }) => {
      await open(page, '/admin/automation/knowledge', 'Knowledge')
      await expect(
        page.getByRole('switch', { name: tag + ' document: Customer conversations', exact: true })
      ).toBeEnabled()
      const content = 'Quinn uploaded evidence: refunds take seven days.'
      const bytes =
        format === 'docx'
          ? Buffer.from(
              zipSync({
                'word/document.xml': strToU8(
                  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${content}</w:t></w:r></w:p></w:body></w:document>`
                ),
              })
            )
          : Buffer.from(
              `%PDF-1.4\n1 0 obj\n<< /Length 90 >>\nstream\nBT /F1 12 Tf 72 720 Td (${content}) Tj ET\nendstream\nendobj\n%%EOF`
            )
      const name = tag + ' upload.' + format
      await page.getByLabel('Upload knowledge document').setInputFiles({
        name,
        mimeType:
          format === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: bytes,
      })
      await expect(page.getByText(name, { exact: true })).toBeVisible()
      const row = (
        await sql`SELECT id,content,assistant_customer_use,assistant_team_use FROM assistant_documents WHERE title=${name}`
      )[0]
      expect(row.content).toBe(content)
      expect(row.assistant_customer_use).toBe(true)
      expect(row.assistant_team_use).toBe(true)
      expect(
        await (await citation(request, 'document', fromUuid('assistant_document', row.id))).text()
      ).toContain(content)
      await page.reload()
      const source = page
        .locator('div.border-t')
        .filter({ has: page.getByText(name, { exact: true }) })
      await source.getByRole('button', { name: 'Remove', exact: true }).click()
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Remove', exact: true })
        .click()
      await expect(page.getByText(name, { exact: true })).toBeHidden()
      expect(
        (await citation(request, 'document', fromUuid('assistant_document', row.id))).status()
      ).toBe(404)
    })

  test('document validation and private-network URL rejection leave no source rows', async ({
    page,
  }) => {
    await open(page, '/admin/automation/knowledge', 'Knowledge')
    await expect(
      page.getByRole('switch', { name: tag + ' document: Customer conversations', exact: true })
    ).toBeEnabled()
    const upload = page.getByLabel('Upload knowledge document')
    await upload.setInputFiles({
      name: tag + ' invalid.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('not a PDF'),
    })
    await expect(page.getByText(/No text could be extracted/)).toBeVisible()
    await upload.setInputFiles({
      name: tag + ' large.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    })
    await expect(page.getByText('Choose a document smaller than 5 MB.')).toBeVisible()
    await page.getByLabel('Web page URL', { exact: true }).fill('http://127.0.0.1/private')
    await page.getByRole('button', { name: 'Add page', exact: true }).click()
    await expect(
      page
        .locator('[data-sonner-toast]')
        .filter({ hasText: /URL is not allowed|private|blocked|public|loopback|SSRF/i })
        .last()
    ).toBeVisible()
    expect(
      (
        await sql`SELECT id FROM assistant_documents WHERE title IN (${tag + ' invalid.pdf'},${tag + ' large.pdf'})`
      ).length
    ).toBe(0)
    expect(
      (await sql`SELECT id FROM assistant_web_sources WHERE url='http://127.0.0.1/private'`).length
    ).toBe(0)
  })

  test('a Help Center editor can change article use but cannot manage Quinn', async ({
    page,
    browser,
    baseURL,
  }) => {
    const user = randomUUID(),
      principal = randomUUID(),
      role = randomUUID()
    const email = `quinn-${user}@example.com`
    const limited = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    })
    try {
      await sql`INSERT INTO "user" (id,name,email,email_verified) VALUES (${user},${tag + ' editor'},${email},true)`
      await sql`INSERT INTO principal (id,user_id,role,type,created_at) VALUES (${principal},${user},'member','user',now())`
      await sql`INSERT INTO roles (id,key,name) VALUES (${role},${role},${tag + ' editor'})`
      for (const permission of await sql`SELECT id FROM permissions WHERE key IN ('help_center.manage','member.view')`) {
        await sql`INSERT INTO role_permissions (id,role_id,permission_id) VALUES (${randomUUID()},${role},${permission.id})`
      }
      await sql`INSERT INTO principal_role_assignments (id,principal_id,role_id) VALUES (${randomUUID()},${principal},${role})`
      const login = await limited.request.post('/api/auth/sign-in/magic-link', {
        data: { email, callbackURL: '/admin/help-center' },
      })
      expect(login.ok()).toBe(true)
      const token = (
        await sql`SELECT identifier FROM verification WHERE value LIKE ${'%"email":"' + email + '"%'} AND expires_at>now() ORDER BY created_at DESC LIMIT 1`
      )[0].identifier
      const verified = await limited.request.get(
        `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent('/admin/help-center')}`,
        { maxRedirects: 0 }
      )
      expect(verified.status()).toBe(302)
      expect(
        (await limited.cookies()).some((cookie) => cookie.name.includes('session_token'))
      ).toBe(true)
      await sql`UPDATE kb_articles SET deleted_at=NULL,assistant_customer_use=true WHERE id=${ids.article}`
      const editor = await limited.newPage()
      await editor.goto(`/admin/help-center?article=${articleId}`)
      const dialog = editor.getByRole('dialog')
      const use = dialog.getByRole('checkbox', {
        name: 'Use in customer conversations',
        exact: true,
      })
      await expect(use).toBeEnabled()
      await use.click()
      await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click()
      await expect
        .poll(
          async () =>
            (await sql`SELECT assistant_customer_use FROM kb_articles WHERE id=${ids.article}`)[0]
              .assistant_customer_use
        )
        .toBe(false)
      for (const route of [
        'knowledge',
        'guidance',
        'deploy',
        'agent?tab=knowledge',
        'copilot?tab=guidance',
        'skills',
      ]) {
        await editor.goto('/admin/automation/' + route)
        await expect(
          editor.getByText(/Access denied|permission|don't have access/i).first()
        ).toBeVisible()
      }
      await open(page, '/admin/automation/knowledge', 'Knowledge')
      const source = page.getByRole('switch', {
        name: tag + ' document: Customer conversations',
        exact: true,
      })
      await expect(source).toBeEnabled()
      const pending = page.waitForResponse((response) => {
        const req = response.request()
        return (
          req.method() === 'POST' &&
          req.url().includes('/_serverFn/') &&
          Boolean(req.postData()?.includes(documentId))
        )
      })
      await source.click()
      const response = await pending
      await response.finished()
      const captured = response.request()
      await sql`UPDATE assistant_documents SET assistant_customer_use=NOT assistant_customer_use WHERE id=${ids.document}`
      const before = (
        await sql`SELECT assistant_customer_use FROM assistant_documents WHERE id=${ids.document}`
      )[0].assistant_customer_use
      const headers = await captured.allHeaders()
      delete headers.cookie
      delete headers.authorization
      const denied = await limited.request.post(captured.url(), {
        data: captured.postData()!,
        headers,
      })
      expect(await denied.text()).toContain('assistant.manage')
      expect(
        (
          await sql`SELECT assistant_customer_use FROM assistant_documents WHERE id=${ids.document}`
        )[0].assistant_customer_use
      ).toBe(before)
    } finally {
      await limited.close()
      await sql`DELETE FROM "user" WHERE id=${user}`
      await sql`DELETE FROM roles WHERE id=${role}`
      await sql`DELETE FROM verification WHERE value LIKE ${'%"email":"' + email + '"%'}`
    }
  })

  test('adding a public web page fetches, persists, and exposes a revocable citation', async ({
    page,
    request,
  }) => {
    await open(page, '/admin/automation/knowledge', 'Knowledge')
    await expect(
      page.getByRole('switch', { name: tag + ' document: Customer conversations', exact: true })
    ).toBeEnabled()
    await page.getByLabel('Web page URL', { exact: true }).fill(publicUrl)
    await page.getByRole('button', { name: 'Add page', exact: true }).click()
    await expect
      .poll(
        async () => (await sql`SELECT id FROM assistant_web_sources WHERE url=${publicUrl}`).length,
        { timeout: 15000 }
      )
      .toBe(1)
    const row = (
      await sql`SELECT id,title,content FROM assistant_web_sources WHERE url=${publicUrl}`
    )[0]
    expect(row.content).toContain('Example Domain')
    const id = fromUuid('assistant_web_source', row.id)
    expect((await citation(request, 'webpage', id)).status()).toBe(200)
    await sql`UPDATE assistant_web_sources SET enabled=false WHERE id=${row.id}`
    await page.reload()
    const source = page
      .locator('div.border-t')
      .filter({ has: page.getByText(row.title, { exact: true }) })
    await expect(source.getByRole('switch').first()).toBeDisabled()
    expect((await citation(request, 'webpage', id)).status()).toBe(404)
    await source.getByRole('button', { name: 'Enable source', exact: true }).click()
    await expect(source.getByRole('switch').first()).toBeEnabled()
    expect((await citation(request, 'webpage', id)).status()).toBe(200)
    await source.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect.poll(async () => (await citation(request, 'webpage', id)).status()).toBe(404)
  })

  test('every source master persists independently and private customer types stay unavailable', async ({
    page,
  }) => {
    await open(page, '/admin/automation/knowledge', 'Knowledge')
    await expect(
      page.getByRole('switch', { name: tag + ' document: Customer conversations', exact: true })
    ).toBeEnabled()
    for (const [key, label] of [
      ['helpCenter', 'Help center'],
      ['posts', 'Feedback posts'],
      ['pastConversations', 'Past conversations'],
      ['internalNotes', 'Internal notes'],
      ['tickets', 'Tickets'],
      ['changelog', 'Changelog'],
      ['documents', 'Documents'],
      ['webPages', 'Web pages'],
      ['status', 'System status'],
    ]) {
      for (const [role, use, other] of [
        ['agent', 'Customer conversations', 'copilot'],
        ['copilot', 'Support teammates', 'agent'],
      ]) {
        const control = page.getByRole('switch', { name: label + ': ' + use, exact: true })
        const before = (await sql`SELECT assistant_config FROM settings WHERE id=${original.id}`)[0]
          .assistant_config
        if (!(key in before.agents[role].knowledge)) {
          await expect(control).toBeDisabled()
          await expect(control).not.toBeChecked()
          continue
        }
        await control.click()
        await expect
          .poll(
            async () =>
              (await sql`SELECT assistant_config FROM settings WHERE id=${original.id}`)[0]
                .assistant_config.agents[role].knowledge[key]
          )
          .toBe(!before.agents[role].knowledge[key])
        expect(
          (await sql`SELECT assistant_config FROM settings WHERE id=${original.id}`)[0]
            .assistant_config.agents[other].knowledge
        ).toEqual(before.agents[other].knowledge)
        await expect(control).toBeEnabled()
        await control.click()
        await expect
          .poll(
            async () =>
              (await sql`SELECT assistant_config FROM settings WHERE id=${original.id}`)[0]
                .assistant_config.agents[role].knowledge[key]
          )
          .toBe(before.agents[role].knowledge[key])
      }
    }
  })
})
