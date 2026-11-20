/**
 * Helpers for the platform journeys (INT-*): onboarding and the launch plan,
 * plan limits, settings, admin search and analytics. Integrations have their
 * own file (integrations.ts).
 */
import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { ISOLATED } from '../support/automation'
import { supportDb } from '../support/db'
import { bustSettingsCache } from '../support/isolated-settings'
import { personApi } from '../support/server-fns'
import type { SupportPersonName } from '../support/people'

/** Run `body` with a request context signed in as `person`, then dispose it. */
export async function asPersonApi<T>(
  playwright: PlaywrightWorkerArgs['playwright'],
  person: SupportPersonName,
  body: (api: APIRequestContext) => Promise<T>
): Promise<T> {
  const api = await personApi(playwright, person)
  try {
    return await body(api)
  } finally {
    await api.dispose()
  }
}

/**
 * Run one sweep through the runner (/api/e2e/sweep) by name, for the platform
 * entries the support helper's SweepName does not list.
 */
export async function runPlatformSweep(
  request: APIRequestContext,
  job: 'onboarding-email' | 'analytics-refresh',
  opts: { asOf?: Date } = {}
): Promise<Record<string, unknown>> {
  const res = await request.post('/api/e2e/sweep', {
    data: { job, ...(opts.asOf ? { asOf: opts.asOf.toISOString() } : {}) },
  })
  if (res.status() !== 200) throw new Error(`sweep ${job}: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as { result: Record<string, unknown> }).result
}

/** The settings row's setup_state, parsed. */
export async function readSetupState(): Promise<Record<string, unknown>> {
  const [row] = await supportDb()<{ setup_state: string | null }[]>`
    SELECT setup_state FROM settings LIMIT 1`
  return row?.setup_state ? (JSON.parse(row.setup_state) as Record<string, unknown>) : {}
}

/**
 * Rewrite the workspace setup state for `body` and always put the stored text
 * back. Setup state is workspace-wide (launch plan, first win, setup emails),
 * so this runs only in the isolated job.
 */
export async function withSetupState<T>(
  change: (state: Record<string, unknown>) => Record<string, unknown>,
  body: () => Promise<T>
): Promise<T> {
  if (!ISOLATED) throw new Error('withSetupState outside the isolated job')
  const sql = supportDb()
  const [row] = await sql<{ setup_state: string | null }[]>`
    SELECT setup_state FROM settings LIMIT 1`
  const original = row?.setup_state ?? null
  const next = change(original ? (JSON.parse(original) as Record<string, unknown>) : {})
  await sql`UPDATE settings SET setup_state = ${JSON.stringify(next)}`
  await bustSettingsCache()
  try {
    return await body()
  } finally {
    await sql`UPDATE settings SET setup_state = ${original}`
    await bustSettingsCache()
  }
}

/** A board only this test uses, written as the app stores one. */
export async function createBoard(
  marker: string,
  opts: { view?: 'anonymous' | 'team' } = {}
): Promise<{ id: string; uuid: string; slug: string; name: string }> {
  const uuid = toUuid(generateId('board'))
  const slug = `${marker}`.toLowerCase().slice(0, 60)
  const name = `Board ${marker}`
  const view = opts.view ?? 'anonymous'
  const sql = supportDb()
  await sql`INSERT INTO boards (id, slug, name) VALUES (${uuid}, ${slug}, ${name})`
  await sql`UPDATE boards SET access = jsonb_set(access, '{view}', to_jsonb(${view}::text))
            WHERE id = ${uuid}`
  return { id: fromUuid('board', uuid), uuid, slug, name }
}
