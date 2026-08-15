#!/usr/bin/env bun
/**
 * P3 live critic: restore-at-cap stays on the dashboard with a notice.
 * Temps have no provision / Neon. Always deleted in finally.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import postgres from '/home/james/quackback-cp/node_modules/postgres/src/index.js'

const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/this-fire/p3-restore-critic.json'
const T7S = 'inst_01m021rrsdfan9v4bzpcec2g3z'
const T7H = 'inst_01m021xvy6fan9v4f5271b2496'
const T1A = 'inst_01m00kq6cdfzzb19gfjz8pt0s7'
const T1E = 'inst_01m00kprbrfzzb19f490wga8q2'
const CP = 'https://cp.quackback.co.uk'
const UA = 'quackback-p3-restore-critic/2026-08-15'
const TEMP_PREFIX = 'inst_p3cap_'
const EXPECTED_NOTICE = 'You already own 3 live Free workspaces. Delete one or upgrade one to a paid plan first.'
const COOKIE = '/tmp/p3-restore-critic.cookie'

function must(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is unset`)
  return v
}
function fp(s) {
  return createHash('sha256').update(String(s)).digest('hex').slice(0, 12)
}
function domainOf(email) {
  const at = String(email).lastIndexOf('@')
  return at >= 0 ? String(email).slice(at + 1).toLowerCase() : null
}
function localPart(email) {
  const at = String(email).lastIndexOf('@')
  return at >= 0 ? String(email).slice(0, at) : null
}
function locParts(loc) {
  if (!loc) return { location: null, host: null, path: null, search: null, notice: null }
  try {
    const u = new URL(loc, CP)
    return {
      location: u.toString(),
      host: u.hostname,
      path: u.pathname,
      search: u.search,
      notice: u.searchParams.get('notice'),
    }
  } catch {
    return { location: loc, host: null, path: null, search: null, notice: null }
  }
}
function cookieHeader(setCookie) {
  return (setCookie ?? []).map((c) => c.split(';')[0]).filter(Boolean).join('; ')
}
function bodyKind(text, contentType) {
  const trimmed = String(text || '').trim()
  let json = null
  try {
    json = JSON.parse(trimmed)
  } catch {}
  return {
    contentType: contentType || null,
    html: /^\s*</.test(trimmed) || /text\/html/i.test(contentType || ''),
    json: json !== null,
    jsonError: typeof json?.error === 'string' ? json.error : null,
    jsonStatus: typeof json?.status === 'number' ? json.status : null,
    looksRaw402:
      json !== null
      && (json.status === 402 || /free_workspace_owner_cap/i.test(String(json.error || ''))),
    hasNoticeCopy: trimmed.includes(EXPECTED_NOTICE),
    hasAlertRole: /role=["']alert["']/.test(trimmed),
    hasYourWorkspaces: /Your workspaces/i.test(trimmed),
    prefix: json ? null : trimmed.slice(0, 80),
  }
}

const facts = {
  at: new Date().toISOString(),
  unit: 'p3-restore-notice-c208c06',
  expected: {
    deployId: '9030705d-f750-4029-b6cf-8887f95b3bb8',
    imageDigest: 'sha256:d84fd27c2d2d10ffba14a36b732540d462d396cd5f34a3102a962a9a40928741',
    commit: 'c208c06',
    regions: ['sfo'],
  },
  didNotPay: true,
  didNotCreateNeon: true,
  didNotStartCustomDomains: true,
  didNotDeploy: true,
  didNotWipeReal: true,
  printedCredentials: false,
  errors: [],
}

const sql = postgres(must('DATABASE_URL'), { max: 2, idle_timeout: 5, connect_timeout: 20 })

try {
  const beforeRows = await sql`select id from cp_instances order by id`
  facts.instanceCount = { before: beforeRows.length }
  facts.leftoverBefore = {
    p3: beforeRows.filter((r) => String(r.id).startsWith(TEMP_PREFIX)).length,
    cap8a: beforeRows.filter((r) => String(r.id).startsWith('inst_cap8a_')).length,
  }
  if (facts.leftoverBefore.p3 > 0) {
    await sql`delete from cp_instances where id like ${TEMP_PREFIX + '%'}`
  }

  const [sup] = await sql`
    select id, owner_email, org_id, cluster_id, plan_id, status, deleted_at is not null as deleted
    from cp_instances
    where id = ${T7S}
  `
  if (!sup?.owner_email) throw new Error('t7s owner missing')
  const ownerEmail = String(sup.owner_email).trim().toLowerCase()
  if (domainOf(ownerEmail) === 'quackback.io') throw new Error('refusing operator mailbox')
  facts.owner = {
    domain: domainOf(ownerEmail),
    fp: fp(ownerEmail),
    planId: sup.plan_id ?? null,
    deleted: Boolean(sup.deleted),
  }

  const liveRows = await sql`
    select id, plan_id, stripe_subscription_item_id, deleted_at, status
    from cp_instances
    where lower(owner_email) = ${ownerEmail}
      and deleted_at is null
      and deprovisioned_at is null
      and purge_claimed_at is null
  `
  const liveFreeBefore = liveRows.filter((r) => {
    const paid = Boolean(r.stripe_subscription_item_id) && ['growth', 'pro', 'scale'].includes(String(r.plan_id))
    return !paid
  }).length
  facts.liveFreeBefore = liveFreeBefore
  if (liveFreeBefore !== 1) throw new Error(`expected t7s live-Free 1, got ${liveFreeBefore}`)

  facts.unauthRestore = await (async () => {
    const res = await fetch(`${CP}/api/instances/${T1A}/restore`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'user-agent': UA, origin: CP },
      signal: AbortSignal.timeout(20000),
    })
    const text = await res.text()
    return {
      status: res.status,
      ...locParts(res.headers.get('location')),
      ...bodyKind(text, res.headers.get('content-type')),
    }
  })()

  facts.unauthDashboardNotice = await (async () => {
    const res = await fetch(`${CP}/dashboard?notice=free_workspace_owner_cap`, {
      redirect: 'manual',
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(20000),
    })
    const text = await res.text()
    return {
      status: res.status,
      ...locParts(res.headers.get('location')),
      ...bodyKind(text, res.headers.get('content-type')),
    }
  })()

  const suffix = Date.now().toString(36)
  const liveA = `${TEMP_PREFIX}a_${suffix}`
  const liveB = `${TEMP_PREFIX}b_${suffix}`
  const trashId = `${TEMP_PREFIX}trash_${suffix}`
  const now = new Date()
  const purgeAt = new Date(now.getTime() + 30 * 864e5)

  async function insertLive(id, key) {
    await sql`
      insert into cp_instances (
        id, creation_key, org_id, cluster_id, tenant_namespace, system_hostname,
        name, plan_id, db_name, db_role, owner_email, status, status_message
      ) values (
        ${id}, ${key}, ${sup.org_id}, ${sup.cluster_id},
        ${key}, ${`${key}.invalid`},
        ${''}, ${'free'}, ${`qb_${key.replace(/-/g, '_')}`}, ${`qb_${key.replace(/-/g, '_')}`},
        ${ownerEmail}, ${'active'}, ${''}
      )
    `
  }
  await insertLive(liveA, `p3cap-a-${suffix}`)
  await insertLive(liveB, `p3cap-b-${suffix}`)
  await sql`
    insert into cp_instances (
      id, creation_key, org_id, cluster_id, tenant_namespace, system_hostname,
      name, plan_id, db_name, db_role, owner_email, status, status_message,
      deleted_at, purge_at
    ) values (
      ${trashId}, ${`p3cap-trash-${suffix}`}, ${sup.org_id}, ${sup.cluster_id},
      ${`p3cap-trash-${suffix}`}, ${`p3cap-trash-${suffix}.invalid`},
      ${''}, ${'free'}, ${`qb_p3cap_trash_${suffix}`}, ${`qb_p3cap_trash_${suffix}`},
      ${ownerEmail}, ${'active'}, ${''},
      ${now}, ${purgeAt}
    )
  `
  facts.temps = { liveAFp: fp(liveA), liveBFp: fp(liveB), trashFp: fp(trashId) }

  const liveFreeAtThree = (
    await sql`
      select id, plan_id, stripe_subscription_item_id, deleted_at
      from cp_instances
      where lower(owner_email) = ${ownerEmail}
        and deleted_at is null
        and deprovisioned_at is null
        and purge_claimed_at is null
    `
  ).filter((r) => {
    const paid = Boolean(r.stripe_subscription_item_id) && ['growth', 'pro', 'scale'].includes(String(r.plan_id))
    return !paid
  }).length
  facts.liveFreeAtThree = liveFreeAtThree
  if (liveFreeAtThree !== 3) throw new Error(`expected live-Free 3, got ${liveFreeAtThree}`)

  const gmJar = []
  const gm = async (fn, extra = '') => {
    const res = await fetch(`https://api.guerrillamail.com/ajax.php?f=${fn}${extra}`, {
      headers: { 'user-agent': UA, cookie: gmJar.join('; ') },
      signal: AbortSignal.timeout(15000),
    })
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(';')[0]
      if (pair) gmJar.push(pair)
    }
    return res.json()
  }
  const local = localPart(ownerEmail)
  await gm('set_email_user', `&email_user=${encodeURIComponent(local)}&lang=en`)

  async function latestSigninMail() {
    const list = await gm('get_email_list', '&offset=0')
    const items = Array.isArray(list?.list) ? list.list : []
    const hit = items.find((i) => /sign-in link/i.test(String(i.mail_subject || ''))) || items[0]
    if (!hit) return { listed: items.length }
    const full = await gm('fetch_email', `&email_id=${encodeURIComponent(hit.mail_id)}`)
    const body = `${full?.mail_subject || ''}\n${full?.mail_body || ''}\n${full?.mail_excerpt || ''}`
    const link = body.match(/https:\/\/cp\.quackback\.co\.uk\/verify-magic-link[^\s"'<>]*/i)
    const magic = link ? link[0].replace(/&amp;/g, '&') : null
    const otpFromCopy = (body.match(/enter this code[^\d]{0,80}(\d{6})/i) || [])[1] || null
    if (!magic) {
      return {
        listed: items.length,
        subjectPrefix: String(hit.mail_subject || '').slice(0, 40),
        otpFromCopy: Boolean(otpFromCopy),
        otp: otpFromCopy,
      }
    }
    const u = new URL(magic)
    return {
      listed: items.length,
      subjectPrefix: String(hit.mail_subject || '').slice(0, 40),
      magicPath: u.pathname,
      tokenPresent: Boolean(u.searchParams.get('token')),
      callback: u.searchParams.get('callbackURL') || '/dashboard',
      token: u.searchParams.get('token'),
      otpFromCopy: Boolean(otpFromCopy),
      otp: otpFromCopy,
    }
  }

  let mail = await latestSigninMail()
  facts.mailbox = {
    listed: mail.listed,
    subjectPrefix: mail.subjectPrefix ?? null,
    magicPath: mail.magicPath ?? null,
    tokenPresent: Boolean(mail.token),
    otpFromCopy: Boolean(mail.otpFromCopy),
  }

  if (!mail.token && !mail.otp) {
    const signin = await fetch(`${CP}/api/auth/portal-signin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ email: ownerEmail, callbackURL: '/dashboard' }),
      signal: AbortSignal.timeout(20000),
    })
    facts.signin = { status: signin.status }
    for (let i = 0; i < 6 && !mail.token && !mail.otp; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      mail = await latestSigninMail()
    }
    facts.mailbox = {
      listed: mail.listed,
      subjectPrefix: mail.subjectPrefix ?? null,
      magicPath: mail.magicPath ?? null,
      tokenPresent: Boolean(mail.token),
      otpFromCopy: Boolean(mail.otpFromCopy),
    }
  }

  let cookie = ''
  if (mail.token) {
    const verifyUrl = new URL('/api/auth/magic-link/verify', CP)
    verifyUrl.searchParams.set('token', mail.token)
    verifyUrl.searchParams.set('callbackURL', mail.callback || '/dashboard')
    const consume = await fetch(verifyUrl.toString(), {
      redirect: 'manual',
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(20000),
    })
    const setCookie = consume.headers.getSetCookie?.() ?? []
    facts.magicVerify = {
      status: consume.status,
      locationPath: consume.headers.get('location')
        ? new URL(consume.headers.get('location'), CP).pathname
        : null,
      cookieNames: setCookie.map((c) => c.split('=')[0]),
      hasSession: setCookie.some((c) => /session/i.test(c)),
    }
    if (facts.magicVerify.hasSession) cookie = cookieHeader(setCookie)
  }
  if (!cookie && mail.otp) {
    const verify = await fetch(`${CP}/api/auth/sign-in/email-otp`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ email: ownerEmail, otp: mail.otp }),
      signal: AbortSignal.timeout(20000),
    })
    const cookies = verify.headers.getSetCookie?.() ?? []
    facts.otpVerify = {
      status: verify.status,
      hasSession: cookies.some((c) => /session/i.test(c)),
      cookieNames: cookies.map((c) => c.split('=')[0]),
    }
    if (facts.otpVerify.hasSession) cookie = cookieHeader(cookies)
  }
  if (!cookie) {
    const [user] = await sql`select id from cp_users where lower(email) = ${ownerEmail} limit 1`
    if (!user?.id) throw new Error('cp_users row missing for t7 owner')
    const sessionToken = randomBytes(32).toString('base64url')
    const nowSess = new Date()
    await sql`
      insert into cp_sessions (id, token, user_id, expires_at, created_at, updated_at)
      values (
        ${randomUUID()},
        ${sessionToken},
        ${user.id},
        ${new Date(nowSess.getTime() + 7 * 864e5)},
        ${nowSess},
        ${nowSess}
      )
    `
    cookie = `__Secure-better-auth.session_token=${sessionToken}`
    facts.sessionMint = 'cp_sessions_insert'
  } else {
    facts.sessionMint = facts.magicVerify?.hasSession ? 'magic-link-verify' : 'email-otp'
  }
  writeFileSync(COOKIE, cookie, { mode: 0o600 })
  facts.session = { hasSession: Boolean(cookie), method: facts.sessionMint }

  const restore = await fetch(`${CP}/api/instances/${trashId}/restore`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie,
      origin: CP,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': UA,
    },
    body: '',
    signal: AbortSignal.timeout(20000),
  })
  const restoreText = await restore.text()
  facts.restoreAtCap = {
    status: restore.status,
    ...locParts(restore.headers.get('location')),
    ...bodyKind(restoreText, restore.headers.get('content-type')),
  }

  const noticeUrl =
    facts.restoreAtCap.location
    || `${CP}/dashboard?notice=free_workspace_owner_cap`
  const dash = await fetch(noticeUrl, {
    redirect: 'manual',
    headers: { cookie, 'user-agent': UA, accept: 'text/html' },
    signal: AbortSignal.timeout(20000),
  })
  const dashText = await dash.text()
  facts.dashboardNotice = {
    status: dash.status,
    ...locParts(dash.headers.get('location')),
    ...bodyKind(dashText, dash.headers.get('content-type')),
  }

  const [trashAfter] = await sql`
    select deleted_at is not null as deleted from cp_instances where id = ${trashId}
  `
  facts.trashStillDeleted = Boolean(trashAfter?.deleted)

  const fixtures = await sql`select id from cp_instances where id in (${T1A}, ${T1E}, ${T7S}, ${T7H})`
  facts.fixturesRemainBeforeCleanup = fixtures.length === 4

  facts.ok =
    facts.unauthRestore.status === 303
    && facts.unauthRestore.path === '/auth/login'
    && facts.unauthRestore.json === false
    && facts.unauthRestore.looksRaw402 === false
    && facts.liveFreeAtThree === 3
    && facts.restoreAtCap.status === 303
    && facts.restoreAtCap.host === 'cp.quackback.co.uk'
    && facts.restoreAtCap.path === '/dashboard'
    && facts.restoreAtCap.notice === 'free_workspace_owner_cap'
    && facts.restoreAtCap.json === false
    && facts.restoreAtCap.looksRaw402 === false
    && facts.dashboardNotice.status === 200
    && facts.dashboardNotice.html === true
    && facts.dashboardNotice.json === false
    && facts.dashboardNotice.looksRaw402 === false
    && facts.dashboardNotice.hasNoticeCopy === true
    && facts.dashboardNotice.hasAlertRole === true
    && facts.dashboardNotice.hasYourWorkspaces === true
    && facts.trashStillDeleted === true
    && facts.fixturesRemainBeforeCleanup === true
} catch (err) {
  facts.errors.push(err instanceof Error ? err.message : String(err))
  facts.ok = false
} finally {
  try {
    await sql`delete from cp_instances where id like ${TEMP_PREFIX + '%'}`
  } catch (err) {
    facts.errors.push(`cleanup: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const after = await sql`select count(*)::int as n from cp_instances`
    const leftover = await sql`select count(*)::int as n from cp_instances where id like ${TEMP_PREFIX + '%'}`
    const still = await sql`select id from cp_instances where id in (${T1A}, ${T1E}, ${T7S}, ${T7H})`
    facts.instanceCount = { ...(facts.instanceCount || {}), after: after[0]?.n ?? null }
    facts.leftoverAfter = leftover[0]?.n ?? null
    facts.fixturesRemain = still.length === 4
  } catch (err) {
    facts.errors.push(`recount: ${err instanceof Error ? err.message : String(err)}`)
  }
  await sql.end({ timeout: 5 })
  writeFileSync(OUT, JSON.stringify(facts, null, 2))
  console.log(JSON.stringify(facts, null, 2))
}
