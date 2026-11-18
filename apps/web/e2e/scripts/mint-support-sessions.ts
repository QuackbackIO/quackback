/**
 * CLI: mint a fresh signed-in session for every support suite person and write
 * one Playwright storageState file per person, plus people.json (the seeded
 * ids). No sign-in flow runs, so the magic-link rate limit never applies.
 *
 * The session row is what better-auth itself writes; the cookie value is
 * `token.HMAC-SHA256(token, SECRET_KEY)`, URL-encoded, the same signed-cookie
 * format refresh-admin-session.ts uses. Both cookie names are written: an http
 * BASE_URL uses `better-auth.session_token`, an https one the `__Secure-` name.
 *
 * Usage: bun mint-support-sessions.ts <out-dir> '<seed-support-people JSON>'
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { toUuid } from '@quackback/ids'
import type { SeededPeople } from '../support/people'
import { openDb } from './_lib'

const [outDir, peopleJson] = process.argv.slice(2)
const secret = process.env.SECRET_KEY
const baseUrl = process.env.BASE_URL
if (!outDir || !peopleJson || !secret || !baseUrl) {
  console.error(
    "Usage: bun mint-support-sessions.ts <out-dir> '<people JSON>' (needs SECRET_KEY, BASE_URL)"
  )
  process.exit(1)
}

const seeded = JSON.parse(peopleJson) as SeededPeople
const domain = new URL(baseUrl).hostname
const sessionDays = 7
const sql = openDb()

try {
  mkdirSync(outDir, { recursive: true })
  for (const person of Object.values(seeded.people)) {
    const token = randomBytes(24).toString('base64url')
    const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000)
    await sql`INSERT INTO session (id, expires_at, token, created_at, updated_at, user_agent, scope, user_id)
              VALUES (${randomUUID()}, ${expiresAt}, ${token}, NOW(), NOW(), 'support-e2e', 'dashboard',
                      ${toUuid(person.userId as `user_${string}`)})`
    const signature = createHmac('sha256', secret).update(token).digest('base64')
    const value = encodeURIComponent(`${token}.${signature}`)
    const cookie = {
      value,
      domain,
      path: '/',
      expires: Math.floor(expiresAt.getTime() / 1000),
      httpOnly: true,
      sameSite: 'Lax' as const,
    }
    const state = {
      cookies: [
        { ...cookie, name: 'better-auth.session_token', secure: false },
        { ...cookie, name: '__Secure-better-auth.session_token', secure: true },
      ],
      origins: [],
    }
    writeFileSync(resolve(outDir, `${person.name}.json`), JSON.stringify(state, null, 2))
  }
  writeFileSync(resolve(outDir, 'people.json'), JSON.stringify(seeded, null, 2))
  console.log(JSON.stringify({ minted: Object.keys(seeded.people) }))
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
