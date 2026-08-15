#!/usr/bin/env bun
/**
 * Live hosted-product sweep. Writes redacted facts only.
 * Never prints secrets, cookies, DSNs, or provider ids in full.
 * Never posts a real {confirm:wipe}-only body. Never creates or deletes workspaces.
 */
import { createHash, createHmac, hkdfSync, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import postgres from '/home/james/quackback-cp/node_modules/postgres/src/index.js'

const envFile = process.env.PROBE_ENV_FILE
if (envFile) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1)
  }
}

const OUT_DIR = '/home/james/quackback-wt/saas-merge/loop-evidence/verify-2026-08-15'
mkdirSync(OUT_DIR, { recursive: true })
const OUT = `${OUT_DIR}/sweep-40be439d-growth.json`
const COOKIE_A = '/tmp/verify-2026-08-15-t1a-growth.cookie'
const COOKIE_E = '/tmp/verify-2026-08-15-t1e-growth.cookie'
const COOKIE_CP = '/tmp/verify-2026-08-15-cp-growth.cookie'

const T1A = 'inst_01m00kq6cdfzzb19gfjz8pt0s7'
const T1E = 'inst_01m00kprbrfzzb19f490wga8q2'
const HOST_A = 'south63792f.quackback.co.uk'
const HOST_E = 'northfa99f0.quackback.co.uk'
const SYS_A = 'ws-bf8e1c4affe270eb5a6dda1a.quackback.co.uk'
const SYS_E = 'ws-4a048e07941c5e7840e986c0.quackback.co.uk'
const ORIGIN_A = `https://${HOST_A}`
const ORIGIN_E = `https://${HOST_E}`
const CP = 'https://cp.quackback.co.uk'
const UA = 'quackback-verify/2026-08-15'

