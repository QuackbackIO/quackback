/**
 * Workspace seed — idempotent one-shot that runs at pod startup when
 * the WORKSPACE_NAME env var is set. Lets a deploy automation
 * (controller, helm chart, plain `docker run -e ...`) bake the
 * initial workspace name/slug/useCase/tier-limits straight into the
 * deploy spec instead of having to POST to /admin/setup after the
 * pod is up.
 *
 * Behaviour mirrors the (now-deleted) /api/v1/admin/setup endpoint:
 *   - First-pass: insert settings row with the env-supplied name +
 *     slug + useCase + setupState.steps.workspace=true + tierLimits.
 *   - Existing row: only overwrite fields the user hasn't already
 *     customised (steps.workspace=false → name/slug/useCase still
 *     env-controlled; steps.workspace=true → leave them alone).
 *     Tier limits always overwrite, since plan changes flow through
 *     env redeploys (or the runtime /admin/tier-limits push API).
 *   - WORKSPACE_NAME unset: no-op. Self-hosted operators that walk
 *     the in-app onboarding wizard get the same result as today.
 */
import postgres from 'postgres'
import { generateId } from '@quackback/ids'

interface TierLimits {
  [key: string]: unknown
}

const USE_CASES = ['saas', 'consumer', 'marketplace', 'internal'] as const
type UseCase = (typeof USE_CASES)[number]

interface SetupStateSteps {
  core?: boolean
  workspace?: boolean
  boards?: boolean
}
interface SetupState {
  version: number
  steps: SetupStateSteps
  completedAt?: string
  useCase?: UseCase
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'workspace'
  )
}

function parseTierLimits(raw: string | undefined): TierLimits | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TierLimits
    }
    console.warn('[seed-workspace] WORKSPACE_TIER_LIMITS_JSON is not an object; ignoring')
    return undefined
  } catch (err) {
    console.warn(`[seed-workspace] WORKSPACE_TIER_LIMITS_JSON parse failed: ${String(err)}`)
    return undefined
  }
}

function mergeState(existing: SetupState | null, useCase: UseCase | undefined): SetupState {
  return {
    version: 1,
    steps: {
      core: true,
      workspace: true,
      boards: existing?.steps?.boards ?? false,
    },
    completedAt: existing?.completedAt,
    useCase: useCase ?? existing?.useCase,
  }
}

async function main(): Promise<void> {
  const name = process.env.WORKSPACE_NAME
  if (!name) {
    console.log('[seed-workspace] WORKSPACE_NAME unset — skipping')
    return
  }
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.warn('[seed-workspace] DATABASE_URL unset — skipping')
    return
  }
  const slug = process.env.WORKSPACE_SLUG?.trim() || slugify(name)
  const useCaseRaw = process.env.WORKSPACE_USE_CASE
  const useCase =
    useCaseRaw && (USE_CASES as readonly string[]).includes(useCaseRaw)
      ? (useCaseRaw as UseCase)
      : undefined
  const tierLimits = parseTierLimits(process.env.WORKSPACE_TIER_LIMITS_JSON)

  const sql = postgres(dbUrl, { max: 1 })
  try {
    const existing = await sql<{ id: string; setup_state: string | null }[]>`
      SELECT id, setup_state FROM settings LIMIT 1
    `
    if (existing.length > 0) {
      const row = existing[0]
      const parsed: SetupState | null = row.setup_state
        ? (() => {
            try {
              return JSON.parse(row.setup_state) as SetupState
            } catch {
              return null
            }
          })()
        : null
      const userCustomised = parsed?.steps?.workspace === true
      const updates: Record<string, unknown> = {}
      if (!userCustomised) {
        updates.name = name
        updates.slug = slug
        updates.setup_state = JSON.stringify(mergeState(parsed, useCase))
      }
      if (tierLimits !== undefined) {
        updates.tier_limits = JSON.stringify(tierLimits)
      }
      const keys = Object.keys(updates)
      if (keys.length === 0) {
        console.log('[seed-workspace] existing settings already customised — skipping')
        return
      }
      const setSql = sql.unsafe(
        `UPDATE settings SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`,
        [...keys.map((k) => updates[k]), row.id]
      )
      await setSql
      console.log(`[seed-workspace] updated settings: ${keys.join(', ')}`)
    } else {
      // settings.id is a TypeID-on-write UUID column; use the
      // canonical generator so postgres accepts the inserted UUID
      // form (a plain random string fails with 'invalid input
      // syntax for type uuid').
      const id = generateId('workspace')
      await sql`
        INSERT INTO settings (id, name, slug, created_at, setup_state, tier_limits)
        VALUES (
          ${id},
          ${name},
          ${slug},
          NOW(),
          ${JSON.stringify(mergeState(null, useCase))},
          ${tierLimits !== undefined ? JSON.stringify(tierLimits) : null}
        )
        ON CONFLICT (slug) DO NOTHING
      `
      console.log(`[seed-workspace] created settings name=${name} slug=${slug}`)
    }
  } catch (err) {
    console.error(`[seed-workspace] failed: ${err instanceof Error ? err.message : String(err)}`)
    // Don't exit non-zero — workspace seed is best-effort. The pod
    // can still come up; the user just goes through the wizard.
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error(`[seed-workspace] fatal: ${String(err)}`)
})
