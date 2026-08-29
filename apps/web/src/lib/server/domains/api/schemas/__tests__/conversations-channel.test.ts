import { describe, expect, it } from 'vitest'
import { ConversationSchema } from '../conversations'
import { CHANNELS } from '@/lib/shared/db-types'

describe('conversations OpenAPI channel enum', () => {
  it('accepts github alongside messenger and email', () => {
    expect(CHANNELS).toContain('github')
    const parsed = ConversationSchema.shape.channel.safeParse('github')
    expect(parsed.success).toBe(true)
    expect(ConversationSchema.shape.channel.safeParse('sms').success).toBe(false)
  })
})