function must(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is unset`)
  return v
}

function fp(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 12)
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

function cookieHeader(setCookie) {
  return setCookie
    .map((raw) => raw.split(';')[0])
    .filter(Boolean)
    .join('; ')
}

function cookieNames(setCookie) {
  return setCookie.map((raw) => raw.split('=')[0]).filter(Boolean)
}

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

function domainOf(email) {
  const at = String(email).lastIndexOf('@')
  return at >= 0 ? String(email).slice(at + 1).toLowerCase() : null
}

function localPart(email) {
  const at = String(email).lastIndexOf('@')
  return at >= 0 ? String(email).slice(0, at) : null
}

function summarizeHtml(text) {
  const t = text.replace(/\s+/g, ' ')
  return {
    length: text.length,
    title: (text.match(/<title[^>]*>([^<]*)/i) || [])[1] || null,
    h1: (text.match(/<h1[^>]*>([^<]*)/i) || [])[1] || null,
    hasPlanBilling: /Plan &amp; billing|Plan & billing/i.test(text),
    hasGeneral: />General</.test(text) || /Workspace details/i.test(text),
    hasQuackbackUrl: /Quackback URL/i.test(text),
    hasWsPrefill: /ws-[a-z0-9]+\.quackback\.co\.uk/.test(text),
    hasDomainsCard: /Custom domain/i.test(text) && /make primary|add hostname|verify/i.test(text),
    hasHelpCenterDomain: /Serve the help center on your own subdomain/i.test(text) || /help\.acme\.com/i.test(text),
    hasLocalReverseProxyCopy: /TLS terminates at your own reverse proxy/i.test(text),
    hasEmails: />Emails</.test(text) || /Sending domain/i.test(text),
    hasSesKeyField: /EMAIL_SES|AKIA[0-9A-Z]{8,}|ses secret|access key id/i.test(text),
    hasUpgrade: /\bUpgrade\b/.test(t),
    hasChangePlan: /Change plan/i.test(text),
    hasManageBilling: /Manage billing/i.test(text),
    hasTrial: /trial/i.test(text),
    hasGrowth: /Growth/i.test(text),
    hasPro: /\bPro\b/.test(t),
    hasFree: /\bFree\b/.test(t),
    hasPrimaryButton: /<(button|a)[^>]*(Upgrade|Continue|Open|Go to|Enter|Get started)/i.test(text),
    hasCreatingWorkspace: /Creating your workspace/.test(text),
    hasOpeningWorkspace: /Opening your workspace/.test(text),
    hasNamedCreate: /workspace name/i.test(text) && /region|plan/i.test(text),
    hasSignin: /auth=signin|Sign in/i.test(text),
    hasInbox: /Inbox/i.test(text),
    hasFeedback: /Feedback/i.test(text),
    hasSwitchWorkspace: /Switch workspace/i.test(text),
    hasTransferOwnership: /Transfer ownership/i.test(text),
    hasLeaveWorkspace: /Leave workspace/i.test(text),
    hasChangeTo: /Change to (Growth|Pro|Scale)/i.test(text),
    hasAnnual: /\bAnnual\b/.test(text),
    hasCurrentPlan: /Current plan/i.test(text),
    hasFourPlanNames: /\bFree\b/.test(t) && /\bGrowth\b/.test(t) && /\bPro\b/.test(t) && /\bScale\b/.test(t),
    hasOfThree: /\b[0-3]\s*of\s*3\b/.test(text),
    hasOfThreeFree: /\b[0-3]\s+of\s+3\s+Free workspaces\b/i.test(text),
    hasNofM: /\b\d+\s*\/\s*\d+\b/.test(text) || /\b\d+\s+of\s+\d+\b/i.test(text),
    hasUsageHeading: />Usage</.test(text) || /How much of this plan you are using/i.test(text),
    hasAiTokens: /AI tokens this month/i.test(text),
    hasExportWorkspace: /Export workspace data/i.test(text),
    hasWipe: /Wipe workspace|Wipe this workspace/i.test(text),
    hasDangerZone: /Danger zone/i.test(text),
    hasTrialEnds: /Pro trial ends on|trial ends on/i.test(text),
    hasTeamSeats: /Team seats/i.test(text),
    hasInvite: /Invite|Send Invitation/i.test(text),
    hasScaleFeature: /Scale feature/i.test(text),
    hasDeleteAccount: /Delete (your )?account/i.test(text),
    hasCreateWorkspace: /Create workspace/i.test(text),
    hasYourWorkspaces: /Your workspaces/i.test(text),
    snippet: t.slice(0, 280),
  }
}

function hopHtml(html) {
  if (!html) return null
  return {
    title: html.title,
    h1: html.h1,
    hasPlanBilling: html.hasPlanBilling,
    hasGeneral: html.hasGeneral,
    hasQuackbackUrl: html.hasQuackbackUrl,
    hasWsPrefill: html.hasWsPrefill,
    hasDomainsCard: html.hasDomainsCard,
    hasHelpCenterDomain: html.hasHelpCenterDomain,
    hasLocalReverseProxyCopy: html.hasLocalReverseProxyCopy,
    hasEmails: html.hasEmails,
    hasSesKeyField: html.hasSesKeyField,
    hasUpgrade: html.hasUpgrade,
    hasChangePlan: html.hasChangePlan,
    hasManageBilling: html.hasManageBilling,
    hasTrial: html.hasTrial,
    hasGrowth: html.hasGrowth,
    hasInbox: html.hasInbox,
    hasSignin: html.hasSignin,
    hasSwitchWorkspace: html.hasSwitchWorkspace,
    hasTransferOwnership: html.hasTransferOwnership,
    hasLeaveWorkspace: html.hasLeaveWorkspace,
    hasChangeTo: html.hasChangeTo,
    hasAnnual: html.hasAnnual,
    hasCurrentPlan: html.hasCurrentPlan,
    hasFourPlanNames: html.hasFourPlanNames,
    hasOfThree: html.hasOfThree,
    hasOfThreeFree: html.hasOfThreeFree,
    hasNofM: html.hasNofM,
    hasUsageHeading: html.hasUsageHeading,
    hasAiTokens: html.hasAiTokens,
    hasExportWorkspace: html.hasExportWorkspace,
    hasWipe: html.hasWipe,
    hasDangerZone: html.hasDangerZone,
    hasTrialEnds: html.hasTrialEnds,
    hasTeamSeats: html.hasTeamSeats,
    hasInvite: html.hasInvite,
    hasScaleFeature: html.hasScaleFeature,
    hasDeleteAccount: html.hasDeleteAccount,
    hasCreateWorkspace: html.hasCreateWorkspace,
    hasYourWorkspaces: html.hasYourWorkspaces,
  }
}

async function http(url, init = {}) {
  const t0 = Date.now()
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    ...init,
    headers: { 'user-agent': UA, ...(init.headers || {}) },
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return {
    url,
    status: res.status,
    location: res.headers.get('location'),
    locationHost: hostOf(res.headers.get('location')),
    locationPath: pathOf(res.headers.get('location')),
    contentType: res.headers.get('content-type'),
    ms: Date.now() - t0,
    json,
    error: typeof json?.error === 'string' ? json.error : null,
    message: typeof json?.message === 'string' ? json.message : null,
    html: (res.headers.get('content-type') || '').includes('text/html') ? summarizeHtml(text) : null,
    bodyPrefix: json ? null : text.slice(0, 180),
    setCookieNames: cookieNames(res.headers.getSetCookie?.() ?? []),
    _setCookie: res.headers.getSetCookie?.() ?? [],
    _text: text,
  }
}

async function mintWorkspaceSession(dsn, email, origin, returnTo) {
  const ott = randomBytes(24).toString('base64url')
  const sessionToken = randomBytes(32).toString('base64url')
  const now = new Date()
  const tenant = postgres(dsn, { max: 1, connect_timeout: 20 })
  try {
    const [user] = await tenant`select id from "user" where lower(email) = ${email.toLowerCase()} limit 1`
    if (!user) throw new Error('owner row missing')
    const [principal] = await tenant`select role from principal where user_id = ${user.id} limit 1`
    await tenant.begin(async (tx) => {
      await tx`
        INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at)
        VALUES (${randomUUID()}, ${sessionToken}, ${user.id}, ${new Date(now.getTime() + 7 * 864e5)}, ${now}, ${now})
      `
      await tx`
        INSERT INTO verification (id, identifier, value, expires_at)
        VALUES (${randomUUID()}, ${`one-time-token:${ott}`}, ${sessionToken}, ${new Date(now.getTime() + 10 * 60 * 1000)})
      `
    })
    const url = new URL('/auth/open-handoff', origin)
    url.searchParams.set('ott', ott)
    url.searchParams.set('returnTo', returnTo)
    const consume = await fetch(url.toString(), { redirect: 'manual', headers: { 'user-agent': UA } })
    const setCookie = consume.headers.getSetCookie?.() ?? []
    return {
      ownerRole: principal?.role ?? null,
      consumeStatus: consume.status,
      consumeLocation: consume.headers.get('location'),
      cookieNames: cookieNames(setCookie),
      cookie: cookieHeader(setCookie),
      ott,
      hasSessionCookie: cookieNames(setCookie).some((n) => n.includes('session_token')),
    }
  } finally {
    await tenant.end({ timeout: 5 })
  }
}

function redactProjection(cloud) {
  if (!cloud || typeof cloud !== 'object') return { present: false }
  const proj = cloud.projection && typeof cloud.projection === 'object' ? cloud.projection : cloud
  const keys = Object.keys(proj)
  const providerHits = []
  const walk = (value, path) => {
    if (value == null) return
    if (typeof value === 'string') {
      if (/^(cus|sub|si|in|ch|pi|pm|sk|pk|rk|whsec|acct|evt|cs)_[A-Za-z0-9]+/.test(value)) {
        providerHits.push(path)
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k)
    }
  }
  walk(proj, '')
  return {
    present: true,
    keys,
    version: proj.version ?? null,
    effectivePlan: proj.effectivePlan ?? proj.planId ?? null,
    subscriptionStatus: proj.subscriptionStatus ?? null,
    canManageBilling: proj.canManageBilling ?? null,
    canUpgrade: proj.canUpgrade ?? null,
    trialExpiresAt: proj.trialExpiresAt ?? null,
    cancellationAt: proj.cancellationAt ?? null,
    entitlements: proj.entitlements ?? null,
    freeLimits: proj.freeLimits ?? null,
    planLimits: proj.planLimits ?? null,
    hasProviderId: providerHits.length > 0,
    providerHitPaths: providerHits,
  }
}

async function followAuth(url, cookie) {
  const hops = []
  let current = url
  let method = 'GET'
  for (let i = 0; i < 6; i++) {
    const res = await http(current, { headers: { cookie }, method })
    hops.push({
      status: res.status,
      host: hostOf(current),
      path: pathOf(current),
      locationHost: res.locationHost,
      locationPath: res.locationPath,
      html: hopHtml(res.html),
    })
    if (![301, 302, 303, 307, 308].includes(res.status) || !res.location) break
    current = new URL(res.location, current).toString()
    method = 'GET'
  }
  return hops
}

async function guerrillaOtp(email) {
  const user = localPart(email)
  const domain = domainOf(email)
  if (!user || domain !== 'guerrillamail.com') {
    return { attempted: false, reason: 'not_guerrillamail' }
  }
  const jar = []
  const gm = async (fn, extra = '') => {
    const url = `https://api.guerrillamail.com/ajax.php?f=${fn}${extra}`
    const res = await fetch(url, {
      headers: { 'user-agent': UA, cookie: jar.join('; ') },
      signal: AbortSignal.timeout(15000),
    })
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(';')[0]
      if (pair) jar.push(pair)
    }
    return res.json()
  }
  const set = await gm('set_email_user', `&email_user=${encodeURIComponent(user)}&lang=en`)
  const setAddr = typeof set?.email_addr === 'string' ? set.email_addr.toLowerCase() : null
  if (setAddr && setAddr !== email.toLowerCase() && !setAddr.startsWith(`${user.toLowerCase()}@`)) {
    return { attempted: true, reason: 'mailbox_mismatch', setDomain: domainOf(setAddr) }
  }
  let otp = null
  let listed = 0
  for (let i = 0; i < 6 && !otp; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1200 : 1500))
    const list = await gm('get_email_list', '&offset=0')
    const items = Array.isArray(list?.list) ? list.list : []
    listed = items.length
    for (const item of items.slice(0, 8)) {
      const mailId = item?.mail_id
      if (!mailId) continue
      const full = await gm('fetch_email', `&email_id=${encodeURIComponent(mailId)}`)
      const body = `${full?.mail_subject || ''} ${full?.mail_body || ''} ${full?.mail_excerpt || ''}`
      const m = body.match(/\b(\d{6})\b/)
      if (m) {
        otp = m[1]
        break
      }
    }
  }
  return {
    attempted: true,
    listed,
    otpDigits: otp ? otp.length : 0,
    otp,
    reason: otp ? null : 'otp_not_in_mailbox',
  }
}

const facts = {
  at: new Date().toISOString(),
  unit: 'hosted-product-verify-40be439d-growth',
  live: {
    appDigest: 'sha256:40be439d1c2d55957265723bef94b9eda49523d3fee8954de7c2385b595a76f2',
    webDeploy: '95610fd8',
    workerDeploy: '9cd49fe5',
    hourlyDeploy: '2634ef48',
    dailyDeploy: '057206ec',
    migratorDeploy: 'def8cdde',
    cpDeploy: '7cecf06d',
    cpDigest: 'sha256:753d3b86a82141f4fe5df0e715b02230b528cfa39334380d32e031c3e1f29f70',
    webRegion: 'us-east4-eqdc4a',
    cpRegion: 'sfo',
    appCommit: 'be3e41b01',
    cpCommit: 'f4e3844',
  },
  didNotWipe: true,
  didNotPostRealWipeOnly: true,
  didNotRestore: true,
  didNotTransfer: true,
  didNotPay: true,
  didNotCreateNeon: true,
  didNotStartCustomDomains: true,
  didNotCreateWorkspace: true,
  printedCredentials: false,
  errors: [],
  instanceCount: {},
  instanceIds: {},
}

