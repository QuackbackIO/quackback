#!/usr/bin/env bun
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import postgres from '/home/james/quackback-cp/node_modules/postgres/src/index.js'


const envFile = process.env.PROBE_ENV_FILE
if (envFile) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1)
  }
}

const T1A = 'inst_01m00kq6cdfzzb19gfjz8pt0s7'
const T1E = 'inst_01m00kprbrfzzb19f490wga8q2'
const ORIGIN_A = 'https://south63792f.quackback.co.uk'
const ORIGIN_E = 'https://northfa99f0.quackback.co.uk'
const UA = 'quackback-verify-domains/2026-08-15'
const { tenantDirectDsn } = await import(
  '/home/james/quackback-cp/src/lib/server/tenant-bootstrap-orchestrator.ts'
)
const cp = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 20 })

async function mint(id, origin) {
  const [row] = await cp`select owner_email from cp_instances where id = ${id}`
  const dsn = await tenantDirectDsn(id)
  const tenant = postgres(dsn, { max: 1, connect_timeout: 20 })
  try {
    const ott = randomBytes(24).toString('base64url')
    const sessionToken = randomBytes(32).toString('base64url')
    const now = new Date()
    const [user] = await tenant`select id from "user" where lower(email) = ${row.owner_email.toLowerCase()} limit 1`
    await tenant.begin(async (tx) => {
      await tx`INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at)
        VALUES (${randomUUID()}, ${sessionToken}, ${user.id}, ${new Date(now.getTime() + 7 * 864e5)}, ${now}, ${now})`
      await tx`INSERT INTO verification (id, identifier, value, expires_at)
        VALUES (${randomUUID()}, ${`one-time-token:${ott}`}, ${sessionToken}, ${new Date(now.getTime() + 10 * 60 * 1000)})`
    })
    const url = new URL('/auth/open-handoff', origin)
    url.searchParams.set('ott', ott)
    url.searchParams.set('returnTo', '/admin/settings/domains')
    const consume = await fetch(url.toString(), { redirect: 'manual', headers: { 'user-agent': UA } })
    const cookie = (consume.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
    return { consumeStatus: consume.status, cookie, hasSession: cookie.includes('session_token') }
  } finally {
    await tenant.end({ timeout: 5 })
  }
}

function summarize(text) {
  return {
    hasCustomDomain: /custom domain/i.test(text),
    hasAddDomain: /add domain/i.test(text),
    hasDomainsHeading: />Domains<|>Domains</.test(text) || /Your own hostname/i.test(text),
    hasGrowthLock: /upgrade to growth/i.test(text),
    hasLocalWriter: /TLS terminates at your own reverse proxy/i.test(text),
  }
}

const facts = { at: new Date().toISOString(), didNotAddDomain: true, errors: [] }
try {
  const a = await mint(T1A, ORIGIN_A)
  const e = await mint(T1E, ORIGIN_E)
  for (const [label, origin, cookie] of [
    ['t1a', ORIGIN_A, a.cookie],
    ['t1e', ORIGIN_E, e.cookie],
  ]) {
    const res = await fetch(`${origin}/admin/settings/domains`, {
      headers: { cookie, 'user-agent': UA },
      redirect: 'manual',
    })
    const text = await res.text()
    facts[label] = { status: res.status, consume: label === 't1a' ? a.consumeStatus : e.consumeStatus, ...summarize(text) }
  }
} catch (err) {
  facts.errors.push(err instanceof Error ? err.message : String(err))
} finally {
  await cp.end({ timeout: 5 })
}
writeFileSync('/home/james/quackback-wt/saas-merge/loop-evidence/verify-2026-08-15/domains-40be439d.json', JSON.stringify(facts, null, 2))
console.log(JSON.stringify(facts))
