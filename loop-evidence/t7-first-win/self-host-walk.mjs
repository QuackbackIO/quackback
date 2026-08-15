#!/usr/bin/env bun
/**
 * Local self-host Bar C + internal first-win. No Neon, no live hosts, no pay.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '/home/james/quackback-wt/saas-merge/node_modules/.bun/playwright-core@1.59.1/node_modules/playwright-core/index.mjs'

const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/t7-first-win/self-host-walk'
mkdirSync(OUT, { recursive: true })
const ORIGIN = 'http://localhost:3000'
const EMAIL = 'demo@example.com'
const PASSWORD = 'password'

const facts = {
  at: new Date().toISOString(),
  origin: ORIGIN,
  role: 'all',
  cloud: 'absent',
  steps: [],
  errors: [],
}

function rec(step, extra = {}) {
  facts.steps.push({ step, ...extra })
}

const jar = []
function cookieHeader() {
  return jar.map((c) => c.split(';')[0]).join('; ')
}

const signin = await fetch(`${ORIGIN}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})
for (const c of signin.headers.getSetCookie?.() ?? []) jar.push(c)
const signinJson = await signin.json().catch(() => ({}))
rec('signin', {
  status: signin.status,
  user: signinJson?.user?.email === EMAIL,
  hasToken: Boolean(signinJson?.token),
  cookieNames: jar.map((c) => c.split('=')[0]),
})
if (signin.status !== 200 || !signinJson?.token) {
  facts.errors.push('signin failed')
  writeFileSync(`${OUT}/walk.json`, JSON.stringify(facts, null, 2))
  throw new Error('signin failed')
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const now = Date.now() / 1000
await context.addCookies(
  jar.map((raw) => {
    const [nv] = raw.split(';')
    const eq = nv.indexOf('=')
    const name = nv.slice(0, eq)
    const value = nv.slice(eq + 1)
    return {
      name,
      value,
      url: ORIGIN,
      httpOnly: /httponly/i.test(raw),
      secure: /secure/i.test(raw),
      sameSite: 'Lax',
      expires: now + 60 * 60 * 24,
    }
  })
)
const page = await context.newPage()

async function shot(name, path) {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(1500)
  const file = `${OUT}/${name}.png`
  await page.screenshot({ path: file, fullPage: true })
  const body = await page.locator('body').innerText().catch(() => '')
  const html = await page.content()
  rec(name, {
    url: page.url(),
    title: await page.title(),
    hasPlanBilling: /plan\s*&\s*billing/i.test(body) || /plan\s*&\s*billing/i.test(html),
    hasSwitchWorkspace: /switch workspace/i.test(body) || /switch workspace/i.test(html),
    hasQuackbackUrl: /friendly quackback url|quackback url/i.test(body),
    hasWsPrefill: /ws-[0-9a-f]{12,}/i.test(body),
    hasTrial: /start .*trial|14-day/i.test(body),
    hasUpgrade: /\bupgrade\b/i.test(body),
    hasFirstWin: /first (customer|team|win)|you.re up and running|collect your first/i.test(body),
    firstWinTitle: (body.match(/collect your first team idea|receive your first customer|publish your first article/i) || [])[0] || null,
    upAndRunning: /you.re up and running/i.test(body),
    workspaceName: /acme/i.test(body),
    snippet: body.replace(/\s+/g, ' ').slice(0, 400),
    shot: file.replace('/home/james/quackback-wt/saas-merge/', ''),
  })
}

try {
  await shot('01-admin', '/admin')
  await shot('02-general', '/admin/settings/general')
  await shot('03-getting-started', '/admin/getting-started')
  await shot('04-feedback', '/admin/feedback')
} catch (err) {
  facts.errors.push(String(err).slice(0, 300))
  await page.screenshot({ path: `${OUT}/zz-error.png`, fullPage: true }).catch(() => {})
} finally {
  await browser.close()
}

const barC = facts.steps
  .filter((s) => ['01-admin', '02-general', '03-getting-started'].includes(s.step))
  .every(
    (s) =>
      s.hasPlanBilling === false &&
      s.hasSwitchWorkspace === false &&
      s.hasQuackbackUrl === false &&
      s.hasWsPrefill === false
  )
facts.barC = barC
facts.internalFirstWin =
  facts.steps.find((s) => s.step === '03-getting-started')?.firstWinTitle ||
  facts.steps.find((s) => s.step === '03-getting-started')?.upAndRunning ||
  null

writeFileSync(`${OUT}/walk.json`, JSON.stringify(facts, null, 2))
console.log(
  JSON.stringify({
    signin: signin.status,
    barC,
    internalFirstWin: facts.internalFirstWin,
    errors: facts.errors,
    out: OUT,
  })
)