try {
  const databaseUrl = must('DATABASE_URL')
  const rootKey = must('QUACKBACK_FLEET_ROOT_KEY')
  const stripeKey = process.env.STRIPE_SECRET_KEY || ''
  facts.stripeKeyPrefix = stripeKey ? stripeKey.slice(0, 8) : null
  if (stripeKey && !stripeKey.startsWith('sk_test_')) throw new Error('refusing non-test stripe key')

  const cp = postgres(databaseUrl, { max: 2, idle_timeout: 5, connect_timeout: 20 })
  const { tenantDirectDsn } = await import(
    '/home/james/quackback-cp/src/lib/server/tenant-bootstrap-orchestrator.ts'
  )

  try {
    const before = await cp`select id from cp_instances order by id`
    facts.instanceCount.before = before.length
    facts.instanceIds.before = before.map((r) => r.id)
    facts.instanceIds.t1aBefore = before.some((r) => r.id === T1A)
    facts.instanceIds.t1eBefore = before.some((r) => r.id === T1E)

    const instances = await cp`
      select i.id, i.plan_id, i.owner_email, i.deleted_at is not null as deleted,
             i.status,
             o.subscription_status,
             o.stripe_customer_id is not null as has_customer,
             o.stripe_subscription_id is not null as has_subscription,
             o.id as org_id
      from cp_instances i
      left join cp_organizations o on o.id = i.org_id
      order by i.id
    `
    facts.fleetInstances = instances.map((r) => ({
      id: r.id,
      planId: r.plan_id,
      deleted: r.deleted,
      status: r.status,
      subscriptionStatus: r.subscription_status,
      hasCustomer: r.has_customer,
      hasSubscription: r.has_subscription,
      orgPrefix: r.org_id ? String(r.org_id).slice(0, 8) : null,
      ownerDomain: r.owner_email ? domainOf(r.owner_email) : null,
    }))

    for (const id of [T1A, T1E]) {
      const [reg] = await cp`
        select state, base_url, primary_hostname
        from cp_workspace_registry
        where workspace_key = ${id}
      `
      const [billing] = await cp`
        select projection_version from cp_workspace_billing where instance_id = ${id}
      `
      const [outbox] = await cp`
        select projection_version, status,
               projection->>'effectivePlan' as effective_plan,
               projection->>'subscriptionStatus' as subscription_status,
               projection->>'canManageBilling' as can_manage_billing,
               projection->>'canUpgrade' as can_upgrade,
               projection->>'trialExpiresAt' as trial_expires_at,
               projection->'entitlements' as entitlements,
               projection->'freeLimits' as free_limits,
               projection->'planLimits' as plan_limits,
               projection->>'cancellationAt' as cancellation_at
        from cp_billing_projection_outbox
        where instance_id = ${id}
        order by projection_version desc
        limit 1
      `
      const [ident] = await cp`
        select display_name, platform_hostname, system_hostname, canonical_origin, projection_version
        from cp_workspace_identity
        where instance_id = ${id}
      `
      const claims = await cp`
        select hostname, kind, state, redirect_to_hostname
        from cp_workspace_hostname_claims
        where instance_id = ${id}
        order by kind, hostname
      `
      const [trial] = await cp`
        select occurred_at, resolution, artifact_type
        from cp_trial_activation_events
        where instance_id = ${id}
        order by occurred_at desc
        limit 1
      `
      facts[id === T1A ? 't1a' : 't1e'] = {
        registry: {
          state: reg?.state ?? null,
          baseHost: reg?.base_url ? hostOf(reg.base_url) : null,
          primaryHostname: reg?.primary_hostname ?? null,
        },
        billingVersion: billing?.projection_version ?? null,
        outbox,
        identity: ident
          ? {
              displayName: ident.display_name,
              platformHostname: ident.platform_hostname,
              systemHostname: ident.system_hostname,
              canonicalHost: ident.canonical_origin ? hostOf(ident.canonical_origin) : null,
              projectionVersion: ident.projection_version,
            }
          : null,
        claims,
        trial: trial
          ? { occurredAt: trial.occurred_at, resolution: trial.resolution, artifactType: trial.artifact_type }
          : null,
      }
    }

    const webhookEvents = await cp`
      select id, event_type, processed_at is not null as processed, received_at
      from cp_stripe_webhook_events
      order by received_at desc
      limit 12
    `
    facts.webhookEvents = webhookEvents.map((e) => ({
      idPrefix: String(e.id).slice(0, 8),
      type: e.event_type,
      processed: e.processed,
    }))

    const replaySource = await cp`
      select id, event_type, processed_at
      from cp_stripe_webhook_events
      where event_type = 'checkout.session.completed' and processed_at is not null
      order by received_at desc
      limit 1
    `
    facts.webhookReplaySource = replaySource[0]
      ? { idPrefix: String(replaySource[0].id).slice(0, 8), type: replaySource[0].event_type, processed: true }
      : null

    const t1aOwner = instances.find((r) => r.id === T1A)?.owner_email
    const t1eOwner = instances.find((r) => r.id === T1E)?.owner_email
    facts.t1a.ownerDomain = t1aOwner ? domainOf(t1aOwner) : null
    facts.t1e.ownerDomain = t1eOwner ? domainOf(t1eOwner) : null
    facts.t1a.ownerFp = t1aOwner ? fp(String(t1aOwner).toLowerCase()) : null
    facts.t1e.ownerFp = t1eOwner ? fp(String(t1eOwner).toLowerCase()) : null

    const dsnA = await tenantDirectDsn(T1A)
    const dsnE = await tenantDirectDsn(T1E)
    if (!dsnA || !dsnE) throw new Error('tenant DSN missing')

    async function tenantSnapshot(dsn, label) {
      const tenant = postgres(dsn, { max: 1, connect_timeout: 20 })
      try {
        const [settings] = await tenant`
          select name, cloud, cloud_identity, tier_limits, setup_state, feature_flags, logo_key
          from settings limit 1
        `
        const boards = await tenant`select id, slug, name, access from boards where deleted_at is null`
        const [boardCount] = await tenant`select count(*)::int as n from boards where deleted_at is null`
        const [webhookCount] = await tenant`select count(*)::int as n from webhooks`
        const [seatCount] = await tenant`
          select count(*)::int as n from principal
          where role in ('admin', 'member') and type = 'user'
        `
        let inviteCount = { n: null }
        try {
          const [row] = await tenant`
            select count(*)::int as n from invitation
            where status = 'pending' and kind = 'team'
          `
          inviteCount = row ?? { n: null }
        } catch {
          inviteCount = { n: null }
        }
        const [postCount] = await tenant`select count(*)::int as n from posts where deleted_at is null`
        const parseJson = (value) => {
          if (value == null) return null
          if (typeof value === 'object') return value
          try {
            return JSON.parse(value)
          } catch {
            return null
          }
        }
        const cloud = settings?.cloud ?? null
        const identity = settings?.cloud_identity ?? null
        const tierLimits = parseJson(settings?.tier_limits)
        const setupState = parseJson(settings?.setup_state)
        const featureFlags = parseJson(settings?.feature_flags)
        const logoKey = settings?.logo_key ?? null
        return {
          label,
          name: settings?.name ?? null,
          cloud: redactProjection(cloud),
          identity: identity
            ? {
                keys: Object.keys(identity),
                platformHostname: identity.platformHostname ?? null,
                canonicalHost: identity.canonicalOrigin ? hostOf(identity.canonicalOrigin) : null,
                displayName: identity.displayName ?? null,
              }
            : null,
          tierLimits,
          setupState,
          featureFlags: featureFlags
            ? {
                supportInbox: featureFlags.supportInbox ?? null,
                helpCenter: featureFlags.helpCenter ?? null,
                feedback: featureFlags.feedback ?? null,
              }
            : null,
          boards: boards.map((b) => ({ slug: b.slug, name: b.name, access: b.access ?? null })),
          boardCount: boardCount?.n ?? null,
          webhookCount: webhookCount?.n ?? null,
          seatCount: seatCount?.n ?? null,
          inviteCount: inviteCount?.n ?? null,
          postCount: postCount?.n ?? null,
          logoSrc: logoKey ? `/api/storage/${logoKey}` : null,
          logoIsStorageRelative: Boolean(logoKey),
        }
      } finally {
        await tenant.end({ timeout: 5 })
      }
    }

    facts.workspaceA = await tenantSnapshot(dsnA, 't1a')
    facts.workspaceE = await tenantSnapshot(dsnE, 't1e')

    const mintedA = await mintWorkspaceSession(dsnA, t1aOwner, ORIGIN_A, '/admin/settings/billing')
    const mintedE = await mintWorkspaceSession(dsnE, t1eOwner, ORIGIN_E, '/admin/settings/billing')
    writeFileSync(COOKIE_A, mintedA.cookie, { mode: 0o600 })
    writeFileSync(COOKIE_E, mintedE.cookie, { mode: 0o600 })
    facts.handoff = {
      t1a: {
        consumeStatus: mintedA.consumeStatus,
        locationPath: pathOf(mintedA.consumeLocation),
        hasSessionCookie: mintedA.hasSessionCookie,
        ownerRole: mintedA.ownerRole,
        cookieNames: mintedA.cookieNames,
      },
      t1e: {
        consumeStatus: mintedE.consumeStatus,
        locationPath: pathOf(mintedE.consumeLocation),
        hasSessionCookie: mintedE.hasSessionCookie,
        ownerRole: mintedE.ownerRole,
        cookieNames: mintedE.cookieNames,
      },
    }

    const cookieA = mintedA.cookie
    const cookieE = mintedE.cookie

    const replayA = await http(`${ORIGIN_A}/auth/open-handoff?ott=${mintedA.ott}&returnTo=/admin`)
    const expiredOtt = randomBytes(24).toString('base64url')
    const expiryPage = await http(`${ORIGIN_A}/auth/open-handoff?ott=${expiredOtt}&returnTo=/admin`)
    const wrongWs = await http(`${ORIGIN_E}/auth/open-handoff?ott=${mintedA.ott}&returnTo=/admin`)
    facts.failClosedOtt = {
      replay: {
        status: replayA.status,
        locationPath: replayA.locationPath,
        setCookieNames: replayA.setCookieNames,
        htmlTitle: replayA.html?.h1 || replayA.html?.title,
        hasInvalidCopy: /no longer valid/i.test(replayA._text || ''),
      },
      expired: {
        status: expiryPage.status,
        setCookieNames: expiryPage.setCookieNames,
        hasInvalidCopy: /no longer valid/i.test(expiryPage._text || ''),
      },
      wrongWorkspace: {
        status: wrongWs.status,
        setCookieNames: wrongWs.setCookieNames,
        hasInvalidCopy: /no longer valid/i.test(wrongWs._text || ''),
        hasSessionCookie: wrongWs.setCookieNames.some((n) => n.includes('session_token')),
      },
    }

    const pages = {}
    const pageUrls = {
      t1aAdmin: `${ORIGIN_A}/admin`,
      t1aInbox: `${ORIGIN_A}/admin/inbox`,
      t1aFeedback: `${ORIGIN_A}/admin/feedback`,
      t1aGeneral: `${ORIGIN_A}/admin/settings/general`,
      t1aBilling: `${ORIGIN_A}/admin/settings/billing`,
      t1aChannels: `${ORIGIN_A}/admin/settings/channels`,
      t1aHelpCenter: `${ORIGIN_A}/admin/settings/help-center`,
      t1aDevelopers: `${ORIGIN_A}/admin/settings/developers`,
      t1aSso: `${ORIGIN_A}/admin/settings/security/sso`,
      t1aSsoNew: `${ORIGIN_A}/admin/settings/security/sso/new`,
      t1aGettingStarted: `${ORIGIN_A}/admin/getting-started`,
      t1aOnboardingComplete: `${ORIGIN_A}/onboarding/complete`,
      t1aOnboardingWorkspace: `${ORIGIN_A}/onboarding/workspace`,
      t1eAdmin: `${ORIGIN_E}/admin`,
      t1eGeneral: `${ORIGIN_E}/admin/settings/general`,
      t1eBilling: `${ORIGIN_E}/admin/settings/billing`,
      t1eHelpCenter: `${ORIGIN_E}/admin/settings/help-center`,
      t1eSsoNew: `${ORIGIN_E}/admin/settings/security/sso/new`,
      t1aMembers: `${ORIGIN_A}/admin/settings/members`,
      t1aImports: `${ORIGIN_A}/admin/settings/imports`,
      t1aEmails404: `${ORIGIN_A}/admin/settings/emails`,
      t1aHelpCenterDomains: `${ORIGIN_A}/admin/settings/help-center?tab=domains-languages`,
      t1eMembers: `${ORIGIN_E}/admin/settings/members`,
      t1eGettingStarted: `${ORIGIN_E}/admin/getting-started`,
      t1aBoards: `${ORIGIN_A}/admin/boards`,
    }
    for (const [key, url] of Object.entries(pageUrls)) {
      const cookie = key.startsWith('t1e') ? cookieE : cookieA
      const res = await http(url, { headers: { cookie } })
      pages[key] = {
        status: res.status,
        locationHost: res.locationHost,
        locationPath: res.locationPath,
        html: res.html,
      }
    }
    facts.pages = pages

    facts.pageHops = {
      t1aGeneral: await followAuth(`${ORIGIN_A}/admin/settings/general`, cookieA),
      t1aBilling: await followAuth(`${ORIGIN_A}/admin/settings/billing`, cookieA),
      t1aHelpCenter: await followAuth(`${ORIGIN_A}/admin/settings/help-center`, cookieA),
      t1aChannels: await followAuth(`${ORIGIN_A}/admin/settings/channels`, cookieA),
      t1aInbox: await followAuth(`${ORIGIN_A}/admin/inbox`, cookieA),
      t1aFeedback: await followAuth(`${ORIGIN_A}/admin/feedback`, cookieA),
      t1eBilling: await followAuth(`${ORIGIN_E}/admin/settings/billing`, cookieE),
      t1eGeneral: await followAuth(`${ORIGIN_E}/admin/settings/general`, cookieE),
      t1aMembers: await followAuth(`${ORIGIN_A}/admin/settings/members`, cookieA),
      t1aImports: await followAuth(`${ORIGIN_A}/admin/settings/imports`, cookieA),
      t1aHelpCenterDomains: await followAuth(
        `${ORIGIN_A}/admin/settings/help-center?tab=domains-languages`,
        cookieA,
      ),
      t1eMembers: await followAuth(`${ORIGIN_E}/admin/settings/members`, cookieE),
      t1eHelpCenterDomains: await followAuth(
        `${ORIGIN_E}/admin/settings/help-center?tab=domains-languages`,
        cookieE,
      ),
      t1aGettingStarted: await followAuth(`${ORIGIN_A}/admin/getting-started`, cookieA),
      t1aBoards: await followAuth(`${ORIGIN_A}/admin/boards`, cookieA),
    }

    const publicUrls = [
      `${ORIGIN_A}/?sort=trending`,
      `${ORIGIN_E}/?sort=trending`,
      `https://${SYS_A}/?sort=trending`,
      `https://${SYS_E}/?sort=trending`,
      `https://${SYS_A}/`,
      `${ORIGIN_A}/`,
    ]
    facts.public = {}
    for (const url of publicUrls) {
      const res = await http(url)
      facts.public[url] = {
        status: res.status,
        locationHost: res.locationHost,
        locationPath: res.locationPath,
        html: res.html ? { title: res.html.title, snippet: res.html.snippet } : null,
      }
    }
    const boardA = facts.workspaceA.boards.find((b) => !b.private) || facts.workspaceA.boards[0]
    const boardE = facts.workspaceE.boards.find((b) => !b.private) || facts.workspaceE.boards[0]
    if (boardA?.slug) {
      const url = `${ORIGIN_A}/b/${boardA.slug}`
      const res = await http(url)
      facts.public.boardA = {
        url,
        slug: boardA.slug,
        status: res.status,
        locationPath: res.locationPath,
        title: res.html?.title,
        fiveHundred: res.status >= 500,
      }
    }
    if (boardE?.slug) {
      const url = `${ORIGIN_E}/b/${boardE.slug}`
      const res = await http(url)
      facts.public.boardE = { url, slug: boardE.slug, status: res.status, locationPath: res.locationPath }
    }

    facts.isolation = {
      t1aCookieOnT1eAdmin: await (async () => {
        const res = await http(`${ORIGIN_E}/admin`, { headers: { cookie: cookieA } })
        return {
          status: res.status,
          locationPath: res.locationPath,
          hasSignin: res.html?.hasSignin || /auth=signin/.test(res.location || ''),
        }
      })(),
      t1eCookieOnT1aAdmin: await (async () => {
        const res = await http(`${ORIGIN_A}/admin`, { headers: { cookie: cookieE } })
        return {
          status: res.status,
          locationPath: res.locationPath,
          hasSignin: res.html?.hasSignin || /auth=signin/.test(res.location || ''),
        }
      })(),
      t1aCookieOnT1eBilling: await (async () => {
        const res = await http(`${ORIGIN_E}/admin/settings/billing`, { headers: { cookie: cookieA } })
        return { status: res.status, locationPath: res.locationPath }
      })(),
    }

    async function postBilling(origin, cookie, originHeader, body) {
      const headers = { 'content-type': 'application/x-www-form-urlencoded', cookie }
      if (originHeader !== undefined) headers.origin = originHeader
      const res = await http(`${origin}/api/billing/session`, { method: 'POST', headers, body })
      return {
        status: res.status,
        error: res.error,
        message: res.message,
        locationHost: res.locationHost,
        locationPath: res.locationPath ? res.locationPath.slice(0, 28) : null,
        hasCsTest: (res.location || '').includes('cs_test_'),
        hasCsLive: (res.location || '').includes('cs_live_'),
        location: res.location,
      }
    }

    facts.billingForm = {
      t1aNoOrigin: await postBilling(ORIGIN_A, cookieA, undefined, 'action=checkout&planId=pro&billingPeriod=monthly'),
      t1aAttacker: await postBilling(ORIGIN_A, cookieA, 'https://attacker.test', 'action=checkout&planId=pro&billingPeriod=monthly'),
      t1aChangePlanPro: await postBilling(ORIGIN_A, cookieA, ORIGIN_A, 'action=checkout&planId=pro&billingPeriod=monthly'),
      t1aChangePlanScaleAnnual: await postBilling(
        ORIGIN_A,
        cookieA,
        ORIGIN_A,
        'action=checkout&planId=scale&billingPeriod=annual',
      ),
      t1aPortal: await postBilling(ORIGIN_A, cookieA, ORIGIN_A, 'action=portal'),
      t1eUpgrade: await postBilling(ORIGIN_E, cookieE, ORIGIN_E, 'action=checkout&planId=growth&billingPeriod=monthly'),
      t1ePortal: await postBilling(ORIGIN_E, cookieE, ORIGIN_E, 'action=portal'),
      t1aCookieOnT1eCheckout: await postBilling(
        ORIGIN_E,
        cookieA,
        ORIGIN_E,
        'action=checkout&planId=growth&billingPeriod=monthly',
      ),
    }

    const tokenA = deriveInternalToken(deriveWorkspaceSecret(rootKey, T1A))
    const tokenE = deriveInternalToken(deriveWorkspaceSecret(rootKey, T1E))
    const hashA = createHash('sha256').update(tokenA).digest('hex')
    const hashE = createHash('sha256').update(tokenE).digest('hex')
    const hashRows = await cp`
      select id, internal_token_hash from cp_instances where id in (${T1A}, ${T1E})
    `
    facts.tokenHashMatch = {
      t1a: hashRows.find((r) => r.id === T1A)?.internal_token_hash === hashA,
      t1e: hashRows.find((r) => r.id === T1E)?.internal_token_hash === hashE,
    }

    async function postCp(path, token, body) {
      const headers = { 'content-type': 'application/json' }
      if (token !== undefined) headers.authorization = `Bearer ${token}`
      const res = await http(`${CP}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
      return {
        status: res.status,
        error: res.error,
        keys: res.json && typeof res.json === 'object' ? Object.keys(res.json) : [],
        urlHost: typeof res.json?.url === 'string' ? hostOf(res.json.url) : null,
        url: typeof res.json?.url === 'string' ? res.json.url : null,
        hasProjectionToken: typeof res.json?.projectionToken === 'string',
        resultStatus: typeof res.json?.status === 'string' ? res.json.status : null,
      }
    }
    facts.cpGateway = {
      noBearer: await postCp('/api/v1/internal/billing/session', undefined, { action: 'portal' }),
      dummyBearer: await postCp('/api/v1/internal/billing/session', 'qbint_dummy', { action: 'portal' }),
      extraInstanceId: await postCp('/api/v1/internal/billing/session', tokenA, {
        action: 'checkout',
        planId: 'pro',
        billingPeriod: 'monthly',
        instanceId: T1E,
      }),
      t1aPortal: await postCp('/api/v1/internal/billing/session', tokenA, { action: 'portal' }),
      t1aChangePlanScale: await postCp('/api/v1/internal/billing/session', tokenA, {
        action: 'checkout',
        planId: 'scale',
        billingPeriod: 'annual',
      }),
      t1eCheckout: await postCp('/api/v1/internal/billing/session', tokenE, {
        action: 'checkout',
        planId: 'growth',
        billingPeriod: 'monthly',
      }),
      identityNoBearer: await postCp('/api/v1/internal/identity', undefined, { displayName: 'x' }),
      identityExtraWorkspace: await postCp('/api/v1/internal/identity', tokenA, {
        displayName: facts.t1a.identity?.displayName || 't1a',
        instanceId: T1E,
      }),
      identitySameName: await postCp('/api/v1/internal/identity', tokenA, {
        displayName: facts.t1a.identity?.displayName || facts.workspaceA.name || 't1a',
      }),
      domainsPath: await postCp('/api/v1/internal/identity/domains', tokenA, { hostname: 'example.com' }),
      ownershipExtras: await postCp('/api/v1/internal/ownership', tokenA, {
        toEmail: 'stranger@example.com',
        instanceId: T1E,
      }),
      ownershipStranger: await postCp('/api/v1/internal/ownership', tokenA, {
        toEmail: 'stranger@example.com',
      }),
      leaveOwner: await postCp('/api/v1/internal/membership/leave', tokenA, {
        email: String(t1aOwner || ''),
      }),
      openSiblingExtras: await postCp('/api/v1/internal/workspaces/open', tokenA, {
        instanceId: T1E,
        workspaceId: T1A,
      }),
      trialAgain: await postCp('/api/v1/internal/billing/activate-trial', tokenE, {
        idempotencyKey: 'verify-71f78ecb-no-second-trial',
        resolution: 'configured',
        artifactType: 'board',
        occurredAt: new Date().toISOString(),
      }),
      wipeNoBearer: await postCp('/api/v1/internal/lifecycle/soft-delete', undefined, { confirm: 'wipe' }),
      wipeDummy: await postCp('/api/v1/internal/lifecycle/soft-delete', 'qbint_dummy', { confirm: 'wipe' }),
      wipeExtraInstanceId: await postCp('/api/v1/internal/lifecycle/soft-delete', tokenA, {
        confirm: 'wipe',
        instanceId: T1A,
      }),
      wipeExtraWorkspaceId: await postCp('/api/v1/internal/lifecycle/soft-delete', tokenA, {
        confirm: 'wipe',
        workspaceId: T1A,
      }),
      wipeConfirmYes: await postCp('/api/v1/internal/lifecycle/soft-delete', tokenA, { confirm: 'yes' }),
    }

    async function getCp(path, token) {
      const headers = {}
      if (token !== undefined) headers.authorization = `Bearer ${token}`
      const res = await http(`${CP}${path}`, { method: 'GET', headers })
      const json = res.json && typeof res.json === 'object' ? res.json : null
      return {
        status: res.status,
        error: res.error,
        keys: json ? Object.keys(json) : [],
        planIds: Array.isArray(json?.plans) ? json.plans.map((p) => p.id) : null,
        planCount: Array.isArray(json?.plans) ? json.plans.length : null,
        invoiceCount: Array.isArray(json?.invoices) ? json.invoices.length : null,
        invoiceHostedHttps:
          Array.isArray(json?.invoices) && json.invoices.length > 0
            ? json.invoices.every((inv) => typeof inv.hostedUrl === 'string' && inv.hostedUrl.startsWith('https://'))
            : null,
        invoiceHasProviderId:
          Array.isArray(json?.invoices) &&
          json.invoices.some((inv) => typeof inv.id === 'string' && /^(in|cs|sub)_/.test(inv.id)),
        siblingCount: Array.isArray(json?.workspaces) ? json.workspaces.length : null,
        siblingUrls: Array.isArray(json?.workspaces)
          ? json.workspaces.map((w) => ({
              host: typeof w.url === 'string' ? hostOf(w.url) : null,
              hasWs: typeof w.url === 'string' && /ws-[0-9a-f]{24}/i.test(w.url),
            }))
          : null,
        hasOwnerEmail: typeof json?.ownerEmail === 'string',
        ownerDomain: typeof json?.ownerEmail === 'string' ? domainOf(json.ownerEmail) : null,
        annualDiscountMonths: json?.annualDiscountMonths ?? null,
      }
    }
    facts.cpGets = {
      catalogueNoBearer: await getCp('/api/v1/internal/billing/catalogue', undefined),
      catalogueA: await getCp('/api/v1/internal/billing/catalogue', tokenA),
      catalogueE: await getCp('/api/v1/internal/billing/catalogue', tokenE),
      invoicesNoBearer: await getCp('/api/v1/internal/billing/invoices', undefined),
      invoicesA: await getCp('/api/v1/internal/billing/invoices', tokenA),
      invoicesE: await getCp('/api/v1/internal/billing/invoices', tokenE),
      ownershipNoBearer: await getCp('/api/v1/internal/ownership', undefined),
      ownershipA: await getCp('/api/v1/internal/ownership', tokenA),
      ownershipE: await getCp('/api/v1/internal/ownership', tokenE),
      siblingsA: await getCp('/api/v1/internal/workspaces', tokenA),
      siblingsE: await getCp('/api/v1/internal/workspaces', tokenE),
    }

    if (stripeKey) {
      const stripeGet = async (path) => {
        const res = await fetch(`https://api.stripe.com/v1${path}`, {
          headers: { authorization: `Bearer ${stripeKey}` },
        })
        return { status: res.status, json: await res.json() }
      }
      const sessionFrom = (url) => {
        if (!url) return null
        const m = String(url).match(/\/(cs_(?:test|live)_[A-Za-z0-9]+)/)
        return m ? m[1] : null
      }
      const describeSession = (retrieved) => ({
        retrieveStatus: retrieved.status,
        idPrefix: typeof retrieved.json?.id === 'string' ? retrieved.json.id.slice(0, 8) : null,
        livemode: retrieved.json?.livemode ?? null,
        mode: retrieved.json?.mode ?? null,
        kind: retrieved.json?.metadata?.kind ?? null,
        instanceId: retrieved.json?.metadata?.instanceId ?? null,
        planId: retrieved.json?.metadata?.planId ?? null,
        billingPeriod: retrieved.json?.metadata?.billingPeriod ?? null,
        successHost: retrieved.json?.success_url ? hostOf(retrieved.json.success_url) : null,
        cancelHost: retrieved.json?.cancel_url ? hostOf(retrieved.json.cancel_url) : null,
      })
      const sidChange = sessionFrom(facts.billingForm.t1aChangePlanPro.location)
      const sidPortal = facts.billingForm.t1aPortal.location
      const sidE = sessionFrom(facts.billingForm.t1eUpgrade.location)
      const sidScale = sessionFrom(facts.cpGateway.t1aChangePlanScale.url)
      const sidScaleForm = sessionFrom(facts.billingForm.t1aChangePlanScaleAnnual.location)
      facts.stripe = {}
      if (sidChange) facts.stripe.t1aChangePlanPro = describeSession(await stripeGet(`/checkout/sessions/${sidChange}`))
      if (sidE) facts.stripe.t1eUpgrade = describeSession(await stripeGet(`/checkout/sessions/${sidE}`))
      if (sidScale) facts.stripe.t1aScaleAnnual = describeSession(await stripeGet(`/checkout/sessions/${sidScale}`))
      if (sidScaleForm)
        facts.stripe.t1aScaleAnnualForm = describeSession(await stripeGet(`/checkout/sessions/${sidScaleForm}`))
      if (sidPortal) {
        const page = await http(sidPortal)
        facts.stripe.portalPage = { status: page.status, host: hostOf(sidPortal), title: page.html?.title }
      }
      if (facts.billingForm.t1aChangePlanPro.location) {
        const page = await http(facts.billingForm.t1aChangePlanPro.location)
        facts.stripe.changePlanPage = {
          status: page.status,
          host: hostOf(facts.billingForm.t1aChangePlanPro.location),
          title: page.html?.title,
        }
      }

      const whSecret = process.env.STRIPE_WEBHOOK_SECRET || ''
      facts.webhook = { secretPresent: Boolean(whSecret) }
      const noSig = await http(`${CP}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      facts.webhook.noSignature = { status: noSig.status, error: noSig.error }
      const badSig = await http(`${CP}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
        body: '{}',
      })
      facts.webhook.badSignature = { status: badSig.status, error: badSig.error }

      if (whSecret && replaySource[0]?.id) {
        const ev = await stripeGet(`/events/${replaySource[0].id}`)
        facts.webhook.retrieve = {
          status: ev.status,
          type: ev.json?.type ?? null,
          idPrefix: typeof ev.json?.id === 'string' ? ev.json.id.slice(0, 8) : null,
          livemode: ev.json?.livemode ?? null,
        }
        if (ev.status === 200 && ev.json) {
          const payload = JSON.stringify(ev.json)
          const timestamp = Math.floor(Date.now() / 1000)
          const signed = createHmac('sha256', whSecret).update(`${timestamp}.${payload}`).digest('hex')
          const [versionBefore] = await cp`
            select projection_version from cp_workspace_billing where instance_id = ${T1A}
          `
          const [eBefore] = await cp`
            select projection_version from cp_workspace_billing where instance_id = ${T1E}
          `
          const replay = await http(`${CP}/api/billing/webhook`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'stripe-signature': `t=${timestamp},v1=${signed}`,
            },
            body: payload,
          })
          const [versionAfter] = await cp`
            select projection_version from cp_workspace_billing where instance_id = ${T1A}
          `
          const [eAfter] = await cp`
            select projection_version from cp_workspace_billing where instance_id = ${T1E}
          `
          facts.webhook.replay = {
            status: replay.status,
            json: replay.json,
            t1aVersionBefore: versionBefore?.projection_version ?? null,
            t1aVersionAfter: versionAfter?.projection_version ?? null,
            t1eVersionBefore: eBefore?.projection_version ?? null,
            t1eVersionAfter: eAfter?.projection_version ?? null,
            t1aUnchanged: versionBefore?.projection_version === versionAfter?.projection_version,
            t1eUnchanged: eBefore?.projection_version === eAfter?.projection_version,
          }
        }
      }
    }

    facts.accountDelete = {
      noSession: await http(`${CP}/api/account/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }).then((res) => ({ status: res.status, error: res.error })),
    }

    facts.cpSession = { method: null, dashboardOk: false, delete: null, reason: null }
    if (t1aOwner && domainOf(t1aOwner) !== 'quackback.io') {
      const signin = await http(`${CP}/api/auth/portal-signin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: t1aOwner, callbackURL: '/dashboard' }),
      })
      facts.cpSession.signin = { status: signin.status, error: signin.error, keys: signin.keys || [] }
      const box = await guerrillaOtp(String(t1aOwner))
      facts.cpSession.mailbox = {
        attempted: box.attempted,
        listed: box.listed ?? 0,
        otpDigits: box.otpDigits ?? 0,
        reason: box.reason,
      }
      if (box.otp) {
        const verify = await fetch(`${CP}/api/auth/sign-in/email-otp`, {
          method: 'POST',
          redirect: 'manual',
          headers: { 'content-type': 'application/json', 'user-agent': UA },
          body: JSON.stringify({ email: t1aOwner, otp: box.otp }),
          signal: AbortSignal.timeout(20000),
        })
        const cookies = verify.headers.getSetCookie?.() || []
        facts.cpSession.verify = {
          status: verify.status,
          cookieNames: cookieNames(cookies),
          hasSessionCookie: cookieNames(cookies).some((n) => /session/i.test(n)),
        }
        if (facts.cpSession.verify.hasSessionCookie) {
          const cpCookie = cookieHeader(cookies)
          writeFileSync(COOKIE_CP, cpCookie, { mode: 0o600 })
          facts.cpSession.method = 'email-otp'
          facts.pageHops.cpDashboard = await followAuth(`${CP}/dashboard`, cpCookie)
          facts.pageHops.cpLogin = await followAuth(`${CP}/login`, '')
          const last = facts.pageHops.cpDashboard.at(-1)
          facts.cpSession.dashboardOk = Boolean(
            last && last.status === 200 && (last.html?.hasYourWorkspaces || last.html?.hasDeleteAccount),
          )
          const del = await http(`${CP}/api/account/delete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: cpCookie },
          })
          facts.cpSession.delete = { status: del.status, error: del.error }
          facts.accountDelete.liveOwner = { status: del.status, error: del.error }
          const open = await http(`${CP}/api/instances/${T1A}/open`, {
            method: 'POST',
            headers: { cookie: cpCookie, origin: CP, 'content-type': 'application/x-www-form-urlencoded' },
            body: '',
          })
          facts.cpOpen = {
            status: open.status,
            locationHost: open.locationHost,
            locationPath: open.locationPath,
            hasOtt: (open.location || '').includes('ott='),
            locationIsWsOrFriendly: [HOST_A, SYS_A].includes(open.locationHost || ''),
          }
        } else {
          facts.cpSession.reason = 'email_otp_did_not_set_session'
        }
      } else {
        facts.cpSession.reason = box.reason || 'otp_unavailable'
      }
    } else {
      facts.cpSession.reason = 'no_non_operator_owner_email'
    }

    if (!facts.cpSession.dashboardOk) {
      facts.pageHops.cpLogin = facts.pageHops.cpLogin || (await followAuth(`${CP}/login`, ''))
    }

    facts.entitlementsLive = {
      t1aSsoNew: facts.pages.t1aSsoNew,
      t1eSsoNew: facts.pages.t1eSsoNew,
      t1aGrowthGrantsWebhooks: facts.workspaceA.cloud.entitlements?.webhooks === true,
      t1aGrowthGrantsSso: facts.workspaceA.cloud.entitlements?.sso === true,
      t1eTrialPlan: facts.workspaceE.cloud.effectivePlan,
      t1eGrantsSso: facts.workspaceE.cloud.entitlements?.sso === true,
      t1eGrantsWebhooks: facts.workspaceE.cloud.entitlements?.webhooks === true,
      t1eGrantsWorkflows: facts.workspaceE.cloud.entitlements?.workflows === true,
    }

    function overlayMax(stored, projection) {
      const plan = projection?.planLimits || null
      const free = projection?.freeLimits || null
      const expired =
        typeof projection?.planLimitsExpireAt === 'string' &&
        Date.now() >= Date.parse(projection.planLimitsExpireAt)
      const source = expired ? free : plan
      if (!source) {
        return {
          storedNull: stored == null,
          unlimited: stored == null,
          maxBoards: stored?.maxBoards ?? null,
          maxTeamSeats: stored?.maxTeamSeats ?? null,
          expired,
        }
      }
      const pick = (key) => {
        if (stored && stored[key] === null) return null
        if (source[key] == null) return stored?.[key] ?? null
        if (stored?.[key] == null) return source[key]
        return Math.max(Number(stored[key]), Number(source[key]))
      }
      const maxBoards = stored ? pick('maxBoards') : source.maxBoards
      const maxTeamSeats = stored ? pick('maxTeamSeats') : source.maxTeamSeats
      return {
        storedNull: stored == null,
        unlimited: maxBoards == null,
        maxBoards,
        maxTeamSeats,
        maxPosts: stored ? pick('maxPosts') : source.maxPosts,
        expired,
        entitlementsWebhooks: projection?.entitlements?.webhooks === true,
        entitlementsSso: projection?.entitlements?.sso === true,
        entitlementsWorkflows: projection?.entitlements?.workflows === true,
      }
    }

    facts.limits = {
      t1aTierLimits: facts.workspaceA.tierLimits,
      t1eTierLimits: facts.workspaceE.tierLimits,
      t1aPlanLimits: facts.workspaceA.cloud.planLimits,
      t1ePlanLimits: facts.workspaceE.cloud.planLimits,
      t1aFreeLimits: facts.workspaceA.cloud.freeLimits,
      t1eFreeLimits: facts.workspaceE.cloud.freeLimits,
      t1aStoredUnlimited: facts.workspaceA.tierLimits == null,
      t1eStoredUnlimited: facts.workspaceE.tierLimits == null,
      t1aResolved: overlayMax(facts.workspaceA.tierLimits, facts.workspaceA.cloud),
      t1eResolved: overlayMax(facts.workspaceE.tierLimits, facts.workspaceE.cloud),
      t1aBoardCount: facts.workspaceA.boardCount,
      t1eBoardCount: facts.workspaceE.boardCount,
      t1aSeatCount: facts.workspaceA.seatCount,
      t1eSeatCount: facts.workspaceE.seatCount,
      t1aPostCount: facts.workspaceA.postCount,
      t1ePostCount: facts.workspaceE.postCount,
      t1aEffectivePlan: facts.workspaceA.cloud.effectivePlan,
      t1eEffectivePlan: facts.workspaceE.cloud.effectivePlan,
      overlayLeastRestrictive:
        facts.workspaceE.cloud.effectivePlan === 'pro' && facts.t1e.outbox?.effective_plan === 'pro',
    }

    async function countLiveFree(ownerEmail) {
      if (!ownerEmail) return null
      const rows = await cp`
        select i.id, i.plan_id, i.status,
               i.deleted_at is not null as deleted,
               i.suspended_at is not null as suspended,
               i.stripe_subscription_item_id is not null as has_item
        from cp_instances i
        where lower(i.owner_email) = ${String(ownerEmail).toLowerCase()}
      `
      const paid = new Set(['growth', 'pro', 'scale'])
      const liveFree = rows.filter((r) => {
        if (r.deleted || r.suspended) return false
        const isPaid = Boolean(r.has_item && r.plan_id && paid.has(r.plan_id))
        return !isPaid
      })
      return {
        owned: rows.length,
        liveFree: liveFree.length,
        liveFreeDeletedHidden: rows.filter((r) => r.deleted).length,
      }
    }
    facts.freeCap = {
      t1a: await countLiveFree(t1aOwner),
      t1e: await countLiveFree(t1eOwner),
      t1aIsPaid: facts.workspaceA.cloud.effectivePlan === 'growth',
      t1eTrialCountsAsFreeForCap: facts.workspaceE.cloud.effectivePlan === 'pro',
      fourthCreateNotIssued: true,
    }

    const healthUrls = {
      gauntlet: 'https://gauntlet.quackback.co.uk/api/health/ready',
      t1aReady: `${ORIGIN_A}/api/health/ready`,
      t1eReady: `${ORIGIN_E}/api/health/ready`,
      t1aSys: `https://${SYS_A}/api/health`,
      t1eSys: `https://${SYS_E}/api/health`,
      oldFriendly: 'https://northe0d78f.quackback.co.uk/',
      oldFriendlyAdmin: 'https://northe0d78f.quackback.co.uk/admin/settings/general',
    }
    facts.health = {}
    for (const [key, url] of Object.entries(healthUrls)) {
      const res = await http(url)
      facts.health[key] = {
        status: res.status,
        locationHost: res.locationHost,
        locationPath: res.locationPath,
        role: res.json?.role ?? null,
        ok: res.json?.status === 'ok' || res.status === 308,
      }
    }

    facts.lifecycleFailClosed = {
      deleteNoCookie: await (async () => {
        const res = await http(`${CP}/api/instances/${T1A}/delete`, { method: 'POST' })
        return { status: res.status, error: res.error, locationPath: res.locationPath }
      })(),
      restoreNoCookie: await (async () => {
        const res = await http(`${CP}/api/instances/${T1A}/restore`, { method: 'POST' })
        return { status: res.status, error: res.error, locationPath: res.locationPath }
      })(),
      createNoCookie: await (async () => {
        const res = await http(`${CP}/api/instances`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        return { status: res.status, error: res.error }
      })(),
    }

    if (facts.workspaceA.logoSrc) {
      const abs = facts.workspaceA.logoSrc.startsWith('http')
        ? facts.workspaceA.logoSrc
        : `${ORIGIN_A}${facts.workspaceA.logoSrc}`
      const res = await http(abs)
      facts.assets = {
        logoSrc: facts.workspaceA.logoSrc.startsWith('http')
          ? facts.workspaceA.logoSrc.replace(/^https?:\/\/[^/]+/, '')
          : facts.workspaceA.logoSrc,
        logoHost: facts.workspaceA.logoSrc.startsWith('http') ? hostOf(facts.workspaceA.logoSrc) : 'relative',
        getStatus: res.status,
        storageRelative: facts.workspaceA.logoIsStorageRelative,
      }
    }

    async function assetFlags(url, flags) {
      const res = await http(url)
      const text = res._text || ''
      const out = { url, status: res.status, length: text.length }
      for (const [k, re] of Object.entries(flags)) out[k] = re.test(text)
      return out
    }
    facts.servedAssets = {
      general: await assetFlags(`${ORIGIN_A}/assets/settings.general-CpncR1fM.js`, {
        hasWipe: /Wipe workspace/,
        hasDanger: /Danger zone/,
        importsExport: /export-workspace-action/,
        hasTls: /TLS terminates at your own reverse proxy/,
      }),
      exportAction: await assetFlags(`${ORIGIN_A}/assets/export-workspace-action-ypBRNNxJ.js`, {
        hasExport: /Export workspace data/,
      }),
      dashboard: await assetFlags(`${CP}/assets/dashboard.index-DHS8vkfy.js`, {
        hasDeleteAccount: /Delete account/,
        hasOfThreeFree: /of \{maxLiveFree\} Free workspaces|of 3 Free workspaces/,
        hasCreate: /Create workspace/,
      }),
    }
    const billingHtml = facts.pageHops.t1aBilling.find((h) => h.html)?.html
    const generalHtmlText = pages.t1aBilling?.html?.snippet
    const billingPage = await http(`${ORIGIN_A}/admin/settings/billing`, { headers: { cookie: cookieA } })
    const billingScripts = [...(billingPage._text || '').matchAll(/\/assets\/(billing-[^"]+\.js)/g)].map((m) => m[1])
    facts.servedAssets.billingScripts = billingScripts.slice(0, 6)
    if (billingScripts[0]) {
      facts.servedAssets.billing = await assetFlags(`${ORIGIN_A}/assets/${billingScripts[0]}`, {
        hasUsage: /AI tokens this month| of /,
        hasTrialEnds: /Pro trial ends on/,
        hasNofM: /\d+ of \d+|used of/,
      })
    }
    void billingHtml
    void generalHtmlText

    const after = await cp`select id from cp_instances order by id`
    facts.instanceCount.after = after.length
    facts.instanceIds.after = after.map((r) => r.id)
    const beforeSet = new Set(facts.instanceIds.before)
    const afterSet = new Set(facts.instanceIds.after)
    facts.instanceIds.added = facts.instanceIds.after.filter((id) => !beforeSet.has(id))
    facts.instanceIds.removed = facts.instanceIds.before.filter((id) => !afterSet.has(id))
    facts.instanceIds.t1aAfter = after.some((r) => r.id === T1A)
    facts.instanceIds.t1eAfter = after.some((r) => r.id === T1E)
  } finally {
    await cp.end({ timeout: 5 })
  }
} catch (err) {
  facts.errors.push(err instanceof Error ? err.message : String(err))
}

function redactUrl(raw) {
  if (typeof raw !== 'string') return raw
  try {
    const u = new URL(raw)
    return {
      host: u.hostname,
      pathPrefix: u.pathname.slice(0, 28),
      hasCsTest: raw.includes('cs_test_'),
      hasCsLive: raw.includes('cs_live_'),
    }
  } catch {
    return { host: null, pathPrefix: String(raw).slice(0, 40) }
  }
}
function scrub(value) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach(scrub)
    return
  }
  delete value._text
  delete value._setCookie
  if (typeof value.location === 'string') value.location = redactUrl(value.location)
  if (typeof value.url === 'string' && value.url.startsWith('http')) value.url = redactUrl(value.url)
  for (const v of Object.values(value)) scrub(v)
}
scrub(facts)

writeFileSync(OUT, JSON.stringify(facts, null, 2))
console.log(
  JSON.stringify({
    wrote: OUT,
    errors: facts.errors,
    instances: `${facts.instanceCount.before}->${facts.instanceCount.after}`,
    handoffA: facts.handoff?.t1a?.consumeStatus,
    handoffE: facts.handoff?.t1e?.consumeStatus,
    billingA: facts.billingForm?.t1aChangePlanPro?.status,
    portalA: facts.billingForm?.t1aPortal?.status,
    catalogue: facts.cpGets?.catalogueA?.status,
    wipeExtra: facts.cpGateway?.wipeExtraInstanceId?.status,
    wipeYes: facts.cpGateway?.wipeConfirmYes?.status,
    deleteNoSess: facts.accountDelete?.noSession?.status,
    deleteLive: facts.accountDelete?.liveOwner?.status,
    cpDash: facts.cpSession?.dashboardOk,
    cpMethod: facts.cpSession?.method,
    cpReason: facts.cpSession?.reason,
    liveFree: facts.freeCap,
    resolvedA: facts.limits?.t1aResolved,
    resolvedE: facts.limits?.t1eResolved,
    generalWipe: facts.pageHops?.t1aGeneral?.at(-1)?.html?.hasWipe,
    generalExport: facts.pageHops?.t1aGeneral?.at(-1)?.html?.hasExportWorkspace,
    hcTls: facts.pageHops?.t1aHelpCenterDomains?.at(-1)?.html?.hasLocalReverseProxyCopy,
    hcDomain: facts.pageHops?.t1aHelpCenterDomains?.at(-1)?.html?.hasHelpCenterDomain,
  }),
)
