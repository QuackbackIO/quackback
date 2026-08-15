#!/usr/bin/env bun
/**
 * Workspace already_on_plan 409 + Upgrade 303 on the live pair.
 * Does not pay, create, wipe, or print secrets.
 */
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

const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/this-fire/ws-already-on-plan.json'
const T1A = 'inst_01m00kq6cdfzzb19gfjz8pt0s7'
const T1E = 'inst_01m00kprbrfzzb19f490wga8q2'
const ORIGIN_A = 'https://south63792f.quackback.co.uk'
const ORIGIN_E = 'https://northfa99f0.quackback.co.uk'
const UA = 'quackback-ws-already-on-plan/2026-08-15'

function must(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is unset`)
  return v
}
function hostOf(url) {
  if (!url) return null
  try {
    return new URL(url, 'https://placeholder.invalid').hostname
  } catch {
    return null
  }
}
function pathOf(url) {
  if (!url) return null
  try {
    return new URL(url, 'https://placeholder.invalid').pathname
  } catch {
    return String(url).slice(0, 80)
  }
}
function redactPath(path) {
  if (!path) return null
  return path
    .replace(/cs_test_[A-Za-z0-9]+/g, 'cs_test_…')
    .replace(/cs_live_[A-Za-z0-9]+/g, 'cs_live_…')
    .slice(0, 48)
}
function cookieHeader(setCookie) {
  return setCookie
    .map((raw) => raw.split(';')[0])
    .filter(Boolean)
    .join('; ')
}
function cookieNames(setCookie) {
  return setCookie.map((raw) => raw.split('=')[0]).filter(Boolean)
}

async function http(url, init = {}) {
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    ...init,
    headers: { 'user-agent': UA, ...(init.headers || {}) },
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return {
    status: res.status,
    location: res.headers.get('location'),
    locationHost: hostOf(res.headers.get('location')),
    locationPath: redactPath(pathOf(res.headers.get('location'))),
    error: typeof json?.error === 'string' ? json.error : null,
    setCookie: res.headers.getSetCookie?.() ?? [],
    json,
  }
}

async function mint(dsn, email, origin, returnTo) {
  const ott = randomBytes(24).toString('base64url')
  const sessionToken = randomBytes(32).toString('base64url')
  const now = new Date()
  const tenant = postgres(dsn, { max: 1, connect_timeout: 20 })
  try {
    const [user] = await tenant`select id from "user" where lower(email) = ${email.toLowerCase()} limit 1`
    if (!user) throw new Error(`owner row missing on ${origin}`)
    await tenant.begin(async (tx) => {
      await tx`
        INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at)
        VALUES (${randomUUID()}, ${sessionToken}, ${user.id}, ${new Date(now.getTime() + 7 * 864e5)}, ${now}, ${now})
      `
      await tx`
        INSERT INTO verification (id, identifier, value, expires_at)
        VALUES (${randomUUID()}, ${`one-time-token:${ott}`}, ${sessionToken}, ${new Date(now.getTime() + 10 * 60 * 1000)})
      `
    })
    const url = new URL('/auth/open-handoff', origin)
    url.searchParams.set('ott', ott)
    url.searchParams.set('returnTo', returnTo)
    const consume = await fetch(url.toString(), { redirect: 'manual', headers: { 'user-agent': UA } })
    const setCookie = consume.headers.getSetCookie?.() ?? []
    return {
      consumeStatus: consume.status,
      cookie: cookieHeader(setCookie),
      cookieNames: cookieNames(setCookie),
      hasSession: cookieNames(setCookie).some((n) => n.includes('session_token')),
    }
  } finally {
    await tenant.end({ timeout: 5 })
  }
}

async function postBilling(origin, cookie, originHeader, body) {
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    cookie,
  }
  if (originHeader !== undefined) headers.origin = originHeader
  const res = await http(`${origin}/api/billing/session`, { method: 'POST', headers, body })
  return {
    status: res.status,
    error: res.error,
    locationHost: res.locationHost,
    locationPath: res.locationPath,
    hasCsTest: (res.location || '').includes('cs_test_'),
    hasCsLive: (res.location || '').includes('cs_live_'),
    sentOrigin: originHeader ?? null,
  }
}

const facts = {
  at: new Date().toISOString(),
  unit: 'ws-already-on-plan-be3e41b01',
  liveImage: 'sha256:40be439d1c2d55957265723bef94b9eda49523d3fee8954de7c2385b595a76f2',
  didNotPay: true,
  didNotCreateNeon: true,
  didNotStartCustomDomains: true,
  didNotCreateWorkspace: true,
  printedCredentials: false,
  errors: [],
}

try {
  must('DATABASE_URL')
  const stripeKey = process.env.STRIPE_SECRET_KEY || ''
  facts.stripeKeyPrefix = stripeKey ? stripeKey.slice(0, 8) : null
  if (stripeKey && !stripeKey.startsWith('sk_test_')) throw new Error('refusing non-test stripe key')

  const health = {}
  for (const url of [
    'https://gauntlet.quackback.co.uk/api/health/ready',
    `${ORIGIN_A}/api/health/ready`,
    `${ORIGIN_E}/api/health/ready`,
  ]) {
    const res = await http(url)
    health[url] = { status: res.status, role: res.json?.role ?? null }
  }
  facts.health = health

  const cp = postgres(process.env.DATABASE_URL, { max: 2, idle_timeout: 5, connect_timeout: 20 })
  const { tenantDirectDsn } = await import(
    '/home/james/quackback-cp/src/lib/server/tenant-bootstrap-orchestrator.ts'
  )
  try {
    const before = await cp`select id, plan_id, owner_email from cp_instances order by id`
    facts.instanceCount = { before: before.length }

    const [t1a] = await cp`select plan_id, status from cp_instances where id = ${T1A}`
    const [t1e] = await cp`select plan_id, status from cp_instances where id = ${T1E}`
    facts.plans = { t1a: t1a?.plan_id ?? null, t1e: t1e?.plan_id ?? null }

    const ownerA = before.find((r) => r.id === T1A)?.owner_email
    const ownerE = before.find((r) => r.id === T1E)?.owner_email
    if (!ownerA || !ownerE) throw new Error('owner missing')
    const dsnA = await tenantDirectDsn(T1A)
    const dsnE = await tenantDirectDsn(T1E)
    if (!dsnA || !dsnE) throw new Error('dsn missing')

    const mintedA = await mint(dsnA, ownerA, ORIGIN_A, '/admin/settings/billing')
    const mintedE = await mint(dsnE, ownerE, ORIGIN_E, '/admin/settings/billing')
    facts.handoff = {
      t1a: { consumeStatus: mintedA.consumeStatus, hasSession: mintedA.hasSession },
      t1e: { consumeStatus: mintedE.consumeStatus, hasSession: mintedE.hasSession },
    }
    if (!mintedA.hasSession || !mintedE.hasSession) throw new Error('handoff did not set session')

    facts.t1a = {
      sameProMonthly: await postBilling(
        ORIGIN_A,
        mintedA.cookie,
        ORIGIN_A,
        'action=checkout&planId=pro&billingPeriod=monthly',
      ),
      scaleMonthly: await postBilling(
        ORIGIN_A,
        mintedA.cookie,
        ORIGIN_A,
        'action=checkout&planId=scale&billingPeriod=monthly',
      ),
      foreignOrigin: await postBilling(
        ORIGIN_A,
        mintedA.cookie,
        'https://attacker.test',
        'action=checkout&planId=scale&billingPeriod=monthly',
      ),
      missingOrigin: await postBilling(
        ORIGIN_A,
        mintedA.cookie,
        undefined,
        'action=checkout&planId=scale&billingPeriod=monthly',
      ),
    }
    facts.t1e = {
      growthMonthly: await postBilling(
        ORIGIN_E,
        mintedE.cookie,
        ORIGIN_E,
        'action=checkout&planId=growth&billingPeriod=monthly',
      ),
    }

    const after = await cp`select id from cp_instances order by id`
    facts.instanceCount.after = after.length
    facts.instanceCount.didNotRise = after.length === before.length

    facts.ok =
      facts.t1a.sameProMonthly.status === 409 &&
      facts.t1a.sameProMonthly.error === 'already_on_plan' &&
      facts.t1a.scaleMonthly.status === 303 &&
      facts.t1a.scaleMonthly.locationHost === 'billing.stripe.com' &&
      facts.t1e.growthMonthly.status === 303 &&
      facts.t1e.growthMonthly.hasCsTest === true &&
      facts.t1e.growthMonthly.hasCsLive === false &&
      facts.t1a.foreignOrigin.status === 403 &&
      facts.t1a.missingOrigin.status === 403 &&
      facts.instanceCount.didNotRise === true
  } finally {
    await cp.end({ timeout: 5 })
  }
} catch (err) {
  facts.errors.push(err instanceof Error ? err.message : String(err))
  facts.ok = false
}

writeFileSync(OUT, JSON.stringify(facts, null, 2))
console.log(JSON.stringify(facts, null, 2))
