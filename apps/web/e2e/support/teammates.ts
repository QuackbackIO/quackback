/**
 * Teammates (and teams) a single test owns. The six seeded people are shared by
 * every worker, so a test that removes someone, changes their role or teams,
 * sets them Away, reads or clears their bells, or changes their notification
 * preferences makes its own teammate here instead.
 *
 *   const t = await createTeammate({ marker, roleKey: 'e2e_scoped_agent', teams: [team.id] })
 *   const page = await t.newPage(browser)        // signed in as them
 *   const api = await t.api(playwright)          // for callServerFn
 *   openStream({ cookie: t.cookie, query: { scope: 'inbox' } })
 *
 * Rows are written the way seed-support-people.ts writes the shared people:
 * a user, a principal with the legacy role, one workspace-wide role assignment
 * and team_members rows; the session is minted like mint-support-sessions.ts.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { APIRequestContext, Browser, Page, PlaywrightWorkerArgs } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { supportDb } from './db'
import { supportEnv } from './env'

export interface TestTeammate {
  email: string
  name: string
  userId: string
  /** TypeID, principal_... */
  principalId: string
  /** Playwright storageState signed in as this teammate. */
  storageState: { cookies: StoredCookie[]; origins: [] }
  /** Cookie header for raw requests (openStream({ cookie })). */
  cookie: string
  /** A new browser context signed in as them; returns its page. */
  newPage: (browser: Browser) => Promise<Page>
  /** A request context signed in as them (dispose when done). */
  api: (playwright: PlaywrightWorkerArgs['playwright']) => Promise<APIRequestContext>
}

interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Lax'
}

export interface CreateTeammateOptions {
  /** Unique text for the name and email (the `marker` fixture). */
  marker: string
  /** Workspace-wide role key: admin, support_lead, contributor, e2e_scoped_agent, ... */
  roleKey: string
  /** Team TypeIDs (team_...). */
  teams?: string[]
  /** principal.role; 'admin' for the admin role, 'member' otherwise. */
  principalRole?: 'admin' | 'member'
  /** Display name; defaults to one built from the marker. */
  name?: string
  availability?: 'online' | 'away'
}

const contexts = new Set<{ close: () => Promise<void> }>()

export async function createTeammate(opts: CreateTeammateOptions): Promise<TestTeammate> {
  const sql = supportDb()
  const suffix = randomBytes(3).toString('hex')
  const email = `${opts.marker}-${suffix}@teammates.example`
  const name = opts.name ?? `Teammate ${suffix}`
  const principalRole = opts.principalRole ?? (opts.roleKey === 'admin' ? 'admin' : 'member')

  const userUuid = toUuid(generateId('user'))
  const principalUuid = toUuid(generateId('principal'))
  const [role] = await sql`SELECT id FROM roles WHERE key = ${opts.roleKey} LIMIT 1`
  if (!role) throw new Error(`Role not found: ${opts.roleKey}`)

  await sql.begin(async (tx) => {
    await tx`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
             VALUES (${userUuid}, ${name}, ${email}, true, NOW(), NOW())`
    await tx`INSERT INTO principal (id, user_id, role, type, display_name, chat_availability, created_at)
             VALUES (${principalUuid}, ${userUuid}, ${principalRole}, 'user', ${name},
                     ${opts.availability ?? 'online'}, NOW())`
    await tx`INSERT INTO principal_role_assignments (id, principal_id, role_id, created_at)
             VALUES (${toUuid(generateId('role_asgn'))}, ${principalUuid}, ${role.id as string}, NOW())`
    for (const team of opts.teams ?? []) {
      await tx`INSERT INTO team_members (id, team_id, principal_id)
               VALUES (${toUuid(generateId('team_member'))}, ${toUuid(team as `team_${string}`)},
                       ${principalUuid})`
    }
  })

  const storageState = await mintSession(fromUuid('user', userUuid))
  const secure = supportEnv().baseUrl.startsWith('https://')
  const cookie = storageState.cookies
    .filter((c) => c.secure === secure)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')

  return {
    email,
    name,
    userId: fromUuid('user', userUuid),
    principalId: fromUuid('principal', principalUuid),
    storageState,
    cookie,
    newPage: async (browser) => {
      const context = await browser.newContext({ storageState })
      contexts.add(context)
      return context.newPage()
    },
    api: (playwright) =>
      playwright.request.newContext({ baseURL: supportEnv().baseUrl, storageState }),
  }
}

/** Mint a signed-in session for a user (TypeID) and return its storageState. */
export async function mintSession(
  userId: string
): Promise<{ cookies: StoredCookie[]; origins: [] }> {
  const env = supportEnv()
  const secret = env.app.SECRET_KEY
  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await supportDb()`
    INSERT INTO session (id, expires_at, token, created_at, updated_at, user_agent, scope, user_id)
    VALUES (${randomUUID()}, ${expiresAt}, ${token}, NOW(), NOW(), 'support-e2e', 'dashboard',
            ${toUuid(userId as `user_${string}`)})`
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  const cookie = {
    value: encodeURIComponent(`${token}.${signature}`),
    domain: new URL(env.baseUrl).hostname,
    path: '/',
    expires: Math.floor(expiresAt.getTime() / 1000),
    httpOnly: true,
    sameSite: 'Lax' as const,
  }
  return {
    cookies: [
      { ...cookie, name: 'better-auth.session_token', secure: false },
      { ...cookie, name: '__Secure-better-auth.session_token', secure: true },
    ],
    origins: [],
  }
}

/** A team only this test uses. Returns its TypeID. */
export async function createTeam(
  marker: string,
  name?: string
): Promise<{ id: string; name: string }> {
  const teamName = name ?? `Team ${marker}`.slice(0, 60)
  const id = toUuid(generateId('team'))
  await supportDb()`INSERT INTO teams (id, name, description)
                    VALUES (${id}, ${teamName}, ${'Support e2e test team'})`
  return { id: fromUuid('team', id), name: teamName }
}

/** Close every browser context opened through TestTeammate.newPage. */
export async function closeTeammateContexts(): Promise<void> {
  const open = [...contexts]
  contexts.clear()
  await Promise.all(open.map((c) => c.close().catch(() => {})))
}
