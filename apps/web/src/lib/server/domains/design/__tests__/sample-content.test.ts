/**
 * Sample content is plainly made up: every id says sample, every address is
 * example.com, and it is the same whoever asks.
 */
import { describe, expect, it } from 'vitest'
import { SAMPLE_PAGES } from '@/lib/shared/design/sample-pages'
import { sampleContent } from '../sample-content'

const now = new Date('2026-11-02T12:00:00Z')

describe('sampleContent', () => {
  it.each(SAMPLE_PAGES)('marks every id in the %s sample as a sample', (page) => {
    const text = JSON.stringify(sampleContent(page, now))
    const ids = [...text.matchAll(/"(?:id|componentId)":"([^"]+)"/g)].map((match) => match[1])
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(id).toMatch(/^sample_/)
    // Any address it names is example.com's.
    for (const host of text.matchAll(/\b([a-z0-9-]+\.)+(com|net|org|io)\b/g))
      expect(host[0]).toMatch(/example\.com$/)
  })

  it('gives Support a signed-in visitor’s conversations, one of them a ticket', () => {
    const sample = sampleContent('support', now)
    if (sample.page !== 'support') throw new Error('support')
    const { conversations, linkedTickets } = sample.support
    expect(conversations.length).toBeGreaterThan(2)
    const tracked = conversations.filter((each) => linkedTickets[each.id])
    expect(tracked).toHaveLength(1)
    for (const each of conversations) expect(each.lastMessageAt <= now.toISOString()).toBe(true)
  })

  it('shows the same posts on the board, the roadmap and in their statuses', () => {
    const feedback = sampleContent('feedback', now)
    const roadmap = sampleContent('roadmap', now)
    if (feedback.page !== 'feedback' || roadmap.page !== 'roadmap') throw new Error('pages')
    const statuses = new Set(feedback.feedback.statuses.map((status) => status.id))
    for (const post of feedback.feedback.posts.items)
      expect(statuses.has(post.statusId!)).toBe(true)
    const titles = new Set(feedback.feedback.posts.items.map((post) => post.title))
    const [map] = roadmap.roadmap.roadmaps
    for (const column of map!.columns) {
      const posts = roadmap.roadmap.columns[column.statusId]!.items
      expect(posts.length).toBeGreaterThan(0)
      for (const post of posts) expect(titles.has(post.title)).toBe(true)
    }
  })

  it('dates the status sample around now', () => {
    const sample = sampleContent('status', now)
    if (sample.page !== 'status') throw new Error('status')
    const { snapshot, uptime } = sample.status
    expect(snapshot.activeIncidents[0]!.startedAt < now.toISOString()).toBe(true)
    expect(uptime[0]!.days).toHaveLength(90)
    expect(uptime[0]!.days.at(-1)!.date).toBe('2026-11-02')
  })
})
