#!/usr/bin/env bun
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const require = createRequire('/home/james/kimiwow/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const url = readFileSync('/tmp/t1e-checkout-url.txt', 'utf8').trim()
const outDir = '/home/james/quackback-wt/saas-merge/loop-evidence/this-fire/t1e-pay'
mkdirSync(outDir, { recursive: true })

const facts = {
  startedAt: new Date().toISOString(),
  steps: [],
  urlHost: (() => {
    try {
      return new URL(url).host
    } catch {
      return null
    }
  })(),
  sessionPrefix: /cs_test_/.test(url) ? 'cs_test_' : /cs_live_/.test(url) ? 'cs_live_' : null,
}

if (!url.includes('checkout.stripe.com') || !url.includes('cs_test_')) {
  facts.error = 'refusing: checkout url is not test-mode hosted checkout'
  writeFileSync(`${outDir}/complete-attempt.json`, JSON.stringify(facts, null, 2))
  console.log(JSON.stringify(facts, null, 2))
  process.exit(2)
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } })
page.setDefaultTimeout(25000)

async function shot(name) {
  const path = `${outDir}/${name}`
  await page.screenshot({ path, fullPage: true }).catch(() => {})
  facts.steps.push({ at: `shot:${name}`, urlHost: safeHost() })
}

function safeHost() {
  try {
    return new URL(page.url()).host
  } catch {
    return null
  }
}

async function fillFirst(selectors, value, label) {
  for (const sel of selectors) {
    const loc = typeof sel === 'string' ? page.locator(sel) : sel
    const n = await loc.count().catch(() => 0)
    if (!n) continue
    const target = loc.first()
    if (!(await target.isVisible().catch(() => false))) continue
    await target.click({ timeout: 5000 }).catch(() => {})
    await target.fill('')
    await target.fill(value)
    facts.steps.push({ at: label, via: typeof sel === 'string' ? sel : 'locator' })
    return true
  }
  facts.steps.push({ at: `${label}-missing` })
  return false
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(2500)
  facts.steps.push({ at: 'loaded', urlHost: safeHost() })
  await shot('01-loaded.png')

  await fillFirst(
    [page.getByPlaceholder('1234 1234 1234 1234'), 'input[name="number"]', 'input[autocomplete="cc-number"]'],
    '4242424242424242',
    'card-number',
  )
  await fillFirst(
    [page.getByPlaceholder('MM / YY'), 'input[name="expiry"]', 'input[autocomplete="cc-exp"]'],
    '1234',
    'expiry',
  )
  await fillFirst(
    [page.getByPlaceholder('CVC'), 'input[name="cvc"]', 'input[autocomplete="cc-csc"]'],
    '123',
    'cvc',
  )
  await fillFirst(
    [page.getByPlaceholder('Full name on card'), page.getByLabel('Cardholder name'), 'input[name="name"]'],
    'T1e Walk',
    'name',
  )

  const country = page.getByLabel('Country').or(page.getByLabel('Country or region'))
  if (await country.count()) {
    await country.selectOption({ label: 'United Kingdom' }).catch(async () => {
      await country.click()
      await page.getByRole('option', { name: /united kingdom/i }).click().catch(() => {})
    })
    facts.steps.push({ at: 'country-gb' })
  }

  const manual = page.getByText('Enter address manually')
  if (await manual.count()) {
    await manual.first().click().catch(() => {})
    facts.steps.push({ at: 'manual-address' })
    await page.waitForTimeout(400)
  }

  await fillFirst(
    [page.getByPlaceholder('Address line 1'), page.getByLabel('Address line 1')],
    '10 Downing Street',
    'line1',
  )
  await fillFirst([page.getByLabel('City'), page.getByPlaceholder('City')], 'London', 'city')
  await fillFirst(
    [
      page.getByLabel('Postal code'),
      page.getByLabel('Postcode'),
      page.getByPlaceholder('Postal code'),
      page.getByPlaceholder('SW1A 2AA'),
    ],
    'SW1A 2AA',
    'postal',
  )

  await page.keyboard.press('Tab').catch(() => {})
  await page.waitForTimeout(1500)
  await shot('02-filled.png')

  const pay = page.getByRole('button', { name: /pay and subscribe|subscribe|pay/i }).first()
  await pay.waitFor({ state: 'visible', timeout: 15000 })
  const disabled = await pay.isDisabled().catch(() => false)
  facts.steps.push({ at: 'pay-visible', disabled })
  if (disabled) await page.waitForTimeout(3000)
  await pay.click({ timeout: 15000 })
  facts.steps.push({ at: 'clicked-pay', urlHost: safeHost() })

  const leftCheckout = await page
    .waitForURL((u) => !u.host.includes('checkout.stripe.com'), { timeout: 90000 })
    .then(() => true)
    .catch(() => false)
  facts.leftCheckout = leftCheckout
  facts.finalUrlHost = safeHost()
  try {
    const final = new URL(page.url())
    facts.finalPath = final.pathname
    facts.finalQueryKeys = [...final.searchParams.keys()]
    facts.checkoutSuccess = final.searchParams.get('checkout') === 'success'
  } catch {
    facts.finalPath = null
  }
  await shot('03-after-pay.png')
} catch (error) {
  facts.error = error instanceof Error ? error.message : String(error)
  await shot('03-after-pay.png')
  facts.finalUrlHost = safeHost()
} finally {
  facts.finishedAt = new Date().toISOString()
  writeFileSync(`${outDir}/complete-attempt.json`, JSON.stringify(facts, null, 2))
  console.log(JSON.stringify(facts, null, 2))
  await browser.close()
}
