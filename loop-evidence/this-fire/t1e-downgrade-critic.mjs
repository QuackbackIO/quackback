#!/usr/bin/env bun
/** Read-only critic: t1e still Scale; Stripe schedule has future Growth. */
import { writeFileSync } from 'node:fs'
import postgres from '/home/james/quackback-cp/node_modules/postgres/src/index.js'
import Stripe from '/home/james/quackback-cp/node_modules/stripe/esm/stripe.esm.node.js'

const T1A = 'inst_01m00kq6cdfzzb19gfjz8pt0s7'
const T1E = 'inst_01m00kprbrfzzb19f490wga8q2'
const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/this-fire/t1e-downgrade-critic.json'
const NORTH = 'https://northfa99f0.quackback.co.uk/api/health/ready'
const SOUTH = 'https://south63792f.quackback.co.uk/api/health/ready'

const facts = {
  at: new Date().toISOString(),
  unit: 't1e-downgrade-critic',
  didNotPay: true,
  didNotMutateStripe: true,
  didNotCreateWorkspace: true,
  errors: [],
  checks: {},
}

async function ready(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'quackback-t1e-downgrade-critic/2026-08-15' } })
  return { url, status: res.status, ok: res.status === 200 }
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 20 })
try {
  const key = process.env.STRIPE_SECRET_KEY || ''
  facts.stripeKeyPrefix = key.startsWith('sk_test_') ? 'sk_test_' : key.slice(0, 8)
  if (!key.startsWith('sk_test_')) throw new Error('refusing non-test Stripe secret')
  const stripe = new Stripe(key)

  const [t1e] = await sql`
    select i.plan_id, i.pending_plan_id, o.stripe_subscription_id, o.subscription_status,
           ob.projection->>'effectivePlan' as effective_plan,
           ob.status as outbox_status,
           ob.projection_version
    from cp_instances i
    left join cp_organizations o on o.id = i.org_id
    left join lateral (
      select projection, status, projection_version from cp_billing_projection_outbox
      where instance_id = i.id order by projection_version desc limit 1
    ) ob on true
    where i.id = ${T1E}
  `
  const [t1a] = await sql`select plan_id from cp_instances where id = ${T1A}`
  const n = await sql`select count(*)::int as n from cp_instances`
  const [growth] = await sql`select stripe_price_id from cp_plans where id = 'growth'`
  const [scale] = await sql`select stripe_price_id from cp_plans where id = 'scale'`
  const [pro] = await sql`select stripe_price_id from cp_plans where id = 'pro'`

  const sub = await stripe.subscriptions.retrieve(t1e.stripe_subscription_id)
  const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id ?? null
  const sched = scheduleId ? await stripe.subscriptionSchedules.retrieve(scheduleId) : null
  const label = (id) => {
    if (id === growth.stripe_price_id) return 'growth'
    if (id === scale.stripe_price_id) return 'scale'
    if (id === pro?.stripe_price_id) return 'pro'
    return 'other'
  }
  const currentItems = (sub.items?.data ?? []).map((it) =>
    label(typeof it.price === 'string' ? it.price : it.price.id),
  )
  const phases = (sched?.phases ?? []).map((p) =>
    p.items.map((it) => label(typeof it.price === 'string' ? it.price : it.price.id)),
  )

  facts.health = {
    north: await ready(NORTH),
    south: await ready(SOUTH),
  }
  facts.cp = {
    t1ePlan: t1e.plan_id,
    t1eEffective: t1e.effective_plan,
    pending: t1e.pending_plan_id,
    outboxStatus: t1e.outbox_status,
    outboxVersion: t1e.projection_version,
    t1eSubStatus: t1e.subscription_status,
    t1aPlan: t1a.plan_id,
    instances: n[0].n,
  }
  facts.stripe = {
    livemode: sub.livemode,
    subStatus: sub.status,
    currentItems,
    hasSchedule: Boolean(scheduleId),
    scheduleStatus: sched?.status ?? null,
    scheduleLivemode: sched?.livemode ?? null,
    phaseCount: sched?.phases?.length ?? 0,
    phases,
    subPrefix: typeof t1e.stripe_subscription_id === 'string' ? t1e.stripe_subscription_id.slice(0, 4) : null,
    schedPrefix: scheduleId ? String(scheduleId).slice(0, 6) : null,
  }

  facts.checks = {
    stripeTestKey: facts.stripeKeyPrefix === 'sk_test_',
    t1eStillScale: facts.cp.t1ePlan === 'scale',
    t1eEffectiveScale: facts.cp.t1eEffective === 'scale',
    t1aStillPro: facts.cp.t1aPlan === 'pro',
    instances19: facts.cp.instances === 19,
    stripeTestMode: facts.stripe.livemode === false,
    subActive: facts.stripe.subStatus === 'active',
    currentItemStillScale: facts.stripe.currentItems.includes('scale') && !facts.stripe.currentItems.includes('growth'),
    scheduleActive: facts.stripe.scheduleStatus === 'active',
    scheduleTwoPhases: facts.stripe.phaseCount >= 2,
    currentPhaseScale: Boolean(facts.stripe.phases[0]?.includes('scale')),
    laterPhaseGrowth: Boolean(facts.stripe.phases[1]?.includes('growth')),
    northReady: facts.health.north.ok,
    southReady: facts.health.south.ok,
  }
  facts.ok = Object.values(facts.checks).every(Boolean)
} catch (err) {
  facts.errors.push(err instanceof Error ? err.message : String(err))
  facts.ok = false
} finally {
  await sql.end({ timeout: 5 })
  writeFileSync(OUT, JSON.stringify(facts, null, 2))
  console.log(JSON.stringify(facts, null, 2))
}
if (!facts.ok) process.exitCode = 1
