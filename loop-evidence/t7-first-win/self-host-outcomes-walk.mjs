#!/usr/bin/env bun
/**
 * Local self-host support + Help Center first-win via Change goal.
 * Restores Internal. No Neon, no live hosts, no pay.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '/home/james/quackback-wt/saas-merge/node_modules/.bun/playwright-core@1.59.1/node_modules/playwright-core/index.mjs'

const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/t7-first-win/self-host-outcomes'
mkdirSync(OUT, { recursive: true })
const ORIGIN = 'http://localhost:3000'
const EMAIL = 'demo@example.com'
const PASSWORD = 'password'

const facts = { at: new Date().toISOString(), origin: ORIGIN, steps: [], errors: [] }
function rec(step, extra = {}) {
  facts.steps.push({ step, ...extra })
}

const jar = []
const signin = await fetch(`${ORIGIN}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})
for (const c of signin.headers.getSetCookie?.() ?? []) jar.push(c)
const signinJson = await signin.json().catch(() => ({}))
rec('signin', { status: signin.status, user: signinJson?.user?.email === EMAIL })
if (signin.status !== 200) {
  writeFileSync(`${OUT}/walk.json`, JSON.stringify(facts, null, 2))
  throw new Error(`signin ${signin.status}`)
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const now = Date.now() / 1000
await context.addCookies(
  jar.map((raw) => {
    const [nv] = raw.split(';')
    const eq = nv.indexOf('=')
    return {
      name: nv.slice(0, eq),
      value: nv.slice(eq + 1),
      url: ORIGIN,
      httpOnly: /httponly/i.test(raw),
      secure: /secure/i.test(raw),
      sameSite: 'Lax',
      expires: now + 86400,
    }
  })
)
const page = await context.newPage()

function summarize(body) {
  return {
    hasPlanBilling: /plan\s*&\s*billing/i.test(body),
    hasSwitchWorkspace: /switch workspace/i.test(body),
    hasQuackbackUrl: /friendly quackback url|quackback url/i.test(body),
    hasTrial: /start .*trial|14-day/i.test(body),
    goal: (body.match(/current goal\s+([^\n]+)/i) || [])[1] || null,
    firstWinTitle:
      (body.match(
        /receive your first customer conversation|publish your first article|collect your first team idea|receive your first customer post/i
      ) || [])[0] || null,
    upAndRunning: /you.re up and running/i.test(body),
    milestoneReached: /milestone reached/i.test(body),
    snippet: body.replace(/\s+/g, ' ').slice(0, 400),
  }
}

async function openLaunch() {
  await page.goto(`${ORIGIN}/admin/getting-started`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.getByRole('heading', { name: /your launch plan/i }).waitFor({ timeout: 15000 })
}

async function setGoal(label) {
  const change = page.getByRole('button', { name: /^change goal$/i })
  await change.waitFor({ state: 'visible', timeout: 8000 })
  if (await change.isDisabled()) throw new Error('Change goal is disabled')
  await change.click()
  const save = page.getByRole('button', { name: /use this goal/i })
  await save.waitFor({ state: 'visible', timeout: 10000 })
  const option = page.getByText(label, { exact: true }).first()
  await option.click()
  await save.click()
  await page.getByRole('heading', { name: new RegExp(`^${label}$`, 'i') }).waitFor({
    timeout: 15000,
  })
  await page.waitForTimeout(800)
}

async function shot(name) {
  const file = `${OUT}/${name}.png`
  await page.screenshot({ path: file, fullPage: true })
  const body = await page.locator('body').innerText()
  rec(name, { url: page.url(), ...summarize(body), shot: file.replace('/home/james/quackback-wt/saas-merge/', '') })
}

try {
  await openLaunch()
  await shot('00-internal-before')

  await setGoal('Customer support')
  await shot('10-support')

  await setGoal('Help Center')
  await shot('20-help-center')

  await setGoal('Internal feedback')
  await shot('30-internal-restored')
} catch (err) {
  facts.errors.push(String(err).slice(0, 400))
  await page.screenshot({ path: `${OUT}/zz-error.png`, fullPage: true }).catch(() => {})
} finally {
  await browser.close()
}

const support = facts.steps.find((s) => s.step === '10-support')
const hc = facts.steps.find((s) => s.step === '20-help-center')
const restored = facts.steps.find((s) => s.step === '30-internal-restored')
facts.supportOk = Boolean(
  support?.firstWinTitle && /conversation/i.test(support.firstWinTitle) && support.upAndRunning
)
facts.helpCenterOk = Boolean(
  hc?.firstWinTitle && /article/i.test(hc.firstWinTitle) && hc.upAndRunning
)
facts.restoredInternal = Boolean(restored?.firstWinTitle && /team idea/i.test(restored.firstWinTitle))

writeFileSync(`${OUT}/walk.json`, JSON.stringify(facts, null, 2))
console.log(
  JSON.stringify({
    signin: signin.status,
    supportOk: facts.supportOk,
    helpCenterOk: facts.helpCenterOk,
    restoredInternal: facts.restoredInternal,
    errors: facts.errors,
  })
)
