/**
 * The browser reader renders untrusted pages, so production Compose keeps it
 * away from the data: on a network of its own that only the app shares, with
 * Chromium's sandbox on under a seccomp profile that lets it make its
 * namespaces, as a non-root user.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../../../../../../../..')
const compose = parse(readFileSync(resolve(root, 'docker-compose.prod.yml'), 'utf8')) as {
  services: Record<
    string,
    { networks?: string[] | Record<string, unknown>; security_opt?: string[] }
  >
}
const dockerfile = readFileSync(resolve(root, 'docker/browser/Dockerfile'), 'utf8')
const networksOf = (name: string) => {
  const n = compose.services[name]?.networks
  return Array.isArray(n) ? n : n ? Object.keys(n) : ['default']
}

describe('browser reader isolation', () => {
  it('sits on its own network, which the app joins and the data services do not', () => {
    expect(networksOf('browser')).toEqual(['browser'])
    expect(networksOf('app')).toEqual(expect.arrayContaining(['default', 'browser']))
    for (const name of Object.keys(compose.services)) {
      if (name === 'app' || name === 'browser') continue
      expect(networksOf(name), name).not.toContain('browser')
    }
  })

  it("keeps Chromium's sandbox on under its seccomp profile, as a non-root user", () => {
    expect(compose.services.browser!.security_opt).toContain(
      'seccomp=./docker/browser/seccomp-chromium.json'
    )
    expect(dockerfile).not.toMatch(/QUACKBACK_BROWSER_SANDBOX=off/)
    expect(dockerfile).toMatch(/^USER reader$/m)
    const profile = JSON.parse(
      readFileSync(resolve(root, 'docker/browser/seccomp-chromium.json'), 'utf8')
    ) as { defaultAction: string; syscalls: Array<{ names: string[]; action: string }> }
    expect(profile.defaultAction).toBe('SCMP_ACT_ERRNO')
    expect(
      profile.syscalls.some(
        (rule) =>
          rule.action === 'SCMP_ACT_ALLOW' &&
          rule.names.includes('unshare') &&
          !('includes' in rule)
      )
    ).toBe(true)
  })
})
