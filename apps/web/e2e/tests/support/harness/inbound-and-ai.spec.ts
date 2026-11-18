/**
 * Self-test: the inbound signer is accepted (and a wrong signature is not),
 * minted reply addresses route into their conversation, and the fake AI is
 * what the app's AI features talk to: a scripted verdict changes what the app
 * does with the mail.
 */
import OpenAI from 'openai'
import { test, expect } from '../../../support/fixtures'
import { pollFor, supportDb } from '../../../support/db'
import { supportEnv } from '../../../support/env'
import { FAKE_AI_FAIL, fakeAi } from '../../../support/fake-ai-client'
import {
  conversationReplyAddress,
  sendInboundEmail,
  supportInboxAddress,
} from '../../../support/inbound-email'

interface ConversationRow {
  id: string
  status: string
  spam_reason: string | null
  channel: string
}

/** The conversation a cold inbound message (by its Message-ID) opened. */
async function conversationForMessage(messageId: string): Promise<ConversationRow> {
  const sql = supportDb()
  return pollFor(`a conversation for ${messageId}`, async () => {
    const [row] = await sql<ConversationRow[]>`
      SELECT c.id, c.status, c.spam_reason, c.channel
      FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.metadata ->> 'emailMessageId' LIKE ${`%${messageId.replace(/[<>]/g, '')}%`}
      LIMIT 1`
    return row ?? null
  })
}

test.describe('inbound email signer', { tag: '@smoke' }, () => {
  test('a signed cold email opens a conversation; a wrong or missing signature is refused', async ({
    request,
    customerEmail,
    marker,
  }) => {
    const mail = {
      from: customerEmail,
      to: supportInboxAddress(),
      subject: `Help ${marker}`,
      text: `Hello, I need help with ${marker}.`,
      messageId: `<${marker}@customers.example>`,
    }

    const forged = await sendInboundEmail(request, mail, {
      secret: 'whsec_' + Buffer.from('not-the-secret').toString('base64'),
    })
    expect(forged.status()).toBe(401)
    const unsigned = await request.post('/api/chat/email/inbound', {
      data: JSON.stringify({ type: 'email.received', data: {} }),
      headers: { 'content-type': 'application/json' },
    })
    expect(unsigned.status()).toBe(401)

    const res = await sendInboundEmail(request, mail)
    expect(res.status(), await res.text()).toBe(200)
    const conversation = await conversationForMessage(mail.messageId)
    expect(conversation.channel).toBe('email')
  })

  test('a reply to a minted conversation address lands in that conversation', async ({
    request,
    customerEmail,
    marker,
  }) => {
    const first = {
      from: customerEmail,
      to: supportInboxAddress(),
      subject: `Order ${marker}`,
      text: `First message ${marker}`,
      messageId: `<${marker}-1@customers.example>`,
    }
    expect((await sendInboundEmail(request, first)).status()).toBe(200)
    const conversation = await conversationForMessage(first.messageId)
    const { fromUuid } = await import('@quackback/ids')
    const conversationId = fromUuid('conversation', conversation.id)

    const reply = await sendInboundEmail(request, {
      from: customerEmail,
      to: conversationReplyAddress(conversationId),
      subject: `Re: Order ${marker}`,
      text: `Second message ${marker}`,
      messageId: `<${marker}-2@customers.example>`,
    })
    expect(reply.status()).toBe(200)
    expect(await reply.json()).toMatchObject({ status: 'ingested' })
    const sameConversation = await conversationForMessage(`<${marker}-2@customers.example>`)
    expect(sameConversation.id).toBe(conversation.id)
  })
})

