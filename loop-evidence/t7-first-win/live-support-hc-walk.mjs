#!/usr/bin/env bun
/**
 * Live support + Help Center first-win. Creates two CP workspaces
 * (each provisions a Neon project via the control plane). Operator
 * authorized Neon. Expected extra spend: two 0.25 CU scale-to-zero
 * projects, well under $50/month above the Development baseline.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { chromium } from '/home/james/quackback-wt/saas-merge/node_modules/.bun/playwright-core@1.59.1/node_modules/playwright-core/index.mjs'

const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/t7-first-win/live-support-hc'
mkdirSync(OUT, { recursive: true })
const CP = 'https://cp.quackback.co.uk'
const UA = 'quackback-t7-live-support-hc/2026-08-15'
const PROJECT = 'bd11fc75-db00-4940-b70c-4bddeed30a9f'
const ENV = 'aa05f0e8-eeec-4d72-a0d3-c074ee434568'
const SERVICE = 'quackback-control-plane'
const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8)

const facts = {
  at: new Date().toISOString(),
  expectedMonthlyExtraUsd: '<10',
  spendCapUsd: 50,
  neonVia: 'control-plane provisioner (qb-cp-* prefix)',
  walks: [],
  errors: [],
}

function rec(walk, step, extra = {}) {
  walk.steps.push({ step, at: new Date().toISOString(), ...extra })
}

async function gm(jar, fn, extra = '') {
  const res = await fetch(`https://api.guerrillamail.com/ajax.php?f=${fn}${extra}`, {
    headers: { 'user-agent': UA, cookie: jar.join('; ') },
    signal: AbortSignal.timeout(20000),
  })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0]
    if (pair) jar.push(pair)
  }
  return res.json()
}

function cpSql(js) {
  const result = spawnSync(
    'railway',
    [
      'run',
      '--project',
      PROJECT,
      '--environment',
      ENV,
      '--service',
      SERVICE,
      '--',
      'bun',
      '-e',
      js,
    ],
    {
      cwd: '/home/james/quackback-cp',
      encoding: 'utf8',
      env: {
        ...process.env,
        RAILWAY_CALLER: 'skill:use-railway@1.3.7',
        RAILWAY_AGENT_SESSION: 'neon-firstwin-20260815',
      },
      timeout: 120000,
    },
  )
  if (result.status !== 0) {
    throw new Error(`railway run failed: ${(result.stderr || result.stdout || '').slice(-400)}`)
  }
  const line = (result.stdout || '').trim().split('\n').filter(Boolean).at(-1)
  return JSON.parse(line)
}

function readOtp(email) {
  const js = `
import postgres from "postgres";
const s = postgres(process.env.DATABASE_URL, { max: 1 });
const rows = await s\`select value from cp_verifications where identifier ilike \${'%' + ${JSON.stringify(email)} + '%'} order by created_at desc limit 12\`;
const otp = rows.find((r) => /^[0-9]{6}$/.test(String(r.value)));
console.log(JSON.stringify({ otp: otp ? String(otp.value) : null, n: rows.length }));
await s.end({ timeout: 5 });
`
  return cpSql(js)
}

function listOwnerWorkspaces(email) {
  const js = `
import postgres from "postgres";
const s = postgres(process.env.DATABASE_URL, { max: 1 });
const rows = await s\`
  select i.id, i.state, r.primary_hostname, r.state as registry_state
  from cp_instances i
  left join cp_tenant_registry r on r.workspace_key = i.id
  where i.owner_email ilike \${${JSON.stringify(email)}}
  order by i.created_at desc
\`;
console.log(JSON.stringify(rows));
await s.end({ timeout: 5 });
`
  return cpSql(js)
}

function instanceCount() {
  return cpSql(`
import postgres from "postgres";
const s = postgres(process.env.DATABASE_URL, { max: 1 });
const r = await s\`select count(*)::int as n from cp_instances\`;
console.log(JSON.stringify(r[0]));
await s.end({ timeout: 5 });
`)
}

async function createMailbox(local) {
  const jar = []
  await gm(jar, 'get_email_address')
  const set = await gm(jar, 'set_email_user', `&email_user=${encodeURIComponent(local)}&lang=en`)
  const email = String(set.email_addr || `${local}@guerrillamail.com`)
  return { jar, email }
}

async function readMailboxToken(jar) {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 2000))
    const list = await gm(jar, 'get_email_list', '&offset=0')
    const items = Array.isArray(list?.list) ? list.list : []
    for (const hit of items.slice(0, 5)) {
      const full = await gm(jar, 'fetch_email', `&email_id=${encodeURIComponent(hit.mail_id)}`)
      const body = `${full?.mail_subject || ''}\n${full?.mail_body || ''}`
      const link = body.match(/https:\/\/cp\.quackback\.co\.uk\/[^\s"'<>]+/i)
      if (!link) continue
      const u = new URL(link[0].replace(/&amp;/g, '&'))
      const token = u.searchParams.get('token')
      if (token) {
        return { token, callback: u.searchParams.get('callbackURL') || '/dashboard' }
      }
    }
  }
  return null
}

async function signInCp(email, jar) {
  const signin = await fetch(`${CP}/api/auth/portal-signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ email, callbackURL: '/dashboard' }),
    signal: AbortSignal.timeout(20000),
  })
  if (signin.status >= 400) throw new Error(`portal-signin ${signin.status}`)
  const mail = await readMailboxToken(jar)
  if (!mail) throw new Error(`no magic token in mailbox for ${email.split('@')[1]}`)
  const verifyUrl = new URL('/api/auth/magic-link/verify', CP)
  verifyUrl.searchParams.set('token', mail.token)
  verifyUrl.searchParams.set('callbackURL', mail.callback)
  const consume = await fetch(verifyUrl.toString(), {
    redirect: 'manual',
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(20000),
  })
  const cookies = consume.headers.getSetCookie?.() ?? []
  const cookie = cookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ')
  if (!cookie) throw new Error(`magic verify ${consume.status} set no session`)
  return { cookie, status: consume.status, method: 'magic' }
}

async function waitForWorkspace(email, walk) {
  for (let i = 0; i < 24; i++) {
    const rows = listOwnerWorkspaces(email)
    rec(walk, 'poll-workspace', { attempt: i, n: rows.length, states: rows.map((r) => r.state) })
    const ready = rows.find((r) => r.primary_hostname && r.state !== 'failed')
    if (ready) return ready
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('workspace not ready after 2m')
}

async function openWorkspace(cookie, instanceId) {
  const open = await fetch(`${CP}/api/instances/${instanceId}/open`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie,
      origin: CP,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': UA,
    },
    body: '',
    signal: AbortSignal.timeout(30000),
  })
  const loc = open.headers.get('location')
  return { status: open.status, location: loc }
}

async function walkOutcome({ goalLabel, name, label, firstWinTitle }) {
  const walk = { goalLabel, name, label, steps: [], errors: [] }
  facts.walks.push(walk)
  const local = `walk-t7-${label}-${suffix}`
  const box = await createMailbox(local)
  rec(walk, 'mailbox', { emailDomain: box.email.split('@')[1], local })
  const session = await signInCp(box.email, box.jar)
  rec(walk, 'cp-session', { status: session.status, method: session.method })

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, userAgent: UA })
    const now = Date.now() / 1000
    await ctx.addCookies(
      session.cookie.split('; ').map((pair) => {
        const eq = pair.indexOf('=')
        return {
          name: pair.slice(0, eq),
          value: pair.slice(eq + 1),
          domain: 'cp.quackback.co.uk',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'Lax',
          expires: now + 86400,
        }
      }),
    )
    const page = await ctx.newPage()
    await page.goto(`${CP}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    rec(walk, 'dashboard', { url: page.url() })
    await page.screenshot({ path: `${OUT}/${label}-00-setup.png`, fullPage: true })

    // Auto-create + provision + OpeningPane. Allow a few minutes for Neon.
    await page.waitForURL(
      (url) => url.hostname.endsWith('quackback.co.uk') && url.hostname !== 'cp.quackback.co.uk',
      { timeout: 240000 },
    )
    rec(walk, 'after-provision', { url: page.url() })
    await page.screenshot({ path: `${OUT}/${label}-01-handoff.png`, fullPage: true })
    const landed = new URL(page.url())
    walk.host = landed.hostname
    walk.instanceId = landed.hostname.startsWith('ws-')
      ? `ws:${landed.hostname}`
      : landed.hostname

    const nameInput = page.locator('#cloud-workspace-name')
    if (await nameInput.count()) {
      await nameInput.fill(name)
      await page.locator('#cloud-platform-label').fill(label + suffix)
      await page.getByRole('button', { name: /^continue$/i }).click()
      await page.waitForTimeout(3000)
      rec(walk, 'details', { url: page.url() })
      await page.screenshot({ path: `${OUT}/${label}-02-after-details.png`, fullPage: true })
    }

    const goal = page.getByText(goalLabel, { exact: true }).first()
    if (await goal.count()) {
      await goal.click()
      const next = page.getByRole('button', { name: /continue|use this goal/i }).first()
      if (await next.count()) await next.click()
      await page.waitForTimeout(2500)
    }
    rec(walk, 'goal', { url: page.url() })
    await page.screenshot({ path: `${OUT}/${label}-03-goal.png`, fullPage: true })

    const ready = page.getByRole('button', { name: /open|connect|continue|view your launch plan|publish/i }).first()
    if (await ready.count()) {
      await ready.click()
      await page.waitForTimeout(2500)
    }
    rec(walk, 'ready', { url: page.url() })
    await page.screenshot({ path: `${OUT}/${label}-04-ready.png`, fullPage: true })

    if (label === 'hc') {
      await page.goto(`https://${walk.host}/admin/help-center`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      })
      await page.waitForTimeout(2000)
      const article = page.getByRole('link').filter({ hasText: /article|getting started|untitled/i }).first()
      if (await article.count()) await article.click()
      else {
        const create = page.getByRole('button', { name: /new article|create/i }).first()
        if (await create.count()) await create.click()
      }
      await page.waitForTimeout(2000)
      const title = page.getByLabel(/title/i).first()
      if (await title.count()) await title.fill(`First help article ${suffix}`)
      const publish = page.getByRole('button', { name: /^publish$/i })
      if (await publish.count()) {
        await publish.click()
        await page.waitForTimeout(2000)
      }
      rec(walk, 'publish', { url: page.url(), hasPublish: await publish.count() })
      await page.screenshot({ path: `${OUT}/${label}-05-article.png`, fullPage: true })
    }

    if (label === 'sup') {
      await page.goto(`https://${walk.host}/admin/settings/widget/install`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      })
      await page.waitForTimeout(2000)
      const enable = page.getByRole('button', { name: /enable|connect|turn on|save/i }).first()
      if (await enable.count()) {
        await enable.click()
        await page.waitForTimeout(1500)
      }
      rec(walk, 'messenger', { url: page.url() })
      await page.screenshot({ path: `${OUT}/${label}-05-install.png`, fullPage: true })
      await page.goto(`https://${walk.host}/widget`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      })
      await page.waitForTimeout(2500)
      const composer = page.getByPlaceholder(/message|ask|type/i).first()
      if (await composer.count()) {
        await composer.fill(`First customer conversation ${suffix}`)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(2000)
      }
      rec(walk, 'widget', { url: page.url(), composer: await composer.count() })
      await page.screenshot({ path: `${OUT}/${label}-06-widget.png`, fullPage: true })
    }

    await page.goto(`https://${walk.host}/admin/getting-started`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    })
    await page.waitForTimeout(2500)
    const body = await page.locator('body').innerText()
    walk.launch = {
      url: page.url(),
      firstWinTitle: (body.match(new RegExp(firstWinTitle, 'i')) || [])[0] || null,
      milestone: /milestone reached|first win reached|you.re up and running/i.test(body),
      snippet: body.replace(/\s+/g, ' ').slice(0, 500),
    }
    rec(walk, 'launch', walk.launch)
    await page.screenshot({ path: `${OUT}/${label}-10-launch.png`, fullPage: true })
  } catch (err) {
    walk.errors.push(String(err).slice(0, 500))
    facts.errors.push(`${label}: ${String(err).slice(0, 300)}`)
  } finally {
    await browser.close()
  }
  return walk
}

facts.instanceCountBefore = (await instanceCount()).n

try {
  await walkOutcome({
    goalLabel: 'Customer support',
    name: 'Support walk',
    label: 'sup',
    firstWinTitle: 'Receive your first customer conversation',
  })
  await walkOutcome({
    goalLabel: 'Help Center',
    name: 'Help Center walk',
    label: 'hc',
    firstWinTitle: 'Publish your first article',
  })
} catch (err) {
  facts.errors.push(String(err).slice(0, 400))
}

facts.instanceCountAfter = (await instanceCount()).n
writeFileSync(`${OUT}/walk.json`, JSON.stringify(facts, null, 2))
console.log(
  JSON.stringify(
    {
      before: facts.instanceCountBefore,
      after: facts.instanceCountAfter,
      walks: facts.walks.map((w) => ({
        label: w.label,
        host: w.host,
        instanceId: w.instanceId,
        launch: w.launch ?? null,
        errors: w.errors,
        steps: w.steps.map((s) => s.step),
      })),
      errors: facts.errors,
    },
    null,
    2,
  ),
)
