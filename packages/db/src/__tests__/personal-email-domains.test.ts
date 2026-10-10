import { describe, expect, it } from 'vitest'
import {
  companyEmailDomain,
  getEmailDomain,
  isPersonalEmailDomain,
} from '../email/personal-email-domains'

describe('personal email domains', () => {
  it('recognizes providers from every shipped locale, in any case', () => {
    for (const domain of [
      'gmail.com',
      'outlook.com',
      'hotmail.fr',
      'yahoo.co.jp',
      'icloud.com',
      'proton.me',
      'wp.pl',
      'o2.pl',
      't-online.de',
      'posteo.de',
      'gmx.de',
      'list.ru',
      'mail.ru',
      'uol.com.br',
      'libero.it',
      'seznam.cz',
      'foxmail.com',
      'qq.com',
      '163.com',
      'naver.com',
      'hey.com',
      'tutanota.com',
    ]) {
      expect(isPersonalEmailDomain(domain.toUpperCase()), domain).toBe(true)
      expect(companyEmailDomain(`you@${domain}`), domain).toBeNull()
    }
  })

  it('matches a parent provider domain but never a company that merely contains one', () => {
    expect(isPersonalEmailDomain('eu.gmail.com')).toBe(true)
    expect(isPersonalEmailDomain('gmail.com.')).toBe(true)
    expect(isPersonalEmailDomain('gmail.com.example.com')).toBe(false)
    expect(isPersonalEmailDomain('notgmail.com')).toBe(false)
    expect(isPersonalEmailDomain('example.com')).toBe(false)
    expect(isPersonalEmailDomain('com')).toBe(false)
  })

  it('normalizes a company domain from a valid email', () => {
    expect(getEmailDomain('you+tag@EXAMPLE.COM')).toBe('example.com')
    expect(companyEmailDomain('you@example.com')).toBe('example.com')
    expect(companyEmailDomain('you@acme.co.uk')).toBe('acme.co.uk')
  })

  it('rejects malformed addresses and literal hosts', () => {
    for (const email of [
      '',
      'you',
      '@example.com',
      'you@@example.com',
      'you@localhost',
      'you@127.0.0.1',
      'you@[::1]',
      'you@-example.com',
      'you@example..com',
      'you@example.com/path',
      'you@example.com:443',
      'you name@example.com',
      'you@example.com?x',
    ])
      expect(companyEmailDomain(email), email).toBeNull()
  })
})
