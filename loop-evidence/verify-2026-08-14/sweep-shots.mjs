#!/usr/bin/env bun
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { chromium } from '/home/james/quackback-wt/saas-merge/node_modules/.bun/playwright-core@1.59.1/node_modules/playwright-core/index.mjs'

const OUT = '/home/james/quackback-wt/saas-merge/loop-evidence/verify-2026-08-14'
const COOKIE_A = '/tmp/verify-2026-08-14-t1a.cookie'
const COOKIE_E = '/tmp/verify-2026-08-14-t1e.cookie'
const COOKIE_CP = '/tmp/verify-2026-08-14-cp.cookie'
const HOST_A = 'south63792f.quackback.co.uk'
const HOST_E = 'northfa99f0.quackback.co.uk'
const CP = 'cp.quackback.co.uk'

function parseCookie(raw, domain) {
  if (!raw) return []
  return raw
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      return {
        name: pair.slice(0, eq),
        value: pair.slice(eq + 1),
        domain,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      }
    })
}

const shots = []
const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

async function shot(name, url, cookies, waitMs = 2500) {
  const host = new URL(url).hostname
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  if (cookies?.length) await ctx.addCookies(cookies)
  const page = await ctx.newPage()
  const rec = { name, url, status: null, finalUrl: null, title: null, error: null }
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    rec.status = resp?.status() ?? null
    await page.waitForTimeout(waitMs)
    rec.finalUrl = page.url()
    rec.title = await page.title()
    rec.bodyText = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 500)
    const path = `${OUT}/${name}.png`
    await page.screenshot({ path, fullPage: true })
    rec.file = `${name}.png`
  } catch (err) {
    rec.error = err instanceof Error ? err.message : String(err)
    try {
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
      rec.file = `${name}.png`
    } catch {}
  }
  await ctx.close()
  shots.push(rec)
  console.log(`${rec.status ?? rec.error} ${name} ${rec.finalUrl ?? url}`)
}

try {
  const cookieA = existsSync(COOKIE_A) ? parseCookie(readFileSync(COOKIE_A, 'utf8'), HOST_A) : []
  const cookieE = existsSync(COOKIE_E) ? parseCookie(readFileSync(COOKIE_E, 'utf8'), HOST_E) : []
  const cookieCp = existsSync(COOKIE_CP) ? parseCookie(readFileSync(COOKIE_CP, 'utf8'), CP) : []

  await shot('01-cp-login', `https://${CP}/login`, [])
  if (cookieCp.length) await shot('02-cp-dashboard', `https://${CP}/dashboard`, cookieCp)
  await shot('03-t1a-public', `https://${HOST_A}/?sort=trending`, [])
  await shot('04-t1e-public', `https://${HOST_E}/?sort=trending`, [])
  if (cookieA.length) {
    await shot('05-t1a-admin', `https://${HOST_A}/admin`, cookieA)
    await shot('06-t1a-inbox', `https://${HOST_A}/admin/inbox`, cookieA)
    await shot('07-t1a-general', `https://${HOST_A}/admin/settings/general`, cookieA)
    await shot('08-t1a-billing', `https://${HOST_A}/admin/settings/billing`, cookieA)
    await shot('09-t1a-help-center', `https://${HOST_A}/admin/settings/help-center`, cookieA)
    await shot('10-t1a-channels', `https://${HOST_A}/admin/settings/channels`, cookieA)
    await shot('11-t1a-sso-new', `https://${HOST_A}/admin/settings/security/sso/new`, cookieA)
  }
  if (cookieE.length) {
    await shot('12-t1e-admin', `https://${HOST_E}/admin`, cookieE)
    await shot('13-t1e-general', `https://${HOST_E}/admin/settings/general`, cookieE)
    await shot('14-t1e-billing', `https://${HOST_E}/admin/settings/billing`, cookieE)
  }
} finally {
  await browser.close()
}

writeFileSync(`${OUT}/screenshots.json`, JSON.stringify({ at: new Date().toISOString(), shots }, null, 2))
console.log(`wrote ${OUT}/screenshots.json n=${shots.length}`)
