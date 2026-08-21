/**
 * SNS delivery-event signatures: forged, wrong cert host, missing Signature,
 * and a locally signed fixture (no network). These fail closed against the
 * token-only webhook that accepted any SNS-shaped JSON.
 */
import { generateKeyPairSync, createSign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  INVALID_SNS_SIGNATURE,
  isAmazonSnsCertUrl,
  isAmazonSnsHttpsUrl,
  isSnsEnvelope,
  verifySnsMessageSignature,
} from '../sns-signature'

const CERT_URL = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem'

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const { privateKey: otherPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const fetchCert = async () => publicKey

function signableKeys(type: string): readonly string[] {
  return type === 'Notification'
    ? ['Message', 'MessageId', 'Subject', 'SubscribeURL', 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'Subject', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
}

/** Independent of production: AWS field order + trailing newline per pair. */
function signEnvelope(
  fields: Record<string, string>,
  key: string = privateKey,
  version: '1' | '2' = '2'
): string {
  let canonical = ''
  for (const name of signableKeys(fields.Type)) {
    if (name in fields) canonical += `${name}\n${fields[name]}\n`
  }
  const signer = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256')
  signer.update(canonical, 'utf8')
  return signer.sign(key, 'base64')
}

function notificationFields(overrides: Record<string, string> = {}): Record<string, string> {
  const ses = {
    notificationType: 'Bounce',
    mail: { messageId: '010001-ses' },
  }
  return {
    Type: 'Notification',
    Message: JSON.stringify(ses),
    MessageId: '4d4dc071-ddbf-465d-bba8-08f81c89da64',
    Timestamp: '2019-01-31T04:37:04.321Z',
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:email-events',
    SignatureVersion: '2',
    SigningCertURL: CERT_URL,
    ...overrides,
  }
}

function signedNotification(
  overrides: Record<string, string> = {},
  key?: string
): Record<string, string> {
  const fields = notificationFields(overrides)
  return { ...fields, Signature: signEnvelope(fields, key) }
}

function confirmationFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    Type: 'SubscriptionConfirmation',
    Message: 'You have chosen to subscribe to the topic.',
    MessageId: '3d891288-136d-417f-bc05-901c108273ee',
    SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc',
    Timestamp: '2024-01-01T00:00:00.000Z',
    Token: 'abc123',
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:email-events',
    SignatureVersion: '2',
    SigningCertURL: CERT_URL,
    ...overrides,
  }
}

function signedConfirmation(overrides: Record<string, string> = {}) {
  const fields = confirmationFields(overrides)
  return { ...fields, Signature: signEnvelope(fields) }
}

describe('isAmazonSnsCertUrl', () => {
  it('accepts Amazon SNS PEM URLs and rejects everything else', () => {
    expect(isAmazonSnsCertUrl(CERT_URL)).toBe(true)
    expect(isAmazonSnsCertUrl('https://sns.cn-north-1.amazonaws.com.cn/cert.pem')).toBe(true)
    expect(
      isAmazonSnsHttpsUrl('https://sns.us-west-2.amazonaws.com/?Action=ConfirmSubscription')
    ).toBe(true)

    expect(isAmazonSnsCertUrl('https://evil.example/SimpleNotificationService-test.pem')).toBe(
      false
    )
    expect(isAmazonSnsCertUrl('https://sns.us-east-1.amazonaws.com.evil.test/cert.pem')).toBe(false)
    expect(isAmazonSnsCertUrl('http://sns.us-east-1.amazonaws.com/cert.pem')).toBe(false)
    expect(isAmazonSnsCertUrl('https://s3.amazonaws.com/cert.pem')).toBe(false)
    expect(isAmazonSnsCertUrl('https://sns.us-east-1.amazonaws.com/cert')).toBe(false)
    expect(isAmazonSnsCertUrl('https://user:pass@sns.us-east-1.amazonaws.com/cert.pem')).toBe(false)
    expect(isAmazonSnsCertUrl('https://sns.us-east-1.amazonaws.com:8443/cert.pem')).toBe(false)
  })
})

describe('isSnsEnvelope', () => {
  it('matches only the three SNS Type values', () => {
    expect(isSnsEnvelope({ Type: 'Notification' })).toBe(true)
    expect(isSnsEnvelope({ Type: 'SubscriptionConfirmation' })).toBe(true)
    expect(isSnsEnvelope({ Type: 'UnsubscribeConfirmation' })).toBe(true)
    expect(isSnsEnvelope({ Type: 'email.bounced' })).toBe(false)
    expect(isSnsEnvelope({ notificationType: 'Bounce' })).toBe(false)
    expect(isSnsEnvelope({ type: 'Notification' })).toBe(false)
  })
})

describe('verifySnsMessageSignature', () => {
  it('accepts a locally signed Notification (no network)', async () => {
    const result = await verifySnsMessageSignature(signedNotification(), { fetchCert })
    expect(result).toEqual({ ok: true })
  })

  it('accepts a locally signed SubscriptionConfirmation', async () => {
    const result = await verifySnsMessageSignature(signedConfirmation(), { fetchCert })
    expect(result).toEqual({ ok: true })
  })

  it('accepts SignatureVersion 1 (SHA1) when the fixture matches', async () => {
    const fields = notificationFields({ SignatureVersion: '1' })
    const message = { ...fields, Signature: signEnvelope(fields, privateKey, '1') }
    const result = await verifySnsMessageSignature(message, { fetchCert })
    expect(result).toEqual({ ok: true })
  })

  it('rejects a forged signature', async () => {
    const result = await verifySnsMessageSignature(signedNotification({}, otherPrivateKey), {
      fetchCert,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('rejects a tampered bounce body after signing', async () => {
    const signed = signedNotification()
    signed.Message = JSON.stringify({
      notificationType: 'Bounce',
      mail: { messageId: 'attacker' },
    })
    const result = await verifySnsMessageSignature(signed, { fetchCert })
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('rejects a non-Amazon cert host without fetching', async () => {
    let fetched = 0
    const message = signedNotification({
      SigningCertURL: 'https://evil.example/SimpleNotificationService-test.pem',
    })
    const result = await verifySnsMessageSignature(message, {
      fetchCert: async () => {
        fetched += 1
        return publicKey
      },
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_cert_url' })
    expect(fetched).toBe(0)
  })

  it('rejects a missing Signature', async () => {
    const { Signature: _sig, ...unsigned } = signedNotification()
    const result = await verifySnsMessageSignature(unsigned, { fetchCert })
    expect(result).toEqual({ ok: false, reason: 'missing_signature' })
    expect(INVALID_SNS_SIGNATURE).toBe('invalid_sns_signature')
  })

  it('rejects an unsupported SignatureVersion', async () => {
    const fields = notificationFields({ SignatureVersion: '3' })
    const result = await verifySnsMessageSignature(
      { ...fields, Signature: signEnvelope(fields) },
      { fetchCert }
    )
    expect(result).toEqual({ ok: false, reason: 'unsupported_signature_version' })
  })

  it('does not treat a Resend event as an SNS envelope', async () => {
    const result = await verifySnsMessageSignature({
      type: 'email.bounced',
      data: { email_id: 're_123' },
    })
    expect(result).toEqual({ ok: false, reason: 'malformed' })
  })
})
