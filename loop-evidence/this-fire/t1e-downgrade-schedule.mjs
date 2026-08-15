#!/usr/bin/env bun
/**
 * t1e Scale → Growth scheduled at period end. Does not apply Growth now.
 */
import { createHmac, hkdfSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import postgres from '/home/james/quackback-cp/node_modules/postgres/src/index.js'
import Stripe from '/home/james/quackback-cp/node_modules/stripe/esm/stripe.esm.node.js'

const T1A = 'inst_01m00kq6cdfzzb19gfjz8pt0s7'
const T1E = 'inst_01m00kprbrfzzb19f490wga8q2'
const CP = 'https://cp.quackback.co.uk'
const UA = 'quackback-t1e-downgrade/2026-08-15'
const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/this-fire/t1e-downgrade-schedule.json'

function must(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is unset`)
  return v
}
function deriveToken(root, id) {
  const secret = Buffer.from(
    hkdfSync('sha256', root, 'quackback-fleet-root-v1', `quackback:fleet:derive:v1:${id}:app-secrets`, 32),
  ).toString('base64url')
  return `qbint_${createHmac('sha256', secret).update('quackback-control-plane-credential-v1').digest('base64url')}`
}

const facts = {
  at: new Date().toISOString(),
  unit: 'stripe-live-t1e-downgrade-schedule',
  didNotCreateNeon: true,
  printedCredentials: false,
  errors: [],
}

const sql = postgres(must('DATABASE_URL'), { max: 2, idle_timeout: 5, connect_timeout: 20 })
try {
  const stripeKey = must('STRIPE_SECRET_KEY')
  facts.stripeKeyPrefix = stripeKey.startsWith('sk_test_') ? 'sk_test_' : stripeKey.slice(0, 8)
  if (!stripeKey.startsWith('sk_test_')) throw new Error('refusing non-test Stripe secret')
  const stripe = new Stripe(stripeKey)
  const root = must('QUACKBACK_FLEET_ROOT_KEY')

  const n0 = await sql`select count(*)::int as n from cp_instances`
  facts.instanceCount = { before: n0[0].n }

  const [t1e] = await sql`
    select i.plan_id, i.stripe_subscription_item_id, i.pending_plan_id,
           o.stripe_subscription_id
    from cp_instances i
    left join cp_organizations o on o.id = i.org_id
    where i.id = ${T1E}
  `
  const [t1a] = await sql`select plan_id from cp_instances where id = ${T1A}`
  facts.before = { t1ePlan: t1e?.plan_id ?? null, t1aPlan: t1a?.plan_id ?? null, pending: t1e?.pending_plan_id ?? null }
  if (t1e?.plan_id !== 'scale') throw new Error(`t1e is ${t1e?.plan_id}, expected scale`)
  if (!t1e?.stripe_subscription_id || !t1e?.stripe_subscription_item_id) throw new Error('t1e sub missing')

  const token = deriveToken(root, T1E)
  const sessionRes = await fetch(`${CP}/api/v1/internal/billing/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ action: 'checkout', planId: 'growth', billingPeriod: 'monthly' }),
  })
  const sessionJson = await sessionRes.json().catch(() => null)
  const url = typeof sessionJson?.url === 'string' ? sessionJson.url : null
  facts.gateway = {
    status: sessionRes.status,
    urlHost: url ? new URL(url).hostname : null,
    error: typeof sessionJson?.error === 'string' ? sessionJson.error : null,
  }
  if (facts.gateway.status !== 200 || facts.gateway.urlHost !== 'billing.stripe.com') {
    throw new Error('expected Growth confirm portal 200 billing.stripe.com')
  }

  const [growth] = await sql`select stripe_price_id from cp_plans where id = 'growth'`
  const [scale] = await sql`select stripe_price_id from cp_plans where id = 'scale'`
  if (!growth?.stripe_price_id || !scale?.stripe_price_id) throw new Error('prices missing')

  const sub = await stripe.subscriptions.retrieve(t1e.stripe_subscription_id)
  if (sub.livemode) throw new Error('refusing live-mode sub')
  const periodEnd = sub.items.data[0]?.current_period_end ?? sub.current_period_end
  const periodStart = sub.items.data[0]?.current_period_start ?? sub.current_period_start
  facts.stripeSub = { status: sub.status, livemode: sub.livemode, hasPeriodEnd: Boolean(periodEnd) }

  let scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id ?? null
  if (!scheduleId) {
    const created = await stripe.subscriptionSchedules.create({ from_subscription: t1e.stripe_subscription_id })
    scheduleId = created.id
  }
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)
  const currentItems = (schedule.phases[0]?.items ?? []).map((it) => ({
    price: typeof it.price === 'string' ? it.price : it.price.id,
    quantity: it.quantity ?? 1,
  }))
  await stripe.subscriptionSchedules.update(scheduleId, {
    end_behavior: 'release',
    phases: [
      {
        items: currentItems,
        start_date: schedule.phases[0]?.start_date ?? periodStart,
        end_date: periodEnd,
      },
      {
        items: [{ price: growth.stripe_price_id, quantity: 1 }],
        start_date: periodEnd,
      },
    ],
  })
  const afterSched = await stripe.subscriptionSchedules.retrieve(scheduleId)
  const phasePrices = afterSched.phases.map((p) =>
    p.items.map((it) => (typeof it.price === 'string' ? it.price : it.price.id)).map((id) =>
      id === growth.stripe_price_id ? 'growth' : id === scale.stripe_price_id ? 'scale' : 'other',
    ),
  )
  facts.schedule = {
    status: afterSched.status,
    livemode: afterSched.livemode,
    phaseCount: afterSched.phases.length,
    phasePrices,
  }

  await new Promise((r) => setTimeout(r, 2500))
  const [after] = await sql`
    select i.plan_id, i.pending_plan_id,
           ob.projection->>'effectivePlan' as effective_plan
    from cp_instances i
    left join lateral (
      select projection from cp_billing_projection_outbox
      where instance_id = i.id order by projection_version desc limit 1
    ) ob on true
    where i.id = ${T1E}
  `
  facts.after = {
    t1ePlan: after?.plan_id ?? null,
    t1eEffective: after?.effective_plan ?? null,
    pending: after?.pending_plan_id ?? null,
    t1aPlan: (await sql`select plan_id from cp_instances where id = ${T1A}`)[0]?.plan_id ?? null,
  }
  const n1 = await sql`select count(*)::int as n from cp_instances`
  facts.instanceCount.after = n1[0].n
  facts.ok =
    facts.gateway.status === 200
    && facts.schedule.phaseCount >= 2
    && facts.schedule.phasePrices[0]?.includes('scale')
    && facts.schedule.phasePrices[1]?.includes('growth')
    && facts.after.t1ePlan === 'scale'
    && facts.after.t1eEffective === 'scale'
    && facts.after.t1aPlan === 'pro'
    && facts.instanceCount.before === facts.instanceCount.after
} catch (err) {
  facts.errors.push(err instanceof Error ? err.message : String(err))
  facts.ok = false
} finally {
  await sql.end({ timeout: 5 })
  writeFileSync(OUT, JSON.stringify(facts, null, 2))
  console.log(JSON.stringify(facts, null, 2))
}
if (!facts.ok) process.exitCode = 1
