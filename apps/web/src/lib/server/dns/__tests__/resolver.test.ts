/**
 * The system resolver gives up on a slow nameserver quickly, so one domain
 * with a broken zone cannot hold a whole watch tick.
 */
import { describe, expect, it, vi } from 'vitest'

const constructed = vi.fn<(options: unknown) => void>()
const asked = vi.fn<(kind: string, host: string) => void>()

vi.mock('node:dns/promises', () => {
  class Resolver {
    constructor(options: unknown) {
      constructed(options)
    }
    resolveTxt = async (host: string) => (asked('TXT', host), [['v=spf1 -all']])
    resolveCname = async (host: string) => (asked('CNAME', host), ['x.example.com'])
    resolveMx = async (host: string) => (asked('MX', host), [])
    resolve4 = async (host: string) => (asked('A', host), [])
    resolve6 = async (host: string) => (asked('AAAA', host), [])
    resolveNs = async (host: string) => (asked('NS', host), [])
  }
  return { Resolver }
})

const { systemResolver, interactiveResolver } = await import('../resolver')

describe('systemResolver', () => {
  it('asks through one resolver with a short timeout and a single try', async () => {
    expect(constructed).not.toHaveBeenCalled()
    expect(await systemResolver.resolveTxt('acme.com')).toEqual([['v=spf1 -all']])
    await systemResolver.resolveCname('aaa._domainkey.acme.com')
    await systemResolver.resolveMx('qb-bounce.acme.com')
    await systemResolver.resolve4('qb-bounce.acme.com')
    await systemResolver.resolve6('help.acme.com')
    await systemResolver.resolveNs('acme.com')

    expect(constructed).toHaveBeenCalledTimes(1)
    expect(constructed).toHaveBeenCalledWith({ timeout: 2000, tries: 1 })
    expect(asked.mock.calls).toEqual([
      ['TXT', 'acme.com'],
      ['CNAME', 'aaa._domainkey.acme.com'],
      ['MX', 'qb-bounce.acme.com'],
      ['A', 'qb-bounce.acme.com'],
      ['AAAA', 'help.acme.com'],
      ['NS', 'acme.com'],
    ])
  })
})

describe('interactiveResolver', () => {
  it('tries twice, for a lookup someone clicked and is waiting on', async () => {
    constructed.mockClear()
    asked.mockClear()
    await interactiveResolver.resolveTxt('_quackback-verify.acme.com')
    await interactiveResolver.resolveTxt('_quackback-verify.acme.com')
    expect(constructed.mock.calls).toEqual([[{ timeout: 2000, tries: 2 }]])
    expect(asked.mock.calls).toEqual([
      ['TXT', '_quackback-verify.acme.com'],
      ['TXT', '_quackback-verify.acme.com'],
    ])
    // The background resolver is untouched by it.
    await systemResolver.resolveTxt('acme.com')
    expect(constructed).toHaveBeenCalledTimes(1)
  })
})
