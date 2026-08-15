#!/usr/bin/env bun
import { randomBytes, randomUUID } from 'node:crypto'
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
const UA = 'quackback-billing-authz/2026-08-15'
const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/this-fire/billing-authz.json'

async function mint(dsn, email, origin) {
  const ott = randomBytes(24).toString('base64url')
  const sessionToken = randomBytes(32).toString('base64url')
  const now = new Date()
  const tenant = postgres(dsn, { max: 1, connect_timeout: 20 })
  try {
    const [user] = await tenant`select id from "user" where lower(email) = ${email.toLowerCase()} limit 1`
    if (!user) throw new Error('owner missing')
    await tenant.begin(async (tx) => {
      await tx`INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at)
        VALUES (${randomUUID()}, ${sessionToken}, ${user.id}, ${new Date(now.getTime() + 7 * 864e5)}, ${now}, ${now})`
      await tx`INSERT INTO verification (id, identifier, value, expires_at)
        VALUES (${randomUUID()}, ${`one-time-token:${ott}`}, ${sessionToken}, ${new Date(now.getTime() + 10 * 60 * 1000)})`
    })
    const url = new URL('/auth/open-handoff', origin)
    url.searchParams.set('ott', ott)
    url.searchParams.set('returnTo', '/admin/settings/billing')
    const consume = await fetch(url.toString(), { redirect: 'manual', headers: { 'user-agent': UA } })
    const cookie = (consume.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
    return { cookie, hasSession: cookie.includes('session_token') }
  } finally {
    await tenant.end({ timeout: 5 })
  }
}

async function post(origin, cookie, originHeader, body) {
  const headers = { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }
  if (cookie) headers.cookie = cookie
  if (originHeader !== undefined) headers.origin = originHeader
  const res = await fetch(`${origin}/api/billing/session`, { method: 'POST', headers, redirect: 'manual', body })
  const json = await res.json().catch(() => null)
  return {
    status: res.status,
    error: typeof json?.error === 'string' ? json.error : null,
    locationHost: res.headers.get('location') ? new URL(res.headers.get('location')).hostname : null,
  }
}

const facts = { at: new Date().toISOString(), errors: [], didNotPay: true }
try {
  const cp = postgres(process.env.DATABASE_URL, { max: 2, idle_timeout: 5, connect_timeout: 20 })
  const { tenantDirectDsn } = await import(
    '/home/james/quackback-cp/src/lib/server/tenant-bootstrap-orchestrator.ts'
  )
  try {
    const before = await cp`select count(*)::int as n from cp_instances`
    facts.instanceCount = { before: before[0].n }
    const owners = await cp`select id, owner_email from cp_instances where id in (${T1A}, ${T1E})`
    const ownerA = owners.find((r) => r.id === T1A).owner_email
    const ownerE = owners.find((r) => r.id === T1E).owner_email
    const mintedA = await mint(await tenantDirectDsn(T1A), ownerA, ORIGIN_A)
    const mintedE = await mint(await tenantDirectDsn(T1E), ownerE, ORIGIN_E)
    const body = 'action=checkout&planId=growth&billingPeriod=monthly'
    facts.noCookie = await post(ORIGIN_E, '', ORIGIN_E, body)
    facts.t1aOnT1e = await post(ORIGIN_E, mintedA.cookie, ORIGIN_E, body)
    facts.t1eSameGrowth = await post(ORIGIN_E, mintedE.cookie, ORIGIN_E, body)
    facts.foreignOrigin = await post(ORIGIN_E, mintedE.cookie, 'https://attacker.test', body)
    const after = await cp`select count(*)::int as n from cp_instances`
    facts.instanceCount.after = after[0].n
    const named = (r) => r.status !== 500 && typeof r.error === 'string' && r.error.length > 0
    facts.ok =
      facts.noCookie.status === 401 &&
      facts.noCookie.error === 'unauthorized' &&
      [401, 403].includes(facts.t1aOnT1e.status) &&
      named(facts.t1aOnT1e) &&
      facts.t1eSameGrowth.status === 409 &&
      facts.t1eSameGrowth.error === 'already_on_plan' &&
      facts.foreignOrigin.status === 403 &&
      facts.foreignOrigin.error === 'invalid_origin' &&
      facts.instanceCount.after === facts.instanceCount.before
  } finally {
    await cp.end({ timeout: 5 })
  }
} catch (err) {
  facts.errors.push(err instanceof Error ? err.message : String(err))
  facts.ok = false
}
writeFileSync(OUT, JSON.stringify(facts, null, 2))
console.log(JSON.stringify(facts, null, 2))
if (!facts.ok) process.exitCode = 1
