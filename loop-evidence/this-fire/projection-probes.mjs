#!/usr/bin/env bun
/**
 * Live replay / stale-version / paid-vs-trial-clock probes on t1e.
 * Does not apply a newer projection, pay, or create Neon.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import postgres from '/home/james/quackback-cp/node_modules/postgres/src/index.js'

const envFile = process.env.PROBE_ENV_FILE
if (envFile) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1)
  }
}

const T1E = 'inst_01m00kprbrfzzb19f490wga8q2'
const ORIGIN = 'https://northfa99f0.quackback.co.uk'
const UA = 'quackback-projection-probes/2026-08-15'
const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/this-fire/projection-probes.json'

const facts = {
  at: new Date().toISOString(),
  unit: 'projection-replay-stale-expiry',
  didNotPay: true,
  didNotCreateNeon: true,
  didNotApplyNewerProjection: true,
  errors: [],
}

try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL unset')
  if (!process.env.BILLING_PROJECTION_PRIVATE_KEY) throw new Error('signing key unset')
  const stripeKey = process.env.STRIPE_SECRET_KEY || ''
  if (stripeKey && !stripeKey.startsWith('sk_test_')) throw new Error('refusing non-test stripe key')
  facts.stripeKeyPrefix = stripeKey ? stripeKey.slice(0, 8) : null

  const { signBillingProjection } = await import(
    '/home/james/quackback-cp/src/lib/server/billing/projection.ts'
  )
  const { tenantDirectDsn } = await import(
    '/home/james/quackback-cp/src/lib/server/tenant-bootstrap-orchestrator.ts'
  )
  const cp = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 20 })
  try {
    const before = await cp`select count(*)::int as n from cp_instances`
    facts.instanceCount = { before: before[0].n }
    const dsn = await tenantDirectDsn(T1E)
    const tenant = postgres(dsn, { max: 1, connect_timeout: 20 })
    try {
      const [row] = await tenant`select cloud from settings limit 1`
      const cloud = row?.cloud && typeof row.cloud === 'object' ? row.cloud : JSON.parse(row?.cloud || '{}')
      const proj = cloud.projection
      facts.before = {
        version: proj?.version ?? null,
        effectivePlan: proj?.effectivePlan ?? null,
        subscriptionStatus: proj?.subscriptionStatus ?? null,
        trialExpiresAt: proj?.trialExpiresAt ?? null,
        maxBoards: proj?.planLimits?.maxBoards ?? null,
      }
      if (!proj || proj.effectivePlan !== 'growth') throw new Error('t1e projection is not growth')

      async function postToken(token) {
        const res = await fetch(`${ORIGIN}/api/internal/billing-projection`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'user-agent': UA },
          body: JSON.stringify({ token }),
        })
        const json = await res.json().catch(() => null)
        return { status: res.status, error: typeof json?.error === 'string' ? json.error : null }
      }

      const replayToken = await signBillingProjection(T1E, proj)
      facts.replay = await postToken(replayToken)
      const stale = { ...proj, version: Number(proj.version) - 1 }
      const staleToken = await signBillingProjection(T1E, stale)
      facts.stale = await postToken(staleToken)
      facts.garbage = await postToken('not-a-jwt')

      const [afterRow] = await tenant`select cloud from settings limit 1`
      const afterCloud =
        afterRow?.cloud && typeof afterRow.cloud === 'object'
          ? afterRow.cloud
          : JSON.parse(afterRow?.cloud || '{}')
      const after = afterCloud.projection
      facts.after = {
        version: after?.version ?? null,
        effectivePlan: after?.effectivePlan ?? null,
        subscriptionStatus: after?.subscriptionStatus ?? null,
        maxBoards: after?.planLimits?.maxBoards ?? null,
      }
      facts.paidSurvivesTrialClock =
        after?.effectivePlan === 'growth' &&
        after?.subscriptionStatus === 'active' &&
        typeof after?.trialExpiresAt === 'string'
      facts.versionUnchanged = after?.version === proj.version
    } finally {
      await tenant.end({ timeout: 5 })
    }

    const health = await fetch(`${ORIGIN}/api/health/ready`)
    const pub = await fetch(`${ORIGIN}/?sort=trending`, { redirect: 'manual' })
    facts.productDuringCachedProjection = {
      ready: health.status,
      publicBoard: pub.status,
    }
    const afterCount = await cp`select count(*)::int as n from cp_instances`
    facts.instanceCount.after = afterCount[0].n
    facts.ok =
      (facts.replay.status === 204 || facts.replay.status === 200) &&
      facts.stale.status === 409 &&
      facts.stale.error === 'stale_version' &&
      facts.garbage.status === 401 &&
      facts.garbage.error === 'invalid_projection' &&
      facts.versionUnchanged === true &&
      facts.paidSurvivesTrialClock === true &&
      facts.productDuringCachedProjection.ready === 200 &&
      facts.productDuringCachedProjection.publicBoard === 200 &&
      facts.instanceCount.after === facts.instanceCount.before
  } finally {
    await cp.end({ timeout: 2 })
  }
} catch (err) {
  facts.errors.push(err instanceof Error ? err.message : String(err))
  facts.ok = false
}

writeFileSync(OUT, JSON.stringify(facts, null, 2))
console.log(JSON.stringify(facts, null, 2))
if (!facts.ok) process.exitCode = 1
