import { describe, expect, it } from 'vitest'
import { siteHost } from '../host'

describe('siteHost', () => {
  it.each([
    ['acme.test', 'acme.test', 'https://acme.test/'],
    ['ACME.test', 'acme.test', 'https://acme.test/'],
    ['www.acme.test', 'acme.test', 'https://www.acme.test/'],
    ['https://www.Acme.test/pricing?ref=x#top', 'acme.test', 'https://www.acme.test/'],
    ['http://acme.test/about', 'acme.test', 'http://acme.test/'],
    ['https://acme.test:443/', 'acme.test', 'https://acme.test/'],
    ['acme.test.', 'acme.test', 'https://acme.test/'],
    ['shop.nimbus.example', 'shop.nimbus.example', 'https://shop.nimbus.example/'],
    ['bücher.example', 'xn--bcher-kva.example', 'https://xn--bcher-kva.example/'],
    ['  nimbus.example  ', 'nimbus.example', 'https://nimbus.example/'],
  ])('normalises %s', (input, host, url) => {
    expect(siteHost(input)).toEqual({ host, url })
  })

  it.each([
    '',
    'not a url at all',
    'ftp://acme.test/',
    'javascript:alert(1)',
    'https://user:pass@acme.test/',
    'https://acme.test:8080/',
    '127.0.0.1',
    'http://10.0.0.1/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://0x7f.1/',
    'http://2130706433/',
    'localhost',
    'http://localhost:80/',
    'app.localhost',
    'printer.local',
    'db.internal',
    'nas.lan',
    'router.home.arpa',
    'intranet',
    'www.',
  ])('refuses %s', (input) => {
    expect(siteHost(input)).toBeNull()
  })
})
