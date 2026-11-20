/**
 * Helpers for tests/admin/plan-limits.spec.ts. Each wraps one command of
 * e2e/scripts/plan-limits-state.ts, which writes the database the way the app
 * does and drops the caches the running server reads.
 */
import { execFileSync } from 'child_process'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { expect, type APIRequestContext, type Page } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** The custom CSS the spec sets; the portal serves it only while the feature is live. */
export const CSS_MARKER = '.e2e-plan-limits-css'

const DAY = 86_400_000

function run(...args: string[]): string {
  try {
    return execFileSync(
      'bun',
      ['--env-file=../../.env', resolve(__dirname, '../scripts/plan-limits-state.ts'), ...args],
      { encoding: 'utf-8', cwd: resolve(__dirname, '../..') }
    ).trim()
  } catch (error) {
    const err = error as { stderr?: string; message: string }
    throw new Error(`plan-limits-state ${args[0]} failed: ${err.stderr || err.message}`, {
      cause: error,
    })
  }
}

export interface Baseline {
  boards: number
  seats: number
}

export interface ThrowawayBoard {
  id: string
  slug: string
  name: string
}

export interface StoredState {
  state: { graceEndsAt: string; keptBoardId?: string } | null
  posts: number
  boards: Record<string, number>
}

export const planLimits = {
  /** Snapshot what the spec changes, then start with no plan billing. */
  begin: (teammate: string): Baseline => JSON.parse(run('begin', teammate)),
  /** A Business trial that lapsed to Free, with Free's caps at the given counts. */
  lapse: (caps: Baseline) => run('lapse', String(caps.boards), String(caps.seats)),
  upgrade: () => run('upgrade'),
  /** No plan billing, with the same caps stored as operator tier limits. */
  noPlanBilling: (caps: Baseline) =>
    run('no-plan-billing', String(caps.boards), String(caps.seats)),
  board: (name: string, withPost = false): ThrowawayBoard =>
    JSON.parse(run('board', name, ...(withPost ? ['with-post'] : []))),
  role: (email: string, role: 'member' | 'user') => run('role', email, role),
  css: (on: boolean) => run('css', on ? 'on' : 'off'),
  assistantOff: () => run('assistant-off'),
  /** Move the deadline into the past; returns the stored state written. */
  overdue: (teammate: string): StoredState['state'] => JSON.parse(run('overdue', teammate)),
  state: (): StoredState => JSON.parse(run('state')),
  /** Live boards with two or more posts. */
  busyBoards: (): number => JSON.parse(run('busy-boards')).boards,
  apiKey: (): string => JSON.parse(run('api-key')).key,
  end: () => run('end'),
}

/**
 * The last full day to fix as the banner names it: the UTC date before
 * `graceEndsAt`, as "Nov 23".
 */
export function deadlineText(graceEndsAt: string): string {
  return new Date(Date.parse(graceEndsAt) - DAY).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** The admin strip, by its tone. */
export function banner(page: Page) {
  return page.locator('[data-plan-limits-banner]')
}

/** Load an admin page and wait for the shell. */
export async function openAdmin(page: Page, path = '/admin/feedback'): Promise<void> {
  await page.goto(path)
  await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 15000 })
}

/** Whether the portal's server-rendered page carries the custom CSS. */
export async function portalServesCss(request: APIRequestContext): Promise<boolean> {
  const response = await request.get('/')
  expect(response.ok()).toBeTruthy()
  return (await response.text()).includes(CSS_MARKER)
}

/** Create a post through the REST API, as an integration would. */
export async function apiCreatePost(
  request: APIRequestContext,
  key: string,
  boardId: string
): Promise<{ status: number; body: string }> {
  const response = await request.post('/api/v1/posts', {
    headers: { Authorization: `Bearer ${key}` },
    data: { boardId, title: `Plan limits e2e ${Date.now()}`, content: 'From the REST API.' },
  })
  return { status: response.status(), body: await response.text() }
}
