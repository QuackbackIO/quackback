#!/usr/bin/env bun
/**
 * Prove t1e test-mode payment + webhook finalize. Redacted facts only.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
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
const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/this-fire/t1e-pay-verify.json'
const SID_FILE = '/tmp/t1e-checkout-sid.txt'

function must(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is unset`)
  return v
}

const facts = { at: new Date().toISOString(), unit: 'stripe-live-t1e-pay-verify', errors: [], polls: [] }

try {
  const stripeKey = must('STRIPE_SECRET_KEY')
  facts.stripeKeyPrefix = stripeKey.startsWith('sk_test_') ? 'sk_test_' : stripeKey.slice(0, 8)
  if (!stripeKey.startsWith('sk_test_')) throw new Error('refusing non-test Stripe secret')
  if (!existsSync(SID_FILE)) throw new Error('missing checkout session id file')
  const sid = readFileSync(SID_FILE, 'utf8').trim()
  facts.sessionPrefix = sid.startsWith('cs_test_') ? 'cs_test_' : sid.slice(0, 8)
  if (!sid.startsWith('cs_test_')) throw new Error('session id is not cs_test_')

  const stripe = new Stripe(stripeKey)
  const sql = postgres(must('DATABASE_URL'), { max: 2, idle_timeout: 5, connect_timeout: 20 })

  async function snapshot() {
    const session = await stripe.checkout.sessions.retrieve(sid, { expand: ['subscription'] })
    const sub = typeof session.subscription === 'object' && session.subscription ? session.subscription : null
    const [ws] = await sql`
      select i.plan_id, i.status,
             i.stripe_subscription_item_id is not null as has_item,
             left(coalesce(i.stripe_subscription_item_id, ''), 8) as item_prefix,
             o.stripe_subscription_id is not null as has_sub,
             left(coalesce(o.stripe_subscription_id, ''), 8) as sub_prefix,
             o.subscription_status
      from cp_instances i
      left join cp_organizations o on o.id = i.org_id
      where i.id = ${T1E}
    `
    const [out] = await sql`
      select projection_version, status,
             projection->>'effectivePlan' as effective_plan,
             projection->>'subscriptionStatus' as subscription_status,
             projection->>'canManageBilling' as can_manage_billing
      from cp_billing_projection_outbox
      where instance_id = ${T1E}
      order by projection_version desc limit 1
    `
    const hooks = await sql`
      select left(id, 8) as id_prefix, event_type, processed_at is not null as processed
      from cp_stripe_webhook_events
      where event_type in ('checkout.session.completed', 'customer.subscription.created')
      order by received_at desc limit 6
    `
    const [t1a] = await sql`select plan_id from cp_instances where id = ${T1A}`
    const count = await sql`select count(*)::int as n from cp_instances`
    return {
      stripe: {
        status: session.status,
        paymentStatus: session.payment_status,
        livemode: session.livemode === true,
        kind: session.metadata?.kind ?? null,
        instanceId: session.metadata?.instanceId ?? null,
        planId: session.metadata?.planId ?? null,
        hasSubscription: Boolean(session.subscription),
        subscriptionPrefix: sub && typeof sub.id === 'string' ? sub.id.slice(0, 8) : null,
        subscriptionStatus: sub && 'status' in sub ? sub.status : null,
      },
      workspace: ws,
      outbox: out ?? null,
      webhookEvents: hooks,
      t1aPlan: t1a?.plan_id ?? null,
      instanceCount: count[0].n,
    }
  }

  try {
    for (let i = 0; i < 8; i++) {
      const snap = await snapshot()
      facts.polls.push({ at: new Date().toISOString(), ...snap })
      facts.final = snap
      if (
        snap.stripe.status === 'complete' &&
        snap.stripe.paymentStatus === 'paid' &&
        snap.workspace?.plan_id === 'growth' &&
        snap.outbox?.effective_plan === 'growth' &&
        snap.webhookEvents.some((h) => h.event_type === 'checkout.session.completed' && h.processed)
      ) {
        break
      }
      await Bun.sleep(4000)
    }
  } finally {
    await sql.end({ timeout: 2 })
  }

  const f = facts.final
  facts.paid = f?.stripe?.status === 'complete' && f?.stripe?.paymentStatus === 'paid'
  facts.livemodeFalse = f?.stripe?.livemode === false
  facts.metadataT1e = f?.stripe?.instanceId === T1E
  facts.webhookCheckoutCompleted = Boolean(
    f?.webhookEvents?.some((h) => h.event_type === 'checkout.session.completed' && h.processed),
  )
  facts.planGrowth = f?.workspace?.plan_id === 'growth'
  facts.outboxGrowth = f?.outbox?.effective_plan === 'growth'
  facts.t1aStillPro = f?.t1aPlan === 'pro'
  facts.instanceCount = f?.instanceCount ?? null
  facts.ok =
    facts.paid &&
    facts.livemodeFalse &&
    facts.metadataT1e &&
    facts.webhookCheckoutCompleted &&
    facts.planGrowth &&
    facts.outboxGrowth &&
    facts.t1aStillPro &&
    facts.instanceCount === 19
} catch (err) {
  facts.errors.push(err instanceof Error ? err.message : String(err))
  facts.ok = false
}

writeFileSync(OUT, JSON.stringify(facts, null, 2))
console.log(JSON.stringify({ ok: facts.ok, errors: facts.errors, final: facts.final, paid: facts.paid }, null, 2))
if (!facts.ok) process.exitCode = 1
