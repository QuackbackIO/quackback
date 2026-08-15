#!/usr/bin/env bun
/**
 * Start a test-mode checkout on existing t1e. Redacted facts only.
 * Does not pay, create Neon, or print secrets.
 */
import { createHash, createHmac, hkdfSync } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import postgres from '/home/james/quackback-cp/node_modules/postgres/src/index.js'
import Stripe from '/home/james/quackback-cp/node_modules/stripe/esm/stripe.esm.node.js'

const envFile = process.env.PROBE_ENV_FILE
if (envFile) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1)
  }
}

const T1A = 'inst_01m00kq6cdfzzb19gfjz8pt0s7'
const T1E = 'inst_01m00kprbrfzzb19f490wga8q2'
const CP = 'https://cp.quackback.co.uk'
const OUT_DIR = '/home/james/quackback-wt/saas-merge/loop-evidence/this-fire'
mkdirSync(OUT_DIR, { recursive: true })
const OUT = `${OUT_DIR}/t1e-pay-start.json`
const URL_FILE = '/tmp/t1e-checkout-url.txt'
const SID_FILE = '/tmp/t1e-checkout-sid.txt'

function must(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is unset`)
  return v
}
function deriveWorkspaceSecret(rootKey, instanceId) {
  return Buffer.from(
    hkdfSync('sha256', rootKey, 'quackback-fleet-root-v1', `quackback:fleet:derive:v1:${instanceId}:app-secrets`, 32),
  ).toString('base64url')
}
function deriveInternalToken(workspaceSecret) {
  return `qbint_${createHmac('sha256', workspaceSecret)
    .update('quackback-control-plane-credential-v1')
    .digest('base64url')}`
}

const facts = {
  at: new Date().toISOString(),
  unit: 'stripe-live-t1e-pay-start',
  instanceId: T1E,
  errors: [],
  didNotCreateNeon: true,
  didNotPay: true,
}

try {
  const stripeKey = must('STRIPE_SECRET_KEY')
  facts.stripeKeyPrefix = stripeKey.startsWith('sk_test_')
    ? 'sk_test_'
    : stripeKey.startsWith('sk_live_')
      ? 'sk_live_'
      : stripeKey.slice(0, 7)
  if (facts.stripeKeyPrefix !== 'sk_test_') throw new Error('refusing non-test Stripe secret')

  const rootKey = must('QUACKBACK_FLEET_ROOT_KEY')
  const stripe = new Stripe(stripeKey)
  const sql = postgres(must('DATABASE_URL'), { max: 2, idle_timeout: 5, connect_timeout: 20 })
  try {
    const ids = await sql`select id, plan_id from cp_instances order by id`
    facts.instanceCountBefore = ids.length
    facts.hasT1a = ids.some((r) => r.id === T1A)
    facts.hasT1e = ids.some((r) => r.id === T1E)
    facts.t1aPlan = ids.find((r) => r.id === T1A)?.plan_id ?? null
    facts.t1ePlan = ids.find((r) => r.id === T1E)?.plan_id ?? null

    const [ws] = await sql`
      select i.plan_id, i.status,
             o.subscription_status,
             o.stripe_subscription_id is not null as has_sub
      from cp_instances i
      left join cp_organizations o on o.id = i.org_id
      where i.id = ${T1E}
    `
    const [out] = await sql`
      select projection_version, status, projection->>'effectivePlan' as effective_plan
      from cp_billing_projection_outbox
      where instance_id = ${T1E}
      order by projection_version desc limit 1
    `
    facts.workspaceBefore = { ...ws, latestOutbox: out ?? null }

    const token = deriveInternalToken(deriveWorkspaceSecret(rootKey, T1E))
    const res = await fetch(`${CP}/api/v1/internal/billing/session`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'checkout', planId: 'growth', billingPeriod: 'monthly' }),
    })
    const json = await res.json().catch(() => null)
    facts.checkout = {
      status: res.status,
      error: typeof json?.error === 'string' ? json.error : null,
      urlHost: null,
      sessionPrefix: null,
    }
    if (typeof json?.url !== 'string') throw new Error(`no checkout url (${res.status} ${facts.checkout.error})`)
    const url = new URL(json.url)
    facts.checkout.urlHost = url.host
    const sid = url.pathname.split('/').filter(Boolean).at(-1) ?? ''
    facts.checkout.sessionPrefix = sid.startsWith('cs_test_')
      ? 'cs_test_'
      : sid.startsWith('cs_live_')
        ? 'cs_live_'
        : sid.slice(0, 8)
    if (!sid.startsWith('cs_test_')) throw new Error('checkout session is not cs_test_')
    writeFileSync(URL_FILE, json.url)
    writeFileSync(SID_FILE, sid)

    const session = await stripe.checkout.sessions.retrieve(sid)
    facts.stripeSession = {
      livemode: session.livemode === true,
      mode: session.mode,
      status: session.status,
      paymentStatus: session.payment_status,
      kind: session.metadata?.kind ?? null,
      instanceId: session.metadata?.instanceId ?? null,
      planId: session.metadata?.planId ?? null,
      billingPeriod: session.metadata?.billingPeriod ?? null,
      successHost: session.success_url ? new URL(session.success_url).host : null,
    }
    if (session.metadata?.instanceId !== T1E) throw new Error('session metadata is not t1e')
    if (session.livemode === true) throw new Error('session is live mode')
    if (typeof session.customer === 'string') {
      await stripe.customers.update(session.customer, {
        address: { line1: '10 Downing Street', city: 'London', postal_code: 'SW1A 2AA', country: 'GB' },
        name: 'T1e Walk',
      })
      facts.customerAddressUpdated = { country: 'GB' }
    }
    const after = await sql`select count(*)::int as n from cp_instances`
    facts.instanceCountAfterCreate = after[0].n
    facts.didNotCreateWorkspace = after[0].n === ids.length
  } finally {
    await sql.end({ timeout: 2 })
  }
} catch (err) {
  facts.errors.push(err instanceof Error ? err.message : String(err))
}

writeFileSync(OUT, JSON.stringify(facts, null, 2))
console.log(JSON.stringify(facts, null, 2))
if (facts.errors.length) process.exitCode = 1
