/**
 * The signing key a new sending domain is created with: a fresh RSA key per
 * row, its public half published as one TXT record, its private half handed to
 * the provider and nothing else.
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generateDkimKey, dkimPublicKeyOf } from '../dkim-key'

describe('generateDkimKey', () => {
  it('publishes the public key of a 2048-bit key as one TXT value', () => {
    const { record } = generateDkimKey()
    expect(record.type).toBe('TXT')
    expect(record.purpose).toBe('dkim')
    expect(record.value).toMatch(/^v=DKIM1; k=rsa; p=[A-Za-z0-9+/]+=*$/)
    // 392 characters of key: longer than one 255-character TXT string, so
    // DNS carries it as two strings of one record.
    expect(dkimPublicKeyOf(record.value)).toHaveLength(392)
    expect(record.value).toHaveLength(410)
  })

  it('names a short DNS-safe selector unique to each key', () => {
    const a = generateDkimKey()
    const b = generateDkimKey()
    expect(a.selector).toMatch(/^qb[0-9a-f]{8}$/)
    expect(a.record.host).toBe(`${a.selector}._domainkey`)
    expect(a.selector).not.toBe(b.selector)
    expect(a.record.value).not.toBe(b.record.value)
  })

  it('hands over the private key as base64 PKCS#1 DER of the published public key', () => {
    const { record, privateKey } = generateDkimKey()
    expect(privateKey).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(privateKey).not.toContain('BEGIN')
    const priv = createPrivateKey({
      key: Buffer.from(privateKey, 'base64'),
      format: 'der',
      type: 'pkcs1',
    })
    expect(priv.asymmetricKeyDetails?.modulusLength).toBe(2048)
    const pub = createPublicKey({
      key: Buffer.from(dkimPublicKeyOf(record.value) ?? '', 'base64'),
      format: 'der',
      type: 'spki',
    })
    const signature = sign('sha256', Buffer.from('acme'), priv)
    expect(verify('sha256', Buffer.from('acme'), pub, signature)).toBe(true)
  })

  it('keeps the private key out of the record', () => {
    const { record, privateKey } = generateDkimKey()
    expect(JSON.stringify(record)).not.toContain(privateKey)
  })
})

describe('dkimPublicKeyOf', () => {
  it.each([
    ['v=DKIM1; k=rsa; p=ABC+/=', 'ABC+/='],
    ['v=DKIM1;k=rsa;p=AB C', 'ABC'],
    ['p=XYZ; v=DKIM1', 'XYZ'],
    ['v=spf1 -all', null],
    ['v=DKIM1; k=rsa; p=', null],
  ])('%s is %s', (value, key) => {
    expect(dkimPublicKeyOf(value)).toBe(key)
  })
})
