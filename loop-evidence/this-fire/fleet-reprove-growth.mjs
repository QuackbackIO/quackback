#!/usr/bin/env bun
/**
 * Fleet re-prove after t1e became Growth paid.
 * Workspace form Origin 303/409. No pay, no Neon.
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

const T1A = 'inst_01m00kq6cdfzzb19gfjz8pt0s7'
const T1E = 'inst_01m00kprbrfzzb19f490wga8q2'
const ORIGIN_A = 'https://south63792f.quackback.co.uk'
const ORIGIN_E = 'https://northfa99f0.quackback.co.uk'
const UA = 'quackback-fleet-reprove/2026-08-15'
const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/this-fire/fleet-reprove-growth.json'

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
function redact(path) {
  if (!path) return null
  return path.replace(/cs_test_[A-Za-z0-9]+/g, 'cs_test_…').replace(/cs_live_[A-Za-z0-9]+/g, 'cs_live_…').slice(0, 48)
}

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
    return { consumeStatus: consume.status, cookie, hasSession: cookie.includes('session_token') }
  } finally {
    await tenant.end({ timeout: 5 })
  }
}

async function postBilling(origin, cookie, originHeader, body) {
  const headers = { 'content-type': 'application/x-www-form-urlencoded', cookie, 'user-agent': UA }
  if (originHeader !== undefined) headers.origin = originHeader
  const res = await fetch(`${origin}/api/billing/session`, { method: 'POST', headers, redirect: 'manual', body })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return {
    status: res.status,
    error: typeof json?.error === 'string' ? json.error : null,
    locationHost: hostOf(res.headers.get('location')),
    locationPath: redact(pathOf(res.headers.get('location'))),
    hasCsTest: (res.headers.get('location') || '').includes('cs_test_'),
    hasCsLive: (res.headers.get('location') || '').includes('cs_live_'),
  }
}

const facts = { at: new Date().toISOString(), errors: [], didNotPay: true, didNotCreateNeon: true }
try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL unset')
  const stripeKey = process.env.STRIPE_SECRET_KEY || ''
  facts.stripeKeyPrefix = stripeKey ? stripeKey.slice(0, 8) : null
  if (stripeKey && !stripeKey.startsWith('sk_test_')) throw new Error('refusing non-test stripe key')

  const cp = postgres(process.env.DATABASE_URL, { max: 2, idle_timeout: 5, connect_timeout: 20 })
  const { tenantDirectDsn } = await import(
    '/home/james/quackback-cp/src/lib/server/tenant-bootstrap-orchestrator.ts'
  )
  try {
    const before = await cp`select id, plan_id, owner_email from cp_instances order by id`
    facts.instanceCount = { before: before.length }
    facts.plans = {
      t1a: before.find((r) => r.id === T1A)?.plan_id ?? null,
      t1e: before.find((r) => r.id === T1E)?.plan_id ?? null,
    }
    const ownerA = before.find((r) => r.id === T1A)?.owner_email
    const ownerE = before.find((r) => r.id === T1E)?.owner_email
    const dsnA = await tenantDirectDsn(T1A)
    const dsnE = await tenantDirectDsn(T1E)
    const mintedA = await mint(dsnA, ownerA, ORIGIN_A)
    const mintedE = await mint(dsnE, ownerE, ORIGIN_E)
    facts.handoff = {
      t1a: { consumeStatus: mintedA.consumeStatus, hasSession: mintedA.hasSession },
      t1e: { consumeStatus: mintedE.consumeStatus, hasSession: mintedE.hasSession },
    }
    if (!mintedA.hasSession || !mintedE.hasSession) throw new Error('handoff failed')

    facts.t1a = {
      samePro: await postBilling(ORIGIN_A, mintedA.cookie, ORIGIN_A, 'action=checkout&planId=pro&billingPeriod=monthly'),
    }
    facts.t1e = {
      sameGrowth: await postBilling(ORIGIN_E, mintedE.cookie, ORIGIN_E, 'action=checkout&planId=growth&billingPeriod=monthly'),
      scale: await postBilling(ORIGIN_E, mintedE.cookie, ORIGIN_E, 'action=checkout&planId=scale&billingPeriod=monthly'),
      foreign: await postBilling(ORIGIN_E, mintedE.cookie, 'https://attacker.test', 'action=checkout&planId=scale&billingPeriod=monthly'),
      missing: await postBilling(ORIGIN_E, mintedE.cookie, undefined, 'action=checkout&planId=scale&billingPeriod=monthly'),
    }
    const after = await cp`select count(*)::int as n from cp_instances`
    facts.instanceCount.after = after[0].n
    facts.ok =
      facts.t1a.samePro.status === 409 &&
      facts.t1a.samePro.error === 'already_on_plan' &&
      facts.t1e.sameGrowth.status === 409 &&
      facts.t1e.sameGrowth.error === 'already_on_plan' &&
      facts.t1e.scale.status === 303 &&
      facts.t1e.scale.hasCsLive === false &&
      (facts.t1e.scale.locationHost === 'billing.stripe.com' || facts.t1e.scale.hasCsTest) &&
      facts.t1e.foreign.status === 403 &&
      facts.t1e.missing.status === 403 &&
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
