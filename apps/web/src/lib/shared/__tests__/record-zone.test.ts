import { describe, expect, it } from 'vitest'
import { nameInZone, recordZone } from '../record-zone'

describe('recordZone', () => {
  it('is the domain itself when no zone was found', () => {
    expect(recordZone('acme.com', undefined)).toBe('acme.com')
  })

  it('is the parent zone a subdomain sits in', () => {
    expect(recordZone('updates.acme.com', 'acme.com')).toBe('acme.com')
    expect(recordZone('updates.acme.com', 'ACME.com.')).toBe('acme.com')
  })

  it('ignores a zone that does not hold the domain', () => {
    expect(recordZone('acme.com', 'other.com')).toBe('acme.com')
    expect(recordZone('notacme.com', 'acme.com')).toBe('notacme.com')
  })
})

describe('nameInZone', () => {
  it('leaves a name alone when the domain is its own zone', () => {
    expect(nameInZone('_quackback', 'acme.com', 'acme.com')).toBe('_quackback')
    expect(nameInZone('@', 'acme.com', undefined)).toBe('@')
  })

  it('carries the labels between a subdomain and its zone', () => {
    expect(nameInZone('_quackback', 'updates.acme.com', 'acme.com')).toBe('_quackback.updates')
    expect(nameInZone('k1._domainkey', 'a.b.acme.com', 'acme.com')).toBe('k1._domainkey.a.b')
    expect(nameInZone('@', 'updates.acme.com', 'acme.com')).toBe('updates')
  })
})
