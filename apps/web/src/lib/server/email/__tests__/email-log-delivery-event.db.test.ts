/**
 * A bounce or complaint finds the email_log row it is about, whichever way
 * each side writes the Message-ID. SMTP sends report their id in angle
 * brackets (`<id@host>`) while provider events usually carry it bare, so the
 * two must be compared the same way. Real database: a faked `where()` could
 * not tell the forms apart.
 */
import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { EmailLogSink, EmailLogSinkEntry } from '@quackback/email'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { emailLog, eq } from '@/lib/server/db'

const captured = vi.hoisted(() => ({ sink: null as EmailLogSink | null }))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@quackback/email', async (original) => ({
  ...(await original<typeof import('@quackback/email')>()),
  setEmailLogSink: (sink: EmailLogSink | null) => {
    captured.sink = sink
  },
}))

import { ensureEmailLogSink } from '../email-log.sink'
import { recordEmailDeliveryEvent } from '../email-log.query'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

/** A Message-ID no other test file writes. */
const freshId = () => `${randomUUID()}@mail.example.com`

async function statusOf(address: string): Promise<string | undefined> {
  const [row] = await testDb
    .select({ status: emailLog.status })
    .from(emailLog)
    .where(eq(emailLog.address, address))
  return row?.status
}

/** Logs an SMTP send through the real email_log sink, as the mailer does. */
async function logSmtpSend(messageId: string, to: string): Promise<void> {
  ensureEmailLogSink()
  const entry: EmailLogSinkEntry = {
    direction: 'outbound',
    emailType: 'ticket_reply',
    provider: 'smtp',
    to,
    subject: 'Re: your ticket',
    status: 'sent',
    messageId,
    providerMessageId: messageId,
    billable: true,
  }
  await captured.sink!(entry)
  await vi.waitFor(async () => expect(await statusOf(to)).toBe('sent'))
}

describe.skipIf(!fixture.available)('bounces against SMTP-sent mail (real DB)', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())

  it('matches a bare bounce id to a send logged with angle brackets', async () => {
    const id = freshId()
    const to = `bounce-${id}`
    await logSmtpSend(`<${id}>`, to)

    expect(await recordEmailDeliveryEvent({ messageId: id, event: 'bounce' })).toBe(true)
    expect(await statusOf(to)).toBe('bounced')
  })

  it('stores the id of an SMTP send without its angle brackets', async () => {
    const id = freshId()
    const to = `stored-${id}`
    await logSmtpSend(`<${id}>`, to)

    const [row] = await testDb
      .select({ messageId: emailLog.messageId, providerMessageId: emailLog.providerMessageId })
      .from(emailLog)
      .where(eq(emailLog.address, to))
    expect(row).toEqual({ messageId: id, providerMessageId: id })
  })

  it('matches a bracketed complaint id to a send logged with angle brackets', async () => {
    const id = freshId()
    const to = `complaint-${id}`
    await logSmtpSend(`<${id}>`, to)

    expect(await recordEmailDeliveryEvent({ messageId: `<${id}>`, event: 'complaint' })).toBe(true)
    expect(await statusOf(to)).toBe('complaint')
  })

  it('still matches a row written with brackets before ids were stored bare', async () => {
    const id = freshId()
    const to = `legacy-${id}`
    await testDb.insert(emailLog).values({
      direction: 'outbound',
      emailType: 'ticket_reply',
      provider: 'smtp',
      messageId: `<${id}>`,
      providerMessageId: `<${id}>`,
      address: to,
      status: 'sent',
      billable: true,
    })

    expect(await recordEmailDeliveryEvent({ messageId: id, event: 'bounce' })).toBe(true)
    expect(await statusOf(to)).toBe('bounced')
  })

  it('leaves other sends alone', async () => {
    const id = freshId()
    const to = `other-${id}`
    await logSmtpSend(`<${id}>`, to)

    expect(await recordEmailDeliveryEvent({ messageId: freshId(), event: 'bounce' })).toBe(false)
    expect(await statusOf(to)).toBe('sent')
  })
})
