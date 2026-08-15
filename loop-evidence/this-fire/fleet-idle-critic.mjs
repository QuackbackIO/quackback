#!/usr/bin/env bun
/**
 * Independent live critic: fleet idle on 895b942d + Upgrade 303.
 * Does not pay, deploy, create, wipe, or print secrets.
 */
import { createHmac, hkdfSync, randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import postgres from '/home/james/quackback-cp/node_modules/postgres/src/index.js'

const T1A = 'inst_01m00kq6cdfzzb19gfjz8pt0s7'
const T1E = 'inst_01m00kprbrfzzb19f490wga8q2'
const T7S = 'inst_01m021rrsdfan9v4bzpcec2g3z'
const ORIGIN_A = 'https://south63792f.quackback.co.uk'
const ORIGIN_E = 'https://northfa99f0.quackback.co.uk'
const ORIGIN_7 = 'https://sup9ca3a708.quackback.co.uk'
const CP = 'https://cp.quackback.co.uk'
const UA = 'quackback-fleet-idle-critic/2026-08-15'
const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/this-fire/fleet-idle-critic.json'
const EXPECTED = 'sha256:895b942d58b548021837e4abcbdf96156410de149b23fcb2f29041ccaac8e1ab'

function deriveToken(root, id) {
  const secret = Buffer.from(
    hkdfSync('sha256', root, 'quackback-fleet-root-v1', `quackback:fleet:derive:v1:${id}:app-secrets`, 32),
  ).toString('base64url')
  return `qbint_${createHmac('sha256', secret).update('quackback-control-plane-credential-v1').digest('base64url')}`
}

async function mint(dsn, email, origin) {
  const tenant = postgres(dsn, { max: 1, connect_timeout: 20 })
  try {
    const [user] = await tenant`select id from "user" where lower(email) = ${String(email).toLowerCase()} limit 1`
    const ott = randomBytes(24).toString('base64url')
    const sessionToken = randomBytes(32).toString('base64url')
    const now = new Date()
    await tenant.begin(async (tx) => {
      await tx`INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at)
        VALUES (${randomUUID()}, ${sessionToken}, ${user.id}, ${new Date(now.getTime() + 7 * 864e5)}, ${now}, ${now})`
      await tx`INSERT INTO verification (id, identifier, value, expires_at)
        VALUES (${randomUUID()}, ${`one-time-token:${ott}`}, ${sessionToken}, ${new Date(now.getTime() + 10 * 60 * 1000)})`
    })
    const url = new URL('/auth/open-handoff', origin)
    url.searchParams.set('ott', ott)
    url.searchParams.set('returnTo', '/admin/inbox')
    const consume = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA } })
    const cookie = (consume.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
    return { cookie, consumeStatus: consume.status, hasSession: cookie.includes('session_token') }
  } finally {
    await tenant.end({ timeout: 5 })
  }
}

async function postBilling(origin, cookie, body, extraHeaders = {}) {
  const res = await fetch(`${origin}/api/billing/session`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin,
      cookie,
      'user-agent': UA,
      ...extraHeaders,
    },
    body,
  })
  const json = await res.json().catch(() => null)
  const loc = res.headers.get('location')
  return {
    status: res.status,
    error: typeof json?.error === 'string' ? json.error : null,
    locationHost: loc ? new URL(loc).hostname : null,
    locationIsLiveCheckout: Boolean(loc && loc.includes('cs_live_')),
  }
}

const facts = {
  at: new Date().toISOString(),
  unit: 'fleet-idle-critic',
  didNotPay: true,
  didNotDeploy: true,
  didNotCreateNeon: true,
  didNotStartCustomDomains: true,
  errors: [],
  highs: [],
}

