/**
 * Delivery webhook auth: token stays required, and SNS envelopes are
 * signature-verified fail-closed. Pre-change (token only) these forged /
 * unsigned / wrong-host cases were accepted.
 */
import { generateKeyPairSync, createSign } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INVALID_SNS_SIGNATURE } from '../sns-signature'

const applyDeliveryEvent = vi.fn<(body: unknown) => Promise<boolean>>()

vi.mock('../email-delivery-events', () => ({
  applyDeliveryEvent: (...args: [unknown]) => applyDeliveryEvent(...args),
}))

import { handleEmailDeliveryWebhook } from '../email-delivery-webhook'

const SECRET = 'delivery-webhook-test-secret'
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

function signEnvelope(fields: Record<string, string>, key: string = privateKey): string {
  const keys =
    fields.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'SubscribeURL', 'Timestamp', 'TopicArn', 'Type']
      : [
          'Message',
          'MessageId',
          'Subject',
          'SubscribeURL',
          'Timestamp',
          'Token',
          'TopicArn',
          'Type',
        ]
  let canonical = ''
  for (const name of keys) {
    if (name in fields) canonical += `${name}\n${fields[name]}\n`
  }
  const signer = createSign('RSA-SHA256')
  signer.update(canonical, 'utf8')
  return signer.sign(key, 'base64')
}

function bounceMessage(): string {
  return JSON.stringify({ notificationType: 'Bounce', mail: { messageId: '010001-ses' } })
}

function notificationFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    Type: 'Notification',
    Message: bounceMessage(),
    MessageId: 'msg-1',
    Timestamp: '2019-01-31T04:37:04.321Z',
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:email-events',
    SignatureVersion: '2',
    SigningCertURL: CERT_URL,
    ...overrides,
  }
}

function signedNotification(overrides: Record<string, string> = {}, key?: string) {
  const fields = notificationFields(overrides)
  return { ...fields, Signature: signEnvelope(fields, key) }
}

function signedConfirmation(overrides: Record<string, string> = {}) {
  const fields = {
    Type: 'SubscriptionConfirmation',
    Message: 'You have chosen to subscribe to the topic.',
    MessageId: 'msg-sub',
    SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc',
    Timestamp: '2024-01-01T00:00:00.000Z',
    Token: 'abc123',
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:email-events',
    SignatureVersion: '2',
    SigningCertURL: CERT_URL,
    ...overrides,
  }
  return { ...fields, Signature: signEnvelope(fields) }
}

function authedRequest(
  body: unknown,
  opts: { token?: string | null; bearer?: boolean } = {}
): Request {
  const url = new URL('http://localhost/api/chat/email/events')
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.token !== null) {
    const token = opts.token ?? SECRET
    if (opts.bearer) headers.authorization = `Bearer ${token}`
    else url.searchParams.set('token', token)
  }
  return new Request(url, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of ['EMAIL_EVENTS_SIGNING_SECRET', 'EMAIL_INBOUND_SIGNING_SECRET']) {
    saved[key] = process.env[key]
  }
  process.env.EMAIL_EVENTS_SIGNING_SECRET = SECRET
  delete process.env.EMAIL_INBOUND_SIGNING_SECRET
  applyDeliveryEvent.mockResolvedValue(true)
})

