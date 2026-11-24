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

  it('refuses a control character or space that URL would strip', () => {
    // URL parses `acme.com\u0000` as `acme.com`: an address ending in NUL would
    // otherwise match a verified `acme.com`.
    for (const input of [
      'acme.com\u0000',
      '\u0000acme.com',
      'acme.com\t',
      'ac\nme.com',
      ' acme.com',
    ]) {
      expect(domainToASCII(input)).toBe('')
    }
  })

  it('never answers with a domain node:url would not', () => {
    // Characters URL parsing treats specially, at each position of a few bases.
    const specials = [
      ...Array.from({ length: 0x21 }, (_, c) => String.fromCharCode(c)),
      ...['\u007f', '\u0085', '\u00a0', '\u00ad', '\u200b', '\u200d', '\u2028', '\u3000'],
      ...['\u3002', '\uff0e', '\ufeff', '%', '%00', '%2e', '/', '\\', '?', '#', '@', ':', '[', ']'],
    ]
    const unsafe: string[] = []
    for (const base of ['acme.com', 'bücher.de']) {
      for (const c of specials) {
        for (const input of [c + base, base + c, base.replace('.', `${c}.`), `${base}.${c}`]) {
          const ours = domainToASCII(input)
          if (ours !== '' && ours !== nodeDomainToASCII(input)) unsafe.push(JSON.stringify(input))
        }
      }
    }
    expect(unsafe).toEqual([])
  })

  it('refuses a value that names no domain', () => {
    expect(domainToASCII('user@x.com')).toBe('')
    expect(domainToASCII('exa mple.com')).toBe('')
  })
})
