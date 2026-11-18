// @vitest-environment node
/**
 * Pages without their own icon link (admin, onboarding) make the browser ask
 * for /favicon.ico. Without a real file there, the request reached the page
 * router, and before setup was finished the onboarding guard redirected it
 * into the setup page. Static files in public/ are served ahead of the router,
 * the way /logo.png already is.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const favicon = fileURLToPath(new URL('../../../public/favicon.ico', import.meta.url))

describe('/favicon.ico', () => {
  it('is a real icon file served from public/', () => {
    const bytes = readFileSync(favicon)
    // ICO header: reserved 0, type 1 (icon).
    expect([...bytes.subarray(0, 4)]).toEqual([0, 0, 1, 0])
  })
})
