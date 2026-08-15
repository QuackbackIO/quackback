#!/usr/bin/env bun
import { createHmac, hkdfSync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

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
const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/this-fire/t1e-paid-isolation.json'

function derive(root, id) {
  const secret = Buffer.from(
    hkdfSync('sha256', root, 'quackback-fleet-root-v1', `quackback:fleet:derive:v1:${id}:app-secrets`, 32),
  ).toString('base64url')
  return `qbint_${createHmac('sha256', secret).update('quackback-control-plane-credential-v1').digest('base64url')}`
}

async function post(token, body) {
  const res = await fetch(`${CP}/api/v1/internal/billing/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return {
    status: res.status,
    error: typeof json?.error === 'string' ? json.error : null,
    urlHost: typeof json?.url === 'string' ? new URL(json.url).hostname : null,
  }
}

const facts = { at: new Date().toISOString(), errors: [] }
try {
  const root = process.env.QUACKBACK_FLEET_ROOT_KEY
  if (!root) throw new Error('root missing')
  const a = derive(root, T1A)
  const e = derive(root, T1E)
  facts.t1eSameGrowth = await post(e, { action: 'checkout', planId: 'growth', billingPeriod: 'monthly' })
  facts.t1ePortal = await post(e, { action: 'portal' })
  facts.t1eScale = await post(e, { action: 'checkout', planId: 'scale', billingPeriod: 'monthly' })
  facts.t1aSamePro = await post(a, { action: 'checkout', planId: 'pro', billingPeriod: 'monthly' })
  facts.ok =
    facts.t1eSameGrowth.status === 409 &&
    facts.t1eSameGrowth.error === 'already_on_plan' &&
    facts.t1ePortal.status === 200 &&
    facts.t1ePortal.urlHost === 'billing.stripe.com' &&
    facts.t1eScale.status === 200 &&
    facts.t1eScale.urlHost === 'billing.stripe.com' &&
    facts.t1aSamePro.status === 409 &&
    facts.t1aSamePro.error === 'already_on_plan'
} catch (err) {
  facts.errors.push(err instanceof Error ? err.message : String(err))
  facts.ok = false
}
writeFileSync(OUT, JSON.stringify(facts, null, 2))
console.log(JSON.stringify(facts, null, 2))
if (!facts.ok) process.exitCode = 1
