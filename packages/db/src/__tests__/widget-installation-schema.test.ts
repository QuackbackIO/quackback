import { describe, expect, it } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { settings } from '../schema/auth'

describe('widget installation evidence schema', () => {
  it('stores first seen, last seen, origin hostname, and last SDK version', () => {
    const columns = getTableColumns(settings)
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'widgetInstalledFirstSeenAt',
        'widgetInstalledLastSeenAt',
        'widgetInstalledOriginHost',
        'widgetInstalledSdkVersion',
      ])
    )
    expect(columns.widgetInstalledFirstSeenAt.dataType).toBe('date')
    expect(columns.widgetInstalledLastSeenAt.dataType).toBe('date')
    expect(columns.widgetInstalledOriginHost.dataType).toBe('string')
    expect(columns.widgetInstalledSdkVersion.dataType).toBe('string')
  })
})
