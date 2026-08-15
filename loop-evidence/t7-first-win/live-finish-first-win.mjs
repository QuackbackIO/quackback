#!/usr/bin/env bun
/**
 * Finish first-win on the two workspaces just created. Sign in via
 * guerrilla + magic link, Change goal, then publish / widget.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '/home/james/quackback-wt/saas-merge/node_modules/.bun/playwright-core@1.59.1/node_modules/playwright-core/index.mjs'

const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/t7-first-win/live-support-hc'
mkdirSync(OUT, { recursive: true })
const CP = 'https://cp.quackback.co.uk'
const UA = 'quackback-t7-live-finish/2026-08-15'
const SUFFIX = '9ca3a708'

const TARGETS = [
  {
    local: `walk-t7-sup-${SUFFIX}`,
    host: 'sup9ca3a708.quackback.co.uk',
    goal: 'Customer support',
    label: 'sup',
    firstWinTitle: 'Receive your first customer conversation',
  },
  {
    local: `walk-t7-hc-${SUFFIX}`,
    host: 'hc9ca3a708.quackback.co.uk',
    goal: 'Help Center',
    label: 'hc',
    firstWinTitle: 'Publish your first article',
  },
]

const facts = { at: new Date().toISOString(), walks: [], errors: [] }

async function gm(jar, fn, extra = '') {
  const res = await fetch(`https://api.guerrillamail.com/ajax.php?f=${fn}${extra}`, {
    headers: { 'user-agent': UA, cookie: jar.join('; ') },
  })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0]
    if (pair) jar.push(pair)
  }
  return res.json()
}

async function signIn(local) {
  const jar = []
  await gm(jar, 'get_email_address')
  const set = await gm(jar, 'set_email_user', `&email_user=${encodeURIComponent(local)}&lang=en`)
  const email = String(set.email_addr || `${local}@guerrillamail.com`)
  const prior = await gm(jar, 'get_email_list', '&offset=0')
  const priorIds = new Set((prior.list || []).map((i) => String(i.mail_id)))
  await fetch(`${CP}/api/auth/portal-signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ email, callbackURL: '/dashboard' }),
  })
  let token = null
  let callback = '/dashboard'
  for (let i = 0; i < 15 && !token; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const list = await gm(jar, 'get_email_list', '&offset=0')
    const items = (Array.isArray(list?.list) ? list.list : []).filter(
      (hit) => !priorIds.has(String(hit.mail_id)),
    )
    for (const hit of items.slice(0, 5)) {
      const full = await gm(jar, 'fetch_email', `&email_id=${encodeURIComponent(hit.mail_id)}`)
      const body = `${full?.mail_subject || ''}\n${full?.mail_body || ''}`
      const link = body.match(/https:\/\/cp\.quackback\.co\.uk\/[^\s"'<>]+/i)
      if (!link) continue
      const u = new URL(link[0].replace(/&amp;/g, '&'))
      token = u.searchParams.get('token')
      callback = u.searchParams.get('callbackURL') || '/dashboard'
    }
  }
  if (!token) throw new Error(`no token for ${local}`)
  const verifyUrl = new URL('/api/auth/magic-link/verify', CP)
  verifyUrl.searchParams.set('token', token)
  verifyUrl.searchParams.set('callbackURL', callback)
  const consume = await fetch(verifyUrl.toString(), { redirect: 'manual', headers: { 'user-agent': UA } })
  const cookie = (consume.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error('no session')
  return { email, cookie }
}

async function finish(target) {
  const walk = { label: target.label, host: target.host, steps: [], errors: [] }
  facts.walks.push(walk)
  const session = await signIn(target.local)
  walk.emailDomain = session.email.split('@')[1]
  const open = await fetch(`${CP}/dashboard`, {
    headers: { cookie: session.cookie, 'user-agent': UA },
    redirect: 'follow',
  })
  walk.dashboard = open.url

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
    const instOpen = await fetch(`${CP}/dashboard`, {
      headers: { cookie: session.cookie, 'user-agent': UA },
    })
    const html = await instOpen.text()
    const inst = (html.match(/\/api\/instances\/(inst_[a-z0-9]+)\//i) || [])[1]
    if (inst) {
      const opened = await fetch(`${CP}/api/instances/${inst}/open`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          cookie: session.cookie,
          origin: CP,
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': UA,
        },
        body: '',
      })
      const loc = opened.headers.get('location')
      walk.open = { status: opened.status, hasOtt: Boolean(loc?.includes('ott=')), host: loc ? new URL(loc).hostname : null }
      if (loc) await page.goto(loc, { waitUntil: 'domcontentloaded', timeout: 60000 })
    } else {
      await page.goto(`https://${target.host}/admin/getting-started`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    }
    await page.waitForTimeout(2000)
    await page.goto(`https://${target.host}/admin/getting-started`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.getByRole('heading', { name: /your launch plan/i }).waitFor({ timeout: 20000 })
    await page.waitForTimeout(1500)

    const change = page.getByRole('button', { name: /^change goal$/i })
    if (await change.count()) {
      await change.click()
      await page.getByRole('button', { name: /use this goal/i }).waitFor({ timeout: 10000 })
      await page.getByText(target.goal, { exact: true }).first().click()
      await page.getByRole('button', { name: /use this goal/i }).click()
      await page.getByRole('heading', { name: new RegExp(`^${target.goal}$`, 'i') }).waitFor({ timeout: 20000 })
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: `${OUT}/${target.label}-20-goal.png`, fullPage: true })
    walk.afterGoal = await page.locator('body').innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 400))

    if (target.label === 'hc') {
      await page.goto(`https://${target.host}/admin/help-center`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForTimeout(2000)
      const link = page.getByRole('link').filter({ hasText: /.+/ }).nth(0)
      if (await page.getByRole('link', { name: /article|getting|guide|untitled/i }).count()) {
        await page.getByRole('link', { name: /article|getting|guide|untitled/i }).first().click()
      } else if (await page.getByRole('button', { name: /new article|create/i }).count()) {
        await page.getByRole('button', { name: /new article|create/i }).first().click()
      }
      await page.waitForTimeout(2000)
      const title = page.getByLabel(/title/i).first()
      if (await title.count()) await title.fill(`First help article ${SUFFIX}`)
      const publish = page.getByRole('button', { name: /^publish$/i })
      if (await publish.count()) {
        await publish.click()
        await page.waitForTimeout(2500)
      }
      await page.screenshot({ path: `${OUT}/${target.label}-21-article.png`, fullPage: true })
    }

    if (target.label === 'sup') {
      await page.goto(`https://${target.host}/admin/settings/widget/install`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      })
      await page.waitForTimeout(2000)
      const enable = page.getByRole('button', { name: /enable messenger|turn on|connect messenger|save|enable/i }).first()
      if (await enable.count()) await enable.click()
      await page.screenshot({ path: `${OUT}/${target.label}-21-install.png`, fullPage: true })
    }

    await page.goto(`https://${target.host}/admin/getting-started`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(2000)
    const body = await page.locator('body').innerText()
    walk.launch = {
      goal: (body.match(/current goal\s+([^\n]+)/i) || [])[1] || null,
      firstWinTitle: (body.match(new RegExp(target.firstWinTitle, 'i')) || [])[0] || null,
      milestone: /milestone reached|first win reached/i.test(body),
      snippet: body.replace(/\s+/g, ' ').slice(0, 500),
    }
    await page.screenshot({ path: `${OUT}/${target.label}-22-launch.png`, fullPage: true })
  } catch (err) {
    walk.errors.push(String(err).slice(0, 400))
    facts.errors.push(`${target.label}: ${String(err).slice(0, 300)}`)
  } finally {
    await browser.close()
  }
}

for (const t of TARGETS) {
  await finish(t)
}
writeFileSync(`${OUT}/finish.json`, JSON.stringify(facts, null, 2))
console.log(JSON.stringify({ walks: facts.walks, errors: facts.errors }, null, 2))