afterEach(() => {
  for (const key of ['EMAIL_EVENTS_SIGNING_SECRET', 'EMAIL_INBOUND_SIGNING_SECRET']) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('handleEmailDeliveryWebhook — SNS signature gate', () => {
  it('401s a forged SNS signature with the named body and does not record', async () => {
    const res = await handleEmailDeliveryWebhook(
      authedRequest(signedNotification({}, otherPrivateKey)),
      { fetchCert }
    )

    expect(res.status).toBe(401)
    expect(await res.text()).toBe(INVALID_SNS_SIGNATURE)
    expect(applyDeliveryEvent).not.toHaveBeenCalled()
  })

  it('401s a wrong cert host without fetching or recording', async () => {
    let fetched = 0
    const res = await handleEmailDeliveryWebhook(
      authedRequest(
        signedNotification({
          SigningCertURL: 'https://evil.example/SimpleNotificationService-test.pem',
        })
      ),
      {
        fetchCert: async () => {
          fetched += 1
          return publicKey
        },
      }
    )

    expect(res.status).toBe(401)
    expect(await res.text()).toBe(INVALID_SNS_SIGNATURE)
    expect(fetched).toBe(0)
    expect(applyDeliveryEvent).not.toHaveBeenCalled()
  })

  it('401s an SNS envelope with a missing Signature', async () => {
    const { Signature: _sig, ...unsigned } = signedNotification()
    const res = await handleEmailDeliveryWebhook(authedRequest(unsigned), { fetchCert })

    expect(res.status).toBe(401)
    expect(await res.text()).toBe(INVALID_SNS_SIGNATURE)
    expect(applyDeliveryEvent).not.toHaveBeenCalled()
  })

  it('records a valid locally signed bounce Notification', async () => {
    const event = signedNotification()
    const res = await handleEmailDeliveryWebhook(authedRequest(event), { fetchCert })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'recorded' })
    expect(applyDeliveryEvent).toHaveBeenCalledOnce()
    expect(applyDeliveryEvent.mock.calls[0][0]).toMatchObject({ Type: 'Notification' })
  })

  it('confirms a valid SubscriptionConfirmation only after the signature checks out', async () => {
    const confirmSubscribeUrl = vi.fn<(url: string) => Promise<void>>(async () => {})
    const event = signedConfirmation()
    const res = await handleEmailDeliveryWebhook(authedRequest(event), {
      fetchCert,
      confirmSubscribeUrl,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'subscribed' })
    expect(confirmSubscribeUrl).toHaveBeenCalledOnce()
    expect(confirmSubscribeUrl.mock.calls[0]?.[0]).toMatch(
      /^https:\/\/sns\.us-east-1\.amazonaws\.com\//
    )
    expect(applyDeliveryEvent).not.toHaveBeenCalled()
  })

  it('does not confirm a forged SubscriptionConfirmation', async () => {
    const confirmSubscribeUrl = vi.fn(async () => {})
    const fields = {
      Type: 'SubscriptionConfirmation',
      Message: 'You have chosen to subscribe to the topic.',
      MessageId: 'msg-sub',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc',
      Timestamp: '2024-01-01T00:00:00.000Z',
      Token: 'abc123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:email-events',
      SignatureVersion: '2',
      SigningCertURL: CERT_URL,
    }
    const event = { ...fields, Signature: signEnvelope(fields, otherPrivateKey) }

    const res = await handleEmailDeliveryWebhook(authedRequest(event), {
      fetchCert,
      confirmSubscribeUrl,
    })

    expect(res.status).toBe(401)
    expect(await res.text()).toBe(INVALID_SNS_SIGNATURE)
    expect(confirmSubscribeUrl).not.toHaveBeenCalled()
  })

  it('still requires the shared token even when the SNS signature is valid', async () => {
    const res = await handleEmailDeliveryWebhook(
      authedRequest(signedNotification(), { token: null }),
      {
        fetchCert,
      }
    )

    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Invalid signature')
    expect(applyDeliveryEvent).not.toHaveBeenCalled()
  })

  it('accepts the Bearer token form for a non-SNS bounce body', async () => {
    const ses = { notificationType: 'Bounce', mail: { messageId: '010001-ses' } }
    const res = await handleEmailDeliveryWebhook(authedRequest(ses, { bearer: true }))

    expect(res.status).toBe(200)
    expect(applyDeliveryEvent).toHaveBeenCalledWith(ses)
  })

  it('does not SNS-verify a Resend-shaped body (Svix path is inbound)', async () => {
    const event = { type: 'email.bounced', data: { email_id: 're_123' } }
    const res = await handleEmailDeliveryWebhook(authedRequest(event))

    expect(res.status).toBe(200)
    expect(applyDeliveryEvent).toHaveBeenCalledWith(event)
  })

  it('404s when no signing secret is configured', async () => {
    delete process.env.EMAIL_EVENTS_SIGNING_SECRET
    const res = await handleEmailDeliveryWebhook(authedRequest(signedNotification()), { fetchCert })
    expect(res.status).toBe(404)
    expect(applyDeliveryEvent).not.toHaveBeenCalled()
  })
})
