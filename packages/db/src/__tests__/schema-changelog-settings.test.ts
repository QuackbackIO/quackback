import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableName, getTableColumns } from 'drizzle-orm'
import {
  changelogCategories,
  changelogEntryCategories,
} from '../schema/changelog-categories'
import { changelogSubscriptions } from '../schema/changelog-subscriptions'

describe('changelog settings schema (migration 0158)', () => {
  describe('changelogCategories', () => {
    it('has correct table name', () => {
      expect(getTableName(changelogCategories)).toBe('changelog_categories')
    })

    it('carries name/color/segment gating/position', () => {
      const columns = Object.keys(getTableColumns(changelogCategories))
      expect(columns.sort()).toEqual(
        ['id', 'name', 'color', 'segmentIds', 'position', 'createdAt'].sort()
      )
    })

    it('segmentIds defaults to empty (everyone)', () => {
      expect(changelogCategories.segmentIds.notNull).toBe(true)
      expect(changelogCategories.segmentIds.default).toEqual([])
    })
  })

  describe('changelogEntryCategories', () => {
    it('has correct table name', () => {
      expect(getTableName(changelogEntryCategories)).toBe('changelog_entry_categories')
    })

    it('is a pure M:N link (no surrogate id)', () => {
      const columns = Object.keys(getTableColumns(changelogEntryCategories))
      expect(columns.sort()).toEqual(['changelogEntryId', 'categoryId'].sort())
    })
  })

  describe('changelogSubscriptions', () => {
    it('has correct table name', () => {
      expect(getTableName(changelogSubscriptions)).toBe('changelog_subscriptions')
    })

    it('carries principal, source, and soft-unsubscribe', () => {
      const columns = Object.keys(getTableColumns(changelogSubscriptions))
      expect(columns.sort()).toEqual(
        ['id', 'principalId', 'source', 'unsubscribedAt', 'createdAt'].sort()
      )
    })
  })

  it('0158 migration pins the load-bearing constraints', () => {
    const sql = readFileSync(join(__dirname, '../../drizzle/0158_changelog_settings.sql'), 'utf8')

    // Category names are case-insensitively unique.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "changelog_category_name_lower_idx"\s*ON "changelog_categories" USING btree \(lower\("name"\)\)/
    )
    // Empty segment_ids = everyone can see the category.
    expect(sql).toMatch(/"segment_ids" jsonb DEFAULT '\[\]'::jsonb NOT NULL/)
    // Entry <-> category link is a composite PK, cascades with either side.
    expect(sql).toMatch(
      /CONSTRAINT "changelog_entry_categories_pk" PRIMARY KEY\("changelog_entry_id","category_id"\)/
    )
    expect(sql).toMatch(/REFERENCES "public"\."changelog_entries"\("id"\) ON DELETE cascade/)
    expect(sql).toMatch(/REFERENCES "public"\."changelog_categories"\("id"\) ON DELETE cascade/)
    // One subscription row per principal.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "changelog_subscriptions_principal_idx"\s*ON "changelog_subscriptions" USING btree \("principal_id"\)/
    )
    expect(sql).toMatch(/REFERENCES "public"\."principal"\("id"\) ON DELETE cascade/)
  })
})
