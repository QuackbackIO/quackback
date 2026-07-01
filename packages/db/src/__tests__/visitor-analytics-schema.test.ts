import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { pageViews, visitorStatsDaily, visitorTopStats } from '../schema/visitor-analytics'

describe('visitor analytics schema', () => {
  describe('pageViews', () => {
    it('has correct table name', () => {
      expect(getTableName(pageViews)).toBe('page_views')
    })

    it('has required columns', () => {
      const columns = Object.keys(getTableColumns(pageViews))
      expect(columns).toEqual(
        expect.arrayContaining([
          'id',
          'occurredAt',
          'siteOrigin',
          'surface',
          'path',
          'source',
          'country',
          'device',
          'browser',
          'os',
          'visitorHash',
          'deviceId',
          'principalId',
        ])
      )
      expect(columns.length).toBe(13)
    })

    it('never carries raw identifier columns', () => {
      // Privacy invariant: raw IP / User-Agent are used transiently to compute
      // visitor_hash and the device columns, then discarded — never stored.
      const columns = Object.keys(getTableColumns(pageViews))
      expect(columns).not.toContain('ip')
      expect(columns).not.toContain('ipAddress')
      expect(columns).not.toContain('userAgent')
    })
  })

  describe('visitorStatsDaily', () => {
    it('has correct table name and columns', () => {
      expect(getTableName(visitorStatsDaily)).toBe('visitor_stats_daily')
      const columns = Object.keys(getTableColumns(visitorStatsDaily))
      expect(columns).toEqual(
        expect.arrayContaining([
          'date',
          'surface',
          'uniqueVisitors',
          'pageviews',
          'visits',
          'computedAt',
        ])
      )
    })
  })

  describe('visitorTopStats', () => {
    it('has correct table name and columns', () => {
      expect(getTableName(visitorTopStats)).toBe('visitor_top_stats')
      const columns = Object.keys(getTableColumns(visitorTopStats))
      expect(columns).toEqual(
        expect.arrayContaining([
          'period',
          'surface',
          'dimension',
          'rank',
          'label',
          'count',
          'computedAt',
        ])
      )
    })
  })
})
