#!/usr/bin/env bun
/**
 * §H Free fixture on existing t7 hosts. No pay, no Neon, no wipe.
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

const T7S = 'inst_01m021rrsdfan9v4bzpcec2g3z'
const T7H = 'inst_01m021xvy6fan9v4f5271b2496'
const HOST_S = 'https://sup9ca3a708.quackback.co.uk'
const HOST_H = 'https://hc9ca3a708.quackback.co.uk'
const UA = 'quackback-plan-matrix-free-t7/2026-08-15'
const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/plan-matrix-free-t7.json'

function hostOf(url) {
  if (!url) return null
  try {
    return new URL(url, 'https://placeholder.invalid').hostname
  } catch {
    return null
  }
}

async function mint(dsn, email, origin) {
  const ott = randomBytes(24).toString('base64url')
  const sessionToken = randomBytes(32).toString('base64url')
  const now = new Date()
  const tenant = postgres(dsn, { max: 1, connect_timeout: 20 })
  try {
    const [user] = await tenant`select id from "user" where lower(email) = ${email.toLowerCase()} limit 1`
    if (!user) throw new Error(`owner missing ${origin}`)
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
    const [settings] = await tenant`select cloud, tier_limits from settings limit 1`
    return {
      consumeStatus: consume.status,
      cookie,
      hasSession: cookie.includes('session_token'),
      cloud: settings?.cloud ?? null,
      storedTierLimits: settings?.tier_limits ?? null,
    }
  } finally {
    await tenant.end({ timeout: 5 })
  }
}

async function postBilling(origin, cookie, body) {
  const res = await fetch(`${origin}/api/billing/session`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin,
      cookie,
      'user-agent': UA,
    },
    body,
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return {
    status: res.status,
    error: typeof json?.error === 'string' ? json.error : null,
    locationHost: hostOf(res.headers.get('location')),
    hasCsTest: (res.headers.get('location') || '').includes('cs_test_'),
    hasCsLive: (res.headers.get('location') || '').includes('cs_live_'),
  }
}

function overlay(cloud) {
  const c = cloud && typeof cloud === 'object' ? cloud : {}
  const proj = c.projection && typeof c.projection === 'object' ? c.projection : c
  return {
    effectivePlan: proj.effectivePlan ?? c.effectivePlan ?? null,
    subscriptionStatus: proj.subscriptionStatus ?? c.subscriptionStatus ?? null,
    planLimits: proj.planLimits ?? c.planLimits ?? null,
    entitlements: proj.entitlements ?? c.entitlements ?? null,
    canUpgrade: proj.canUpgrade ?? c.canUpgrade ?? null,
    canManageBilling: proj.canManageBilling ?? c.canManageBilling ?? null,
  }
}

const facts = {
  at: new Date().toISOString(),
  unit: 'plan-matrix-free-t7',
  didNotPay: true,
  didNotCreateNeon: true,
  errors: [],
}

try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL unset')
  const stripeKey = process.env.STRIPE_SECRET_KEY || ''
  if (stripeKey && !stripeKey.startsWith('sk_test_')) throw new Error('refusing non-test stripe key')
  facts.stripeKeyPrefix = stripeKey ? stripeKey.slice(0, 8) : null

  const cp = postgres(process.env.DATABASE_URL, { max: 2, idle_timeout: 5, connect_timeout: 20 })
  const { tenantDirectDsn } = await import(
    '/home/james/quackback-cp/src/lib/server/tenant-bootstrap-orchestrator.ts'
  )
  try {
    const before = await cp`select count(*)::int as n from cp_instances`
    facts.instanceCount = { before: before[0].n }
    const rows = await cp`
      select id, plan_id, status, owner_email, system_hostname
      from cp_instances
      where id in (${T7S}, ${T7H})
    `
    facts.rows = rows.map((r) => ({
      id: r.id,
      planId: r.plan_id,
      status: r.status,
      host: r.system_hostname,
    }))

    async function one(id, origin) {
      const row = rows.find((r) => r.id === id)
      if (!row) return { missing: true }
      const dsn = await tenantDirectDsn(id)
      const minted = await mint(dsn, row.owner_email, origin)
      const ov = overlay(minted.cloud)
      const health = await fetch(`${origin}/api/health/ready`, { redirect: 'manual' })
      const sso = await fetch(`${origin}/admin/settings/security/authentication/sso/new`, {
        headers: { cookie: minted.cookie, 'user-agent': UA },
        redirect: 'manual',
      })
      const ssoText = await sso.text()
      return {
        health: health.status,
        consumeStatus: minted.consumeStatus,
        hasSession: minted.hasSession,
        storedTierLimits: minted.storedTierLimits,
        overlay: ov,
        unlimited: ov.planLimits == null,
        checkoutGrowth: await postBilling(
          origin,
          minted.cookie,
          'action=checkout&planId=growth&billingPeriod=monthly',
        ),
        portal: await postBilling(origin, minted.cookie, 'action=portal'),
        ssoNew: { status: sso.status, hasCreateFields: /issuer|client id|client secret/i.test(ssoText) },
      }
    }

    facts.t7s = await one(T7S, HOST_S)
    facts.t7h = await one(T7H, HOST_H)
    const after = await cp`select count(*)::int as n from cp_instances`
    facts.instanceCount.after = after[0].n

    const freeOk = (x) =>
      x &&
      x.health === 200 &&
      x.hasSession &&
      x.storedTierLimits == null &&
      x.unlimited === false &&
      x.overlay.planLimits?.maxBoards === 2 &&
      x.overlay.planLimits?.maxPosts === 50 &&
      x.overlay.planLimits?.maxTeamSeats === 1 &&
      x.overlay.entitlements?.webhooks === false &&
      x.overlay.entitlements?.workflows === false &&
      x.checkoutGrowth.status === 303 &&
      x.checkoutGrowth.hasCsTest === true &&
      x.checkoutGrowth.hasCsLive === false &&
      x.portal.status === 403
    facts.ok =
      freeOk(facts.t7s) &&
      freeOk(facts.t7h) &&
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
