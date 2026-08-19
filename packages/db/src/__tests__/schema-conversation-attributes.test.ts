import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { conversationAttributeDefinitions } from '../schema/conversation-attributes'

describe('Conversation attribute definitions schema', () => {
  it('table name', () => {
    expect(getTableName(conversationAttributeDefinitions)).toBe(
      'conversation_attribute_definitions'
    )
  })

  it('columns', () => {
    const cols = Object.keys(getTableColumns(conversationAttributeDefinitions))
    expect(cols.sort()).toEqual(
      [
        'id',
        'key',
        'label',
        'description',
        'fieldType',
        'options',
        'requiredToClose',
        'sourceHint',
        'aiDetect',
        'detectOnClose',
        'archivedAt',
        'createdAt',
        'updatedAt',
      ].sort()
    )
  })

  it('0156 migration pins the load-bearing constraints', () => {
    const sql = readFileSync(
      join(__dirname, '../../drizzle/0156_conversation_attributes.sql'),
      'utf8'
    )
    // One definition per machine key (the key indexes into custom_attributes).
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "conversation_attribute_definitions_key_idx"\s*ON "conversation_attribute_definitions" \("key"\)/
    )
    // Required-to-close defaults off; archive-only lifecycle has no delete DDL.
    expect(sql).toMatch(/"required_to_close" boolean DEFAULT false NOT NULL/)
    expect(sql).toMatch(/"archived_at" timestamp with time zone/)
    // Tag names become case-insensitively unique (dedupe pinned in
    // migration-0156-tag-dedupe.test.ts).
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "conversation_tags_name_lower_key"\s*ON "conversation_tags" \(lower\("name"\)\)/
    )
  })

  it('0178 migration adds the ai_detect/detect_on_close columns and seeds the four system definitions', () => {
    const sql = readFileSync(
      join(__dirname, '../../drizzle/0178_ai_attribute_detection.sql'),
      'utf8'
    )
    expect(sql).toMatch(/ADD COLUMN "ai_detect" boolean DEFAULT false NOT NULL/)
    expect(sql).toMatch(/ADD COLUMN "detect_on_close" boolean DEFAULT false NOT NULL/)
    for (const key of ['issue_type', 'sentiment', 'urgency', 'spam']) {
      expect(sql).toContain(`'${key}'`)
    }
    // Seeded system definitions are select-only, opt-in (ai_detect false), and
    // the classifier prompt hint (source_hint 'ai') so admins can find them.
    expect(sql.match(/'select'/g)?.length).toBeGreaterThanOrEqual(4)
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING')
  })
})