const sql = postgres(process.env.DATABASE_URL, { max: 2, idle_timeout: 5, connect_timeout: 20 })
try {
  const stripeKey = process.env.STRIPE_SECRET_KEY || ''
  facts.stripeKeyPrefix = stripeKey.startsWith('sk_test_') ? 'sk_test_' : stripeKey.slice(0, 8)
  if (stripeKey && !stripeKey.startsWith('sk_test_')) throw new Error('refusing non-test Stripe secret')

  const before = await sql`select count(*)::int as n from cp_instances`
  facts.instanceCount = { before: before[0].n }
  const plans = await sql`select id, plan_id from cp_instances where id in (${T1A}, ${T1E}, ${T7S})`
  facts.plans = Object.fromEntries(plans.map((r) => [r.id.slice(0, 16), r.plan_id]))

  const health = {}
  for (const url of [
    'https://gauntlet.quackback.co.uk/api/health/ready',
    `${ORIGIN_A}/api/health/ready`,
    `${ORIGIN_E}/api/health/ready`,
    `${ORIGIN_7}/api/health/ready`,
  ]) {
    const res = await fetch(url, { headers: { 'user-agent': UA } })
    const json = await res.json().catch(() => null)
    health[url] = { status: res.status, role: json?.role ?? null }
  }
  facts.health = health

  const { tenantDirectDsn } = await import(
    '/home/james/quackback-cp/src/lib/server/tenant-bootstrap-orchestrator.ts'
  )
  const owners = await sql`select id, owner_email from cp_instances where id in (${T1A}, ${T1E}, ${T7S})`
  const owner = (id) => owners.find((r) => r.id === id)
  const mintedA = await mint(await tenantDirectDsn(T1A), owner(T1A).owner_email, ORIGIN_A)
  const mintedE = await mint(await tenantDirectDsn(T1E), owner(T1E).owner_email, ORIGIN_E)
  const minted7 = await mint(await tenantDirectDsn(T7S), owner(T7S).owner_email, ORIGIN_7)
  facts.mint = {
    t1a: { consumeStatus: mintedA.consumeStatus, hasSession: mintedA.hasSession },
    t1e: { consumeStatus: mintedE.consumeStatus, hasSession: mintedE.hasSession },
    t7: { consumeStatus: minted7.consumeStatus, hasSession: minted7.hasSession },
  }

  facts.t7Upgrade = await postBilling(ORIGIN_7, minted7.cookie, 'action=checkout&planId=growth&billingPeriod=monthly')
  facts.t1aSamePro = await postBilling(ORIGIN_A, mintedA.cookie, 'action=checkout&planId=pro&billingPeriod=monthly')
  facts.t1eSameScale = await postBilling(ORIGIN_E, mintedE.cookie, 'action=checkout&planId=scale&billingPeriod=monthly')
  facts.t1aForeignOrigin = await postBilling(ORIGIN_A, mintedA.cookie, 'action=portal', {
    origin: 'https://attacker.test',
  })
  const cross = await fetch(`${ORIGIN_E}/api/billing/session`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: ORIGIN_E,
      cookie: mintedA.cookie,
      'user-agent': UA,
    },
    body: 'action=portal',
  })
  const crossJson = await cross.json().catch(() => null)
  facts.t1aCookieOnT1e = { status: cross.status, error: crossJson?.error ?? null }

  async function lifecycle(path) {
    const res = await fetch(`${CP}/api/instances/${T1A}/${path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'user-agent': UA },
    })
    const loc = res.headers.get('location')
    return {
      status: res.status,
      locationHost: loc ? new URL(loc, CP).hostname : null,
      locationPath: loc ? new URL(loc, CP).pathname : null,
    }
  }
  facts.lifecycle = { delete: await lifecycle('delete'), restore: await lifecycle('restore') }

  const after = await sql`select count(*)::int as n from cp_instances`
  facts.instanceCount.after = after[0].n
  facts.expectedDigest = EXPECTED

  const highs = []
  if (Object.values(health).some((h) => h.status !== 200 || h.role !== 'web')) highs.push('ready not 200 web')
  if (facts.t7Upgrade.status !== 303 || facts.t7Upgrade.locationHost !== 'checkout.stripe.com') {
    highs.push('t7 upgrade not 303 checkout')
  }
  if (facts.t7Upgrade.locationIsLiveCheckout) highs.push('t7 checkout is live mode')
  if (facts.t1aSamePro.status !== 409 || facts.t1aSamePro.error !== 'already_on_plan') highs.push('t1a same-plan')
  if (facts.t1eSameScale.status !== 409 || facts.t1eSameScale.error !== 'already_on_plan') highs.push('t1e same-plan')
  if (facts.t1aForeignOrigin.status !== 403 || facts.t1aForeignOrigin.error !== 'invalid_origin') {
    highs.push('foreign origin')
  }
  if (facts.t1aCookieOnT1e.status !== 401 || facts.t1aCookieOnT1e.error !== 'unauthorized') {
    highs.push('foreign session')
  }
  if (facts.lifecycle.delete.status !== 303 || facts.lifecycle.delete.locationPath !== '/auth/login') {
    highs.push('delete not 303 login')
  }
  if (facts.lifecycle.restore.status !== 303 || facts.lifecycle.restore.locationPath !== '/auth/login') {
    highs.push('restore not 303 login')
  }
  if (facts.lifecycle.delete.locationHost !== 'cp.quackback.co.uk') highs.push('delete location not https cp host')
  if (facts.plans.inst_01m00kq6cdf !== 'pro') highs.push('t1a not pro')
  if (facts.plans.inst_01m00kprbrf !== 'scale') highs.push('t1e not scale')
  if (facts.instanceCount.before !== 19 || facts.instanceCount.after !== 19) highs.push('instance count')
  if (facts.stripeKeyPrefix !== 'sk_test_') highs.push('stripe key not test')
  facts.highs = highs
  facts.ok = highs.length === 0
} catch (err) {
  facts.errors.push(err instanceof Error ? err.message : String(err))
  facts.ok = false
} finally {
  await sql.end({ timeout: 5 })
  writeFileSync(OUT, JSON.stringify(facts, null, 2))
  console.log(JSON.stringify(facts, null, 2))
}
if (!facts.ok) process.exitCode = 1
