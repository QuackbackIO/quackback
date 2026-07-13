import { describe, expect, it } from 'vitest'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { integrationSyncLog } from '../schema/integration-sync-log'

type DriverMappable = {
  mapToDriverValue(value: unknown): unknown
  mapFromDriverValue(value: unknown): unknown
}

describe('integration_sync_log schema', () => {
  it('has the expected table and columns', () => {
    expect(getTableName(integrationSyncLog)).toBe('integration_sync_log')
    expect(Object.keys(getTableColumns(integrationSyncLog))).toEqual(
      expect.arrayContaining([
        'id',
        'integrationId',
        'ticketId',
        'eventType',
        'direction',
        'status',
        'errorMessage',
        'durationMs',
        'createdAt',
      ])
    )
  })

  it('maps TypeID integration and ticket ids to UUID driver values', () => {
    const columns = getTableColumns(integrationSyncLog)
    const integrationColumn = columns.integrationId as unknown as DriverMappable
    const ticketColumn = columns.ticketId as unknown as DriverMappable
    const uuid = '00000000-0000-0000-0000-000000000000'
    const integrationId = 'integration_00000000000000000000000000'
    const ticketId = 'ticket_00000000000000000000000000'

    expect(integrationColumn.mapToDriverValue(integrationId)).toBe(uuid)
    expect(integrationColumn.mapFromDriverValue(uuid)).toBe(integrationId)
    expect(ticketColumn.mapToDriverValue(ticketId)).toBe(uuid)
    expect(ticketColumn.mapFromDriverValue(uuid)).toBe(ticketId)
    expect(ticketColumn.mapToDriverValue(null)).toBeNull()
    expect(ticketColumn.mapFromDriverValue(null)).toBeNull()
  })
})
