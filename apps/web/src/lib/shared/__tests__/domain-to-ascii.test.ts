import { describe, expect, it } from 'vitest'
import { domainToASCII as nodeDomainToASCII } from 'node:url'
import { domainToASCII } from '../domain-to-ascii'

const CASES = [
  'example.com',
  'EXAMPLE.com',
  'bücher.de',
  'münchen.example',
  'xn--bcher-kva.de',
  'ＥＸＡＭＰＬＥ.com',
  'ｆｏｏ。com',
  'faß.de',
  '☃.net',
  'a­b.com',
  '1.2',
  '192.168.0.1',
  '0x7f.1',
  '256.1.1.1',
  '[::1]',
  'a..b',
  '-a.com',
  'a_b.com',
  'foo.',
  '*.example.com',
  'exa mple.com',
  'a/b',
  'a?b',
  'a#b',
  'a\\b',
  'a%2eb',
  'a%b',
  'user@x.com',
  'x.com:80',
  '[::1]:80',
  '//x.com',
  'http://x.com',
  'a.com ',
  'xn--zz',
  'xn--.com',
  '',
  '.',
  '@',
  '::',
  '[',
]

describe('domainToASCII', () => {
  it.each(CASES)('matches node:url for %j', (input) => {
    expect(domainToASCII(input)).toBe(nodeDomainToASCII(input))
  })

  it('converts unicode labels to their A-label form', () => {
    expect(domainToASCII('bücher.de')).toBe('xn--bcher-kva.de')
  })

  it('refuses a value that names no domain', () => {
    expect(domainToASCII('user@x.com')).toBe('')
    expect(domainToASCII('exa mple.com')).toBe('')
  })
})
