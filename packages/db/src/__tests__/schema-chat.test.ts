import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { conversations, chatMessages } from '../schema/chat'
import {
  CONVERSATION_STATUSES,
  MESSAGE_SENDER_TYPES,
  CHANNELS,
  CONVERSATION_PRIORITIES,
} from '../types'

describe('conversations schema', () => {
  it('has correct table name', () => {
    expect(getTableName(conversations)).toBe('conversations')
  })

  it('exposes the expected columns', () => {
    const columns = Object.keys(getTableColumns(conversations))
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'visitorPrincipalId',
        'assignedAgentPrincipalId',
        'status',
        'channel',
        'subject',
        'lastMessagePreview',
        'lastMessageAt',
        'visitorLastReadAt',
        'agentLastReadAt',
        'createdAt',
        'updatedAt',
      ])
    )
  })

  it('visitorPrincipalId + lastMessageAt are not null; assignedAgent + resolvedAt are nullable', () => {
    const cols = getTableColumns(conversations)
    expect(cols.visitorPrincipalId.notNull).toBe(true)
    expect(cols.lastMessageAt.notNull).toBe(true)
    expect(cols.assignedAgentPrincipalId.notNull).toBe(false)
    expect(cols.resolvedAt.notNull).toBe(false)
  })

  it('status enum matches CONVERSATION_STATUSES and defaults to open', () => {
    const cols = getTableColumns(conversations)
    expect(cols.status.enumValues).toEqual([...CONVERSATION_STATUSES])
    expect(cols.status.default).toBe('open')
  })

  it('channel enum matches CHANNELS, has no default, and is not null', () => {
    const cols = getTableColumns(conversations)
    expect(cols.channel.enumValues).toEqual([...CHANNELS])
    // No column default on purpose: every create path sets channel explicitly so
    // a non-messenger conversation cannot be silently mislabeled (#omnichannel).
    expect(cols.channel.default).toBeUndefined()
    expect(cols.channel.notNull).toBe(true)
  })

  it('priority enum matches CONVERSATION_PRIORITIES and defaults to none (not null)', () => {
    const cols = getTableColumns(conversations)
    expect(cols.priority.enumValues).toEqual([...CONVERSATION_PRIORITIES])
    expect(cols.priority.default).toBe('none')
    expect(cols.priority.notNull).toBe(true)
  })

  it('restricts delete of the visitor principal so chat history is never orphaned', () => {
    const cfg = getTableConfig(conversations)
    const fk = cfg.foreignKeys.find((f) => {
      const ref = f.reference()
      return ref.columns.some((c) => c.name === 'visitor_principal_id')
    })
    expect(fk?.onDelete).toBe('restrict')
  })
})

describe('chat_messages schema', () => {
  it('has correct table name', () => {
    expect(getTableName(chatMessages)).toBe('chat_messages')
  })

  it('exposes the expected columns', () => {
    const columns = Object.keys(getTableColumns(chatMessages))
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'conversationId',
        'principalId',
        'senderType',
        'content',
        'createdAt',
        'updatedAt',
        'deletedAt',
        'deletedByPrincipalId',
      ])
    )
  })

  it('conversationId, senderType, content are not null', () => {
    const cols = getTableColumns(chatMessages)
    expect(cols.conversationId.notNull).toBe(true)
    expect(cols.senderType.notNull).toBe(true)
    expect(cols.content.notNull).toBe(true)
  })

  it('principalId is nullable (system events have no human author)', () => {
    const cols = getTableColumns(chatMessages)
    expect(cols.principalId.notNull).toBe(false)
  })

  it('contentJson is a nullable jsonb (rich note bodies; null for plain messages)', () => {
    const cols = getTableColumns(chatMessages)
    expect(cols.contentJson).toBeDefined()
    expect(cols.contentJson.notNull).toBe(false)
    expect(cols.contentJson.columnType).toBe('PgJsonb')
  })

  it('senderType enum matches MESSAGE_SENDER_TYPES', () => {
    const cols = getTableColumns(chatMessages)
    expect(cols.senderType.enumValues).toEqual([...MESSAGE_SENDER_TYPES])
  })

  it('cascades delete from the parent conversation', () => {
    const cfg = getTableConfig(chatMessages)
    const fk = cfg.foreignKeys.find((f) => {
      const ref = f.reference()
      return getTableName(ref.foreignTable) === 'conversations'
    })
    expect(fk?.onDelete).toBe('cascade')
  })

  it('restricts delete of the author principal (merge must re-point first)', () => {
    const cfg = getTableConfig(chatMessages)
    const fk = cfg.foreignKeys.find((f) => {
      const ref = f.reference()
      return ref.columns.some((c) => c.name === 'principal_id')
    })
    expect(fk?.onDelete).toBe('restrict')
  })
})
