/**
 * Helpers for the platform journeys (INT-*): onboarding and the launch plan,
 * plan limits, settings, admin search and analytics. Integrations have their
 * own file (integrations.ts).
 */
import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test'
import { supportDb } from '../support/db'
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

/** The settings row's setup_state, parsed. */
export async function readSetupState(): Promise<Record<string, unknown>> {
  const [row] = await supportDb()<{ setup_state: string | null }[]>`
    SELECT setup_state FROM settings LIMIT 1`
  return row?.setup_state ? (JSON.parse(row.setup_state) as Record<string, unknown>) : {}
}
