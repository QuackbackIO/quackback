/**
 * Companies: the directory and company profile in the admin, the person's
 * Company card, company attributes (/admin/settings/companies), REST and the
 * permission gates.
 *
 * Journeys: PPL-C-01, PPL-C-02, PPL-C-03, PPL-C-04, PPL-C-07, PPL-C-08,
 * PPL-C-10, PPL-C-12, PPL-C-14, PPL-C-15, PPL-C-23, PPL-C-25, PPL-C-26,
 * PPL-C-29, PPL-C-30, PPL-C-31, PPL-C-36, PPL-C-37
 */
import { randomBytes } from 'node:crypto'
import type { APIRequestContext, Page } from '@playwright/test'
import { fromUuid, generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { createRole } from '../../support/access'
import { apiFor, createKey, expectJson } from '../../support/api-client'
import { supportEnv } from '../../support/env'
import {
  call,
  mustCall,
  personApi,
  portalUserRow,
  restAdmin,
  usersUrl,
  uuid,
} from '../../product/people'

interface Company {
  id: string
  name: string
}

async function newCompany(
  admin: APIRequestContext,
  name: string,
  extra: Record<string, unknown> = {}
): Promise<Company> {
  return mustCall<Company>(admin, 'createCompanyFn', { name, ...extra })
}

async function companyRow(id: string) {
  const [row] = await supportDb()`SELECT * FROM companies WHERE id = ${uuid(id)}`
  return row
}

function companyUrl(search: string, companyId?: string): string {
  const q = new URLSearchParams({ lifecycle: 'companies', search })
  if (companyId) q.set('company', companyId)
  return `/admin/users?${q.toString()}`
}

async function openCompany(page: Page, search: string, company: Company): Promise<void> {
  await page.goto(companyUrl(search, company.id))
  await expect(page.getByRole('heading', { name: company.name, exact: true })).toBeVisible({
    timeout: 15_000,
  })
}

function hex(): string {
  return randomBytes(4).toString('hex')
}

test.describe('companies directory and profile', () => {
  test(
    'PPL-C-01 the directory lists companies with domain, plan, spend and member counts',
    { tag: '@core' },
    async ({ asPerson, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const a = await newCompany(admin, `Alpha ${marker}`, {
        domain: `alpha-${marker}.example`,
        plan: 'Scale',
        mrrCents: 49900,
      })
      await newCompany(admin, `Bravo ${marker}`)
      for (const _ of [1, 2]) {
        const p = await portalUserRow(marker)
        await mustCall(admin, 'attachPrincipalToCompanyFn', {
          companyId: a.id,
          principalId: p.principalId,
        })
      }
      await admin.dispose()

      const page = await asPerson('admin')
      await page.goto(companyUrl(marker))
      // The count line is the directory-wide total by design
      // (companies-view.tsx), so only the rows are scoped to this test.
      const alpha = page.getByRole('button', { name: new RegExp(`Alpha ${marker}`) })
      await expect(alpha).toContainText(`alpha-${marker}.example`, { timeout: 15_000 })
      await expect(alpha).toContainText('Scale')
      await expect(alpha).toContainText('$499')
      await expect(alpha).toContainText('2')
      const bravo = page.getByRole('button', { name: new RegExp(`Bravo ${marker}`) })
      await expect(bravo).toContainText('No domain')

      // The nav entry opens the directory.
      await page.goto(usersUrl({ search: marker }))
      await expect(async () => {
        await page.getByRole('button', { name: /All companies/ }).click()
        await expect(page).toHaveURL(/lifecycle=companies/, { timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
    }
  )

  test(
    'PPL-C-02 creating a company from the directory opens its profile and audits it',
    { tag: '@core' },
    async ({ asPerson, marker }) => {
      const page = await asPerson('admin')
      await page.goto(companyUrl(marker))
      const dialog = page.getByRole('dialog')
      await expect(async () => {
        await page.getByRole('button', { name: 'New company' }).click()
        await expect(dialog).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      const create = dialog.getByRole('button', { name: 'Create company' })
      const nameBox = dialog.locator('#company-name')
      await nameBox.fill('   ')
      await expect(create).toBeDisabled()
      await nameBox.fill(`  Made ${marker}  `)
      await dialog.locator('#company-domain').fill(`made-${marker}.example`)
      await create.click()
      await expect(dialog).toHaveCount(0)
      await expect(page.getByRole('heading', { name: `Made ${marker}`, exact: true })).toBeVisible()

      const [row] = await supportDb()`SELECT id, name, domain, custom_attributes FROM companies
        WHERE name = ${`Made ${marker}`}`
      expect(row.domain).toBe(`made-${marker}.example`)
      expect(row.custom_attributes).toEqual({})
      const companyId = fromUuid('company', row.id as string)
      const audit = await pollFor('company.created audit row', async () => {
        const [r] = await supportDb()`SELECT actor_type, target_type, after_value FROM audit_log
          WHERE event_type = 'company.created' AND target_id = ${companyId}`
        return r ?? null
      })
      expect(audit).toMatchObject({
        target_type: 'company',
        after_value: { companyId, name: `Made ${marker}` },
      })
    }
  )

  test(
    'PPL-C-03 a company the admin creates is not labelled as API-sourced',
    {
      tag: '@core',
    },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const company = await newCompany(admin, `Manual ${marker}`)
      await admin.dispose()
      expect((await companyRow(company.id)).source).toBe('manual')
    }
  )

  test(
    'PPL-C-04 a duplicate domain is refused whatever its case',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const domain = `acme-${marker}.com`
      const first = await newCompany(admin, `First ${marker}`, { domain })
      const dup = await call(admin, 'createCompanyFn', {
        name: `Second ${marker}`,
        domain: domain.toUpperCase(),
      })
      expect(dup.ok).toBe(false)
      expect(dup.code).toBe('COMPANY_DOMAIN_EXISTS')
      const other = await newCompany(admin, `Third ${marker}`)
      const edit = await call(admin, 'updateCompanyFn', {
        id: other.id,
        domain: domain.toUpperCase(),
      })
      expect(edit.code).toBe('COMPANY_DOMAIN_EXISTS')
      const rows = await supportDb()`SELECT id FROM companies WHERE lower(domain) = ${domain}`
      expect(rows.map((r) => r.id)).toEqual([uuid(first.id)])
      await admin.dispose()
    }
  )

  test(
    'PPL-C-07 editing a company standard fields stores spend in cents and blanks as null',
    { tag: '@core' },
    async ({ asPerson, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const company = await newCompany(admin, `Edit ${marker}`, { industry: 'Old industry' })
      await admin.dispose()
      const page = await asPerson('admin')
      await openCompany(page, marker, company)
      await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
      await page.getByPlaceholder('acme.com', { exact: true }).fill(`edit-${marker}.example`)
      await page.getByPlaceholder('crm-123').fill(`crm-${marker}`)
      await page.getByPlaceholder('Scale').fill('Enterprise')
      await page.getByPlaceholder('499').fill('499.5')
      await page.getByPlaceholder('11-50').fill('51-200')
      await page.getByPlaceholder('https://acme.com').fill('https://edit.example')
      await page.getByPlaceholder('SaaS').fill('')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText('Company updated')).toBeVisible()

      expect(await companyRow(company.id)).toMatchObject({
        domain: `edit-${marker}.example`,
        external_id: `crm-${marker}`,
        plan: 'Enterprise',
        mrr_cents: 49950,
        size: '51-200',
        website: 'https://edit.example',
        industry: null,
      })
    }
  )

  test(
    'PPL-C-08 editing custom attribute values types them and blank removes the key',
    { tag: '@core' },
    async ({ asPerson, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const seats = `seats_${hex()}`
      const flag = `flag_${hex()}`
      const note = `note_${hex()}`
      await mustCall(admin, 'createCompanyAttributeFn', {
        key: seats,
        label: `Seats ${marker}`,
        type: 'number',
      })
      await mustCall(admin, 'createCompanyAttributeFn', {
        key: flag,
        label: `Flag ${marker}`,
        type: 'boolean',
      })
      await mustCall(admin, 'createCompanyAttributeFn', {
        key: note,
        label: `Note ${marker}`,
        type: 'string',
      })
      const company = await newCompany(admin, `Attrs ${marker}`, {
        customAttributes: { [note]: 'remove me' },
      })
      await admin.dispose()

      const page = await asPerson('admin')
      await openCompany(page, marker, company)
      await page.getByRole('button', { name: 'Edit', exact: true }).last().click()
      const field = (label: string) =>
        page
          .locator('div')
          .filter({ has: page.getByText(label, { exact: true }) })
          .filter({ has: page.locator('input, [role="combobox"]') })
          .last()
      await field(`Seats ${marker}`).locator('input').fill('12')
      await field(`Flag ${marker}`).getByRole('combobox').click()
      await page.getByRole('option', { name: 'True' }).click()
      await field(`Note ${marker}`).locator('input').fill('')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText('Attributes updated')).toBeVisible()

      const attrs = (await companyRow(company.id)).custom_attributes as Record<string, unknown>
      expect(attrs).toEqual({ [seats]: 12, [flag]: true })
    }
  )

  test(
    'PPL-C-10 deleting a company detaches its people and audits it',
    { tag: '@core' },
    async ({ asPerson, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const company = await newCompany(admin, `Doomed ${marker}`)
      const people = [await portalUserRow(marker), await portalUserRow(marker)]
      for (const p of people) {
        await mustCall(admin, 'attachPrincipalToCompanyFn', {
          companyId: company.id,
          principalId: p.principalId,
        })
      }
      await admin.dispose()

      const page = await asPerson('admin')
      await openCompany(page, marker, company)
      await page
        .getByRole('button', { name: 'Edit', exact: true })
        .first()
        .locator('xpath=following-sibling::button[1]')
        .click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog.getByText(`Delete "Doomed ${marker}"?`)).toBeVisible()
      await expect(dialog).toContainText(
        'Users linked to this company will be detached. This cannot be undone.'
      )
      await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByText('Company deleted')).toBeVisible()
      await expect(
        page.getByRole('heading', { name: `Doomed ${marker}`, exact: true })
      ).toHaveCount(0)

      expect(await companyRow(company.id)).toBeUndefined()
      const sql = supportDb()
      const rows = await sql`SELECT company_id FROM principal
        WHERE id IN ${sql(people.map((p) => p.principalUuid))}`
      expect(rows.map((r) => r.company_id)).toEqual([null, null])
      const audit = await pollFor('company.deleted audit row', async () => {
        const [r] = await sql`SELECT after_value FROM audit_log
          WHERE event_type = 'company.deleted' AND target_id = ${company.id}`
        return r ?? null
      })
      expect(audit.after_value).toEqual({ companyId: company.id })
    }
  )

  test(
    'PPL-C-12 PPL-C-14 adding a person to a company from its profile, then removing them',
    { tag: '@core' },
    async ({ asPerson, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const company = await newCompany(admin, `Roster ${marker}`)
      await admin.dispose()
      const person = await portalUserRow(marker, { name: `Member ${marker}` })

      const page = await asPerson('admin')
      await openCompany(page, marker, company)
      await expect(page.getByText('No users linked yet')).toBeVisible()
      await page.getByRole('button', { name: 'Add user' }).click()
      const search = page.getByPlaceholder('Search users…')
      await search.fill(`nobody-${marker}`)
      await expect(page.getByText('No users found')).toBeVisible()
      await search.fill(`Member ${marker}`)
      await page.getByRole('button', { name: new RegExp(`Member ${marker}`) }).click()
      await expect(page.getByText(person.email)).toBeVisible()
      await pollFor('company link', async () => {
        const [r] = await supportDb()`SELECT company_id FROM principal
          WHERE id = ${person.principalUuid}`
        return r?.company_id === uuid(company.id) ? true : null
      })

      await page.getByTitle('Remove from company').click()
      await expect(page.getByText('No users linked yet')).toBeVisible()
      const [row] = await supportDb()`SELECT company_id FROM principal
        WHERE id = ${person.principalUuid}`
      expect(row.company_id).toBeNull()
    }
  )

  test(
    "PPL-C-15 set, create and clear a person's company from their profile",
    { tag: '@core' },
    async ({ asPerson, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const existing = await newCompany(admin, `Existing ${marker}`, {
        plan: 'Pro',
        mrrCents: 10000,
      })
      await admin.dispose()
      const person = await portalUserRow(marker)
      const companyOf = async () => {
        const [r] = await supportDb()`SELECT company_id FROM principal
          WHERE id = ${person.principalUuid}`
        return r.company_id as string | null
      }

      const page = await asPerson('admin')
      await page.goto(usersUrl({ search: marker, selected: person.principalId }))
      await expect(page.getByText('No company')).toBeVisible({ timeout: 15_000 })
      await page.getByRole('button', { name: '+ Add' }).click()
      await page.getByPlaceholder('Search or create…').fill(`Existing ${marker}`)
      await page.getByRole('button', { name: `Existing ${marker}`, exact: true }).click()
      await expect(page.getByText('Pro · $100/mo')).toBeVisible()
      await expect(page.getByRole('link', { name: 'View company →' })).toHaveAttribute(
        'href',
        new RegExp(`company=${existing.id}`)
      )
      await expect.poll(companyOf).toBe(uuid(existing.id))

      const trigger = (name: string) =>
        page.locator('[data-slot="popover-trigger"]', { hasText: name })
      await trigger(`Existing ${marker}`).click()
      await page.getByPlaceholder('Search or create…').fill(`Fresh ${marker}`)
      await page.getByRole('button', { name: `Create “Fresh ${marker}”` }).click()
      await expect(page.getByText('Pro · $100/mo')).toHaveCount(0)
      const [fresh] = await supportDb()`SELECT id FROM companies WHERE name = ${`Fresh ${marker}`}`
      await expect.poll(companyOf).toBe(fresh.id)

      await trigger(`Fresh ${marker}`).click()
      await page.getByRole('button', { name: 'Remove from company' }).click()
      await expect(page.getByText('No company')).toBeVisible()
      await expect.poll(companyOf).toBeNull()
    }
  )
})

test.describe('company attributes settings', () => {
  test(
    'PPL-C-29 PPL-C-30 the settings page lists built-ins, then a new attribute with a normalised key',
    { tag: '@core' },
    async ({ asPerson, marker }) => {
      const key = `contract_value_${hex()}`
      const page = await asPerson('admin')
      await page.goto('/admin/settings/companies')
      for (const builtIn of ['Name', 'Email domain', 'Plan', 'Monthly spend', 'Size', 'Website']) {
        await expect(page.getByText(builtIn, { exact: true }).first(), builtIn).toBeVisible({
          timeout: 15_000,
        })
      }
      await page.getByRole('button', { name: 'New attribute' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByText('New company attribute')).toBeVisible()
      const create = dialog.getByRole('button', { name: 'Create attribute' })
      await expect(create).toBeDisabled()
      await dialog
        .getByLabel(/^Key/)
        .fill(key.replace(/_/g, ' ').replace('contract value', 'Contract Value'))
      await dialog.getByLabel('Display label').fill(`Contract ${marker}`)
      await dialog.getByRole('combobox').first().click()
      await page.getByRole('option', { name: 'Currency' }).click()
      await create.click()
      await expect(dialog).toHaveCount(0)

      const [row] =
        await supportDb()`SELECT key, label, type, currency_code, description, external_key
        FROM company_attribute_definitions WHERE key = ${key}`
      expect(row).toMatchObject({
        label: `Contract ${marker}`,
        type: 'currency',
        currency_code: 'USD',
        description: null,
        external_key: null,
      })
      await page.reload()
      await expect(page.getByText(`Contract ${marker}`, { exact: true })).toBeVisible({
        timeout: 15_000,
      })
    }
  )

  test(
    'PPL-C-31 a duplicate company attribute key is refused and the dialog says so',
    {
      tag: '@core',
    },
    async ({ asPerson, playwright, marker }) => {
      const key = `dup_${hex()}`
      const admin = await personApi(playwright, 'admin')
      await mustCall(admin, 'createCompanyAttributeFn', { key, label: 'First', type: 'string' })
      const refused = await call(admin, 'createCompanyAttributeFn', {
        key,
        label: 'Second',
        type: 'string',
      })
      expect(refused.code).toBe('DUPLICATE_KEY')
      await admin.dispose()

      const page = await asPerson('admin')
      await page.goto('/admin/settings/companies')
      await page.getByRole('button', { name: 'New attribute' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel(/^Key/).fill(key)
      await dialog.getByLabel('Display label').fill(`Again ${marker}`)
      await dialog.getByRole('button', { name: 'Create attribute' }).click()
      await expect(page.getByText('An attribute with that key already exists')).toBeVisible()
    }
  )
})

test.describe('companies over REST', () => {
  test(
    'PPL-C-23 PPL-C-25 list companies with a cursor and get one',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const made = [
        await newCompany(admin, `C ${marker}`),
        await newCompany(admin, `A ${marker}`, { plan: 'Scale', mrrCents: 100 }),
        await newCompany(admin, `B ${marker}`),
      ]
      const p = await portalUserRow(marker)
      await mustCall(admin, 'attachPrincipalToCompanyFn', {
        companyId: made[1].id,
        principalId: p.principalId,
      })
      await admin.dispose()

      const rest = await restAdmin(playwright)
      const first = await expectJson(
        await rest.get(`/api/v1/companies?search=${encodeURIComponent(marker)}&limit=2`),
        200
      )
      expect(first.data.map((c: { name: string }) => c.name)).toEqual([
        `A ${marker}`,
        `B ${marker}`,
      ])
      expect(first.meta.pagination.hasMore).toBe(true)
      const second = await expectJson(
        await rest.get(
          `/api/v1/companies?search=${encodeURIComponent(marker)}&limit=2&cursor=${first.meta.pagination.cursor}`
        ),
        200
      )
      expect(second.data.map((c: { name: string }) => c.name)).toEqual([`C ${marker}`])
      expect(second.meta.pagination.hasMore).toBe(false)
      expect(first.data[0]).toMatchObject({
        id: made[1].id,
        plan: 'Scale',
        mrrCents: 100,
        memberCount: 1,
        customAttributes: {},
      })

      const one = await expectJson(await rest.get(`/api/v1/companies/${made[1].id}`), 200)
      expect(one.data).toMatchObject({ id: made[1].id, name: `A ${marker}`, memberCount: 1 })
      const bad = await expectJson(await rest.get('/api/v1/companies/nope'), 400)
      expect(bad.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Invalid company ID format',
      })
      const unknownId = generateId('company')
      const missing = await expectJson(await rest.get(`/api/v1/companies/${unknownId}`), 404)
      expect(missing.error).toMatchObject({
        code: 'NOT_FOUND',
        message: `Company with ID ${unknownId} not found`,
      })
      await rest.dispose()
    }
  )

  test(
    'PPL-C-26 REST refuses a key without company.view, and no key at all',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const roleKey = await createRole(marker, ['people.view'])
      const mate = await newTeammate({ roleKey })
      const { key } = createKey({ creatorEmail: mate.email })
      const rest = await apiFor(playwright, supportEnv().baseUrl, key)
      for (const path of ['/api/v1/companies', `/api/v1/companies/${generateId('company')}`]) {
        const res = await expectJson(await rest.get(path), 403)
        expect(res.error).toEqual(
          expect.objectContaining({
            code: 'FORBIDDEN',
            message: "Requires the 'company.view' permission",
          })
        )
      }
      await rest.dispose()
      const anon = await apiFor(playwright, supportEnv().baseUrl, null)
      const res = await anon.get('/api/v1/companies')
      expect(res.status()).toBe(401)
      expect(res.headers()['www-authenticate']).toBe('Bearer realm="Quackback API"')
      await anon.dispose()
    }
  )
})

test.describe('company permissions', () => {
  test(
    'PPL-C-36 every company write is refused without company.manage; reads still work',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const admin = await personApi(playwright, 'admin')
      const company = await newCompany(admin, `Guarded ${marker}`)
      const attrKey = `guard_${hex()}`
      const attr = await mustCall<{ id: string }>(admin, 'createCompanyAttributeFn', {
        key: attrKey,
        label: 'Guard',
        type: 'string',
      })
      await admin.dispose()
      const person = await portalUserRow(marker)
      const mate = await newTeammate({ roleKey: 'contributor' })
      const api = await mate.api(playwright)

      for (const [name, data] of [
        ['createCompanyFn', { name: `Nope ${marker}` }],
        ['updateCompanyFn', { id: company.id, name: `Renamed ${marker}` }],
        ['deleteCompanyFn', { id: company.id }],
        ['attachPrincipalToCompanyFn', { companyId: company.id, principalId: person.principalId }],
        ['detachPrincipalFromCompanyFn', { principalId: person.principalId }],
        ['createCompanyAttributeFn', { key: `x_${hex()}`, label: 'X', type: 'string' }],
        ['updateCompanyAttributeFn', { id: attr.id, label: 'Changed' }],
        ['deleteCompanyAttributeFn', { id: attr.id }],
      ] as const) {
        const res = await call(api, name, data)
        expect(res.ok, `${name} must be refused`).toBe(false)
      }
      expect((await companyRow(company.id)).name).toBe(`Guarded ${marker}`)
      const [p] =
        await supportDb()`SELECT company_id FROM principal WHERE id = ${person.principalUuid}`
      expect(p.company_id).toBeNull()
      expect(
        await supportDb()`SELECT id FROM companies WHERE name = ${`Nope ${marker}`}`
      ).toHaveLength(0)
      const [def] = await supportDb()`SELECT label FROM company_attribute_definitions
        WHERE key = ${attrKey}`
      expect(def.label).toBe('Guard')

      for (const [name, data] of [
        ['listCompaniesPageFn', { search: marker }],
        ['getCompanyFn', { id: company.id }],
        ['listCompanyAttributesFn', undefined],
      ] as const) {
        const res = await call(api, name, data)
        expect(res.ok, `${name}: ${res.raw.slice(0, 200)}`).toBe(true)
      }
      await api.dispose()
    }
  )

  test(
    'PPL-C-37 company reads are refused without company.view',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const admin = await personApi(playwright, 'admin')
      const company = await newCompany(admin, `Hidden ${marker}`)
      await admin.dispose()
      const person = await portalUserRow(marker)
      const roleKey = await createRole(marker, ['people.view'])
      const mate = await newTeammate({ roleKey })
      const api = await mate.api(playwright)
      for (const [name, data] of [
        ['listCompaniesPageFn', { search: marker }],
        ['countCompaniesFn', undefined],
        ['getCompanyFn', { id: company.id }],
        ['getCompanyForPrincipalFn', { principalId: person.principalId }],
        ['listCompanyMembersFn', { companyId: company.id }],
        ['listCompanyAttributesFn', undefined],
      ] as const) {
        const res = await call(api, name, data)
        expect(res.ok, `${name} must be refused`).toBe(false)
        expect(res.raw, name).not.toContain(`Hidden ${marker}`)
      }
      await api.dispose()
    }
  )
})
