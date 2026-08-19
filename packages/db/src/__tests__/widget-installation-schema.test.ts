import { describe, expect, it } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { settings } from '../schema/auth'

describe('widget installation evidence schema', () => {
  it('stores only first seen, last seen, and a normalized origin hostname', () => {
    const columns = getTableColumns(settings)
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'widgetInstalledFirstSeenAt',
        'widgetInstalledLastSeenAt',
        'widgetInstalledOriginHost',
      ])
    )
    expect(columns.widgetInstalledFirstSeenAt.dataType).toBe('date')
    expect(columns.widgetInstalledLastSeenAt.dataType).toBe('date')
    expect(columns.widgetInstalledOriginHost.dataType).toBe('string')
  })
})
