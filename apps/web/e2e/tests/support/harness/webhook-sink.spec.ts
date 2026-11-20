/**
 * Self-test: a webhook pointed at the sink is delivered over https, signed;
 * an http URL is still refused when the webhook is created.
 */
import { createHmac } from 'node:crypto'
import { test, expect } from '../../../support/fixtures'
import { sink } from '../../../support/webhook-sink-client'
import { createSupportApiKey } from '../../../utils/db-helpers'

test.describe('webhook sink', { tag: '@smoke' }, () => {
  test('post.created reaches the sink over https with a valid signature', async ({
    playwright,
    baseURL,
    people,
    marker,
  }) => {
    const apiKey = createSupportApiKey(people.people.admin.email)
    const api = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${apiKey}` },
    })

    const httpUrl = sink.url(marker).replace('https://', 'http://')
    const refused = await api.post('/api/v1/webhooks', {
      data: { url: httpUrl, events: ['post.created'] },
    })
    expect(refused.status()).toBe(400)

    const created = await api.post('/api/v1/webhooks', {
      data: { url: sink.url(marker), events: ['post.created'] },
    })
    expect(created.status(), await created.text()).toBe(201)
    const { data: webhook } = (await created.json()) as { data: { id: string; secret: string } }

    const boards = await api.get('/api/v1/boards')
    const { data: boardList } = (await boards.json()) as { data: Array<{ id: string }> }
    const post = await api.post('/api/v1/posts', {
      data: { boardId: boardList[0].id, title: `Webhook ${marker}`, content: 'Sink test' },
    })
    expect(post.status(), await post.text()).toBe(201)

    const [delivery] = await sink.waitForDeliveries(marker)
    expect(delivery.headers['x-quackback-event']).toBe('post.created')
    expect(delivery.body).toContain(marker)
    const timestamp = delivery.headers['x-quackback-timestamp']
    const expected = createHmac('sha256', webhook.secret)
      .update(`${timestamp}.${delivery.body}`)
      .digest('hex')
    expect(delivery.headers['x-quackback-signature']).toBe(`sha256=${expected}`)

    await api.delete(`/api/v1/webhooks/${webhook.id}`)
    await api.dispose()
  })
})
