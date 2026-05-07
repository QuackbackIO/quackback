/**
 * Boot lifecycle hub. Runs once per pod start, after the DB pool +
 * import-cache warmup but before the request handler accepts traffic.
 * Each handler is fire-and-forget at the orchestrator level — a
 * single bad handler must not block boot — so each handler is
 * responsible for its own try/catch internally.
 *
 * Registered handlers:
 *   - upsertInternalApiKey (Stage 1C): ensures the api_keys row
 *     matching the projected INTERNAL_API_KEY env var exists.
 *   - pullBootConfig (Stage 3A): GETs the configured provider URL,
 *     applies versioned sections (tierLimits today; bootstrap in 3B).
 *
 * Order matters: upsertInternalApiKey runs first because the bearer
 * pull token used by pullBootConfig is unrelated to api_keys, but a
 * future handler (Stage 3B's bootstrap-callback) will rely on the
 * api_keys row existing.
 */

import { upsertInternalApiKey } from './internal-api-key-upsert'
import { pullBootConfig } from './pull-boot-config'

export async function runBootHandlers(): Promise<void> {
  await Promise.allSettled([upsertInternalApiKey(), pullBootConfig()])
}
