#!/usr/bin/env bun
/**
 * P4 live critic: projection feature overlay + branding 402.
 * Cookies stay in /tmp. No pay, Neon, wipe, or deploy.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import postgres from '/home/james/quackback-cp/node_modules/postgres/src/index.js'

const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/this-fire/p4-overlay-critic.json'
const T1A = 'inst_01m00kq6cdfzzb19gfjz8pt0s7'
const T7S = 'inst_01m021rrsdfan9v4bzpcec2g3z'
const ORIGIN_A = 'https://south63792f.quackback.co.uk'
const ORIGIN_7 = 'https://sup9ca3a708.quackback.co.uk'
const UA = 'quackback-p4-overlay-critic/2026-08-15'
const EXPECTED_DIGEST = 'sha256:cf2a5726bbad7411bfb7409ddf497af27c156f93cf18bd1be37172d852189132'

const { tenantDirectDsn } = await import(
  '/home/james/quackback-cp/src/lib/server/tenant-bootstrap-orchestrator.ts'
)

function cookieHeader(setCookie) {
  return (setCookie ?? []).map((c) => c.split(';')[0]).filter(Boolean).join('; ')
}

async function http(url, init = {}) {
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(25000),
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
    contentType: res.headers.get('content-type'),
    jsonError: typeof json?.error === 'string' ? json.error : null,
    limit: typeof json?.limit === 'string' ? json.limit : null,
    message: typeof json?.message === 'string' ? json.message : null,
    html: /^\s*</.test(text) || /text\/html/i.test(res.headers.get('content-type') || ''),
    prefix: json ? null : text.slice(0, 80),
    text,
  }
}

const facts = {
  at: new Date().toISOString(),
  unit: 'p4-overlay-critic-4bddea06f',
  expectedDigest: EXPECTED_DIGEST,
  didNotPay: true,
  didNotCreateNeon: true,
  didNotStartCustomDomains: true,
  didNotDeploy: true,
  didNotWipe: true,
  printedCredentials: false,
  errors: [],
}

const cp = postgres(process.env.DATABASE_URL, { max: 2, connect_timeout: 20 })

async function mint(id, origin, tag) {
  const [row] = await cp`select owner_email, plan_id from cp_instances where id = ${id}`
  if (!row?.owner_email) throw new Error(`${tag} owner missing`)
  const dsn = await tenantDirectDsn(id)
  const tenant = postgres(dsn, { max: 1, connect_timeout: 20 })
  try {
    const ott = randomBytes(24).toString('base64url')
    const sessionToken = randomBytes(32).toString('base64url')
    const now = new Date()
    const [user] = await tenant`select id from "user" where lower(email) = ${String(row.owner_email).toLowerCase()} limit 1`
    if (!user) throw new Error(`${tag} user missing`)
    await tenant.begin(async (tx) => {
      await tx`INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at)
        VALUES (${randomUUID()}, ${sessionToken}, ${user.id}, ${new Date(now.getTime() + 7 * 864e5)}, ${now}, ${now})`
      await tx`INSERT INTO verification (id, identifier, value, expires_at)
        VALUES (${randomUUID()}, ${`one-time-token:${ott}`}, ${sessionToken}, ${new Date(now.getTime() + 10 * 60 * 1000)})`
    })
    const url = new URL('/auth/open-handoff', origin)
    url.searchParams.set('ott', ott)
    url.searchParams.set('returnTo', '/admin/settings/general')
    const consume = await fetch(url.toString(), { redirect: 'manual', headers: { 'user-agent': UA } })
    const cookie = cookieHeader(consume.headers.getSetCookie?.() ?? [])
    writeFileSync(`/tmp/p4-${tag}.cookie`, cookie, { mode: 0o600 })
    return {
      tag,
      planId: row.plan_id ?? null,
      consumeStatus: consume.status,
      hasSession: cookie.includes('session_token'),
      cookie,
    }
  } finally {
    await tenant.end({ timeout: 5 })
  }
}

try {
  const t1a = await mint(T1A, ORIGIN_A, 't1a')
  const t7 = await mint(T7S, ORIGIN_7, 't7s')
  facts.sessions = {
    t1a: { planId: t1a.planId, consumeStatus: t1a.consumeStatus, hasSession: t1a.hasSession },
    t7s: { planId: t7.planId, consumeStatus: t7.consumeStatus, hasSession: t7.hasSession },
  }
  if (!t1a.hasSession || !t7.hasSession) throw new Error('session mint failed')

  async function exportProbe(origin, cookie) {
    const res = await http(`${origin}/api/export`, { headers: { cookie, accept: 'text/csv,application/json' } })
    return {
      status: res.status,
      contentType: res.contentType,
      jsonError: res.jsonError,
      limit: res.limit,
      message: res.message,
      csv: /text\/csv/i.test(res.contentType || ''),
    }
  }

  facts.exportT1a = await exportProbe(ORIGIN_A, t1a.cookie)
  facts.exportT7 = await exportProbe(ORIGIN_7, t7.cookie)

  async function integrationsPage(origin, cookie) {
    const res = await http(`${origin}/admin/settings/integrations`, {
      headers: { cookie, accept: 'text/html' },
    })
    const text = res.text || ''
    return {
      status: res.status,
      html: res.html,
      hasUpgradeToPro: /Upgrade to Pro/i.test(text),
      integrationsIsPro: /Integrations is a Pro feature/i.test(text),
      hasCatalogChrome: /Connect external services/i.test(text) && /integration catalog|Slack|GitHub/i.test(text),
      hasDefaultError: /Something went wrong/i.test(text) && /DefaultErrorPage/i.test(text),
    }
  }
  facts.integrationsT1a = await integrationsPage(ORIGIN_A, t1a.cookie)
  facts.integrationsT7 = await integrationsPage(ORIGIN_7, t7.cookie)

  // Branding custom-colour save: find updateThemeFn id from the live chunk.
  const brandingPage = await http(`${ORIGIN_7}/admin/settings/branding`, {
    headers: { cookie: t7.cookie, accept: 'text/html' },
  })
  facts.brandingPageT7 = {
    status: brandingPage.status,
    html: brandingPage.html,
    hasBranding: /Branding/i.test(brandingPage.text || ''),
  }
  const asset = (brandingPage.text || '').match(/src="(\/assets\/settings\.branding-[^"]+\.js)"/)
  facts.brandingChunk = asset ? asset[1] : null
  let themeFnId = null
  if (asset) {
    const js = await fetch(new URL(asset[1], ORIGIN_7), { headers: { 'user-agent': UA } }).then((r) => r.text())
    const hit = js.match(/updateThemeFn[^]{0,200}serverFnId:"([^"]+)"/) || js.match(/serverFnId:"([^"]+)"[^]{0,80}brandingConfig/)
    themeFnId = hit?.[1] ?? null
    facts.themeFnIdPresent = Boolean(themeFnId)
  }

  if (themeFnId) {
    const brand = await fetch(new URL(`/_serverFn/${themeFnId}`, ORIGIN_7), {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: t7.cookie,
        origin: ORIGIN_7,
        'content-type': 'application/json',
        'x-tsr-serverFn': 'true',
        accept: 'application/json',
        'user-agent': UA,
      },
      body: JSON.stringify({ data: { brandingConfig: { light: { primary: 'oklch(0.5 0.1 200)' } } } }),
      signal: AbortSignal.timeout(25000),
    })
    const text = await brand.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}
    facts.brandingSaveT7 = {
      status: brand.status,
      jsonError: typeof json?.error === 'string' ? json.error : null,
      limit: typeof json?.limit === 'string' ? json.limit : null,
      message: typeof json?.message === 'string' ? json.message : json?.result?.message ?? null,
      looks500: brand.status >= 500,
      looks402: brand.status === 402 || json?.error === 'tier_limit_exceeded',
    }
  }

  const t1aProExportOk = facts.exportT1a.status === 200 && facts.exportT1a.csv === true
  const t7Export402 =
    facts.exportT7.status === 402
    && facts.exportT7.jsonError === 'tier_limit_exceeded'
    && facts.exportT7.limit === 'features.analyticsExports'
  const t7IntegrationsOffer = facts.integrationsT7.status === 200 && facts.integrationsT7.integrationsIsPro === true
  const t1aIntegrationsOpen =
    facts.integrationsT1a.status === 200 && facts.integrationsT1a.integrationsIsPro === false
  const brandingNot500 = facts.brandingSaveT7 ? facts.brandingSaveT7.looks500 === false : false
  const branding402 = facts.brandingSaveT7?.looks402 === true

  facts.ok =
    t1a.hasSession
    && t7.hasSession
    && t1aProExportOk
    && t7Export402
    && t7IntegrationsOffer
    && t1aIntegrationsOpen
    && branding402
    && brandingNot500
} catch (err) {
  facts.errors.push(err instanceof Error ? err.message : String(err))
  facts.ok = false
} finally {
  await cp.end({ timeout: 5 })
  writeFileSync(OUT, JSON.stringify(facts, null, 2))
  console.log(JSON.stringify(facts, null, 2))
}