test.describe('fake AI', { tag: '@smoke' }, () => {
  test('a scripted spam verdict files the mail as spam; "not spam" leaves it in the inbox', async ({
    request,
    marker,
  }) => {
    const spamMarker = `${marker}-spam`
    const hamMarker = `${marker}-ham`
    await fakeAi.script({ marker: spamMarker, json: { spam: true } })
    await fakeAi.script({ marker: hamMarker, json: { spam: false } })

    for (const m of [spamMarker, hamMarker]) {
      const res = await sendInboundEmail(request, {
        from: `${m}@customers.example`,
        to: supportInboxAddress(),
        subject: `Question ${m}`,
        text: `Please read ${m}`,
        messageId: `<${m}@customers.example>`,
      })
      expect(res.status()).toBe(200)
    }

    // The app asked the fake about each message, with the message in the prompt.
    const [spamAsk] = await fakeAi.waitForRequests({ contains: spamMarker, endpoint: 'chat' })
    expect(spamAsk.matched).toBe(spamMarker)
    expect(spamAsk.model).toBe('fake-chat')

    const spam = await pollFor('the spam verdict to be filed', async () => {
      const row = await conversationForMessage(`<${spamMarker}@customers.example>`)
      return row.spam_reason ? row : null
    })
    expect(spam.spam_reason).toBeTruthy()

    await fakeAi.waitForRequests({ contains: hamMarker, endpoint: 'chat' })
    const ham = await conversationForMessage(`<${hamMarker}@customers.example>`)
    expect(ham.spam_reason).toBeNull()
  })

  test('the failure marker makes the fake fail and the app degrades to "not spam"', async ({
    request,
    marker,
  }) => {
    const res = await sendInboundEmail(request, {
      from: `${marker}@customers.example`,
      to: supportInboxAddress(),
      subject: `Question ${marker}`,
      text: `Please read ${marker} ${FAKE_AI_FAIL}`,
      messageId: `<${marker}@customers.example>`,
    })
    expect(res.status()).toBe(200)
    const [failed] = await fakeAi.waitForRequests({ contains: marker, endpoint: 'chat' })
    expect(failed.status).toBe(500)
    const row = await conversationForMessage(`<${marker}@customers.example>`)
    expect(row.spam_reason).toBeNull()
  })

  test('speaks the protocol the OpenAI SDK expects: tools, streaming, embeddings', async ({
    marker,
  }) => {
    const client = new OpenAI({
      baseURL: `${supportEnv().fakeAiUrl}/v1`,
      apiKey: 'fake',
      maxRetries: 0,
    })
    await fakeAi.script({
      marker: `${marker}-tool`,
      toolCalls: [{ name: 'lookup_order', arguments: { orderId: 42 } }],
    })
    await fakeAi.script({ marker: `${marker}-stream`, reply: 'streamed answer text, in parts' })

    const tool = await client.chat.completions.create({
      model: 'fake-chat',
      messages: [{ role: 'user', content: `${marker}-tool` }],
    })
    expect(tool.choices[0].finish_reason).toBe('tool_calls')
    expect(tool.choices[0].message.tool_calls?.[0]).toMatchObject({
      type: 'function',
      function: { name: 'lookup_order', arguments: '{"orderId":42}' },
    })

    const stream = await client.chat.completions.create({
      model: 'fake-chat',
      stream: true,
      messages: [{ role: 'user', content: `${marker}-stream` }],
    })
    let text = ''
    for await (const chunk of stream) text += chunk.choices[0]?.delta?.content ?? ''
    expect(text).toBe('streamed answer text, in parts')

    // The SDK asks for base64 by default and decodes it.
    const embedded = await client.embeddings.create({
      model: 'fake-embedding',
      input: [`${marker}-a`, `${marker}-a`, `${marker}-b`],
      dimensions: 1536,
    })
    const [a1, a2, b] = embedded.data.map((d) => d.embedding)
    expect(a1).toHaveLength(1536)
    expect(a1).toEqual(a2)
    expect(a1).not.toEqual(b)
    const norm = Math.sqrt(a1.reduce((sum, v) => sum + v * v, 0))
    expect(norm).toBeCloseTo(1, 3)

    await expect(
      client.chat.completions.create({
        model: 'fake-chat',
        messages: [{ role: 'user', content: `boom ${FAKE_AI_FAIL}` }],
      })
    ).rejects.toMatchObject({ status: 500 })
  })
})
