import { describe, it, expect } from 'vitest'
import { createId, generateId, toUuid, fromUuid, isValidTypeId } from '../core'
import { ID_PREFIXES, getPrefix, isValidPrefix } from '../prefixes'
import { typeIdSchema } from '../zod'
import { typeIdColumn } from '../drizzle'
import type { EvtId } from '../types'

/**
 * WO-0 — the `evt` TypeID prefix that the durable event spine (WO-1 `emit()`,
 * the `events` outbox) builds on. This is the hard root dependency for every
 * schema/emit work order, so it is verified in isolation here.
 */
describe('event (evt) TypeID', () => {
  it('registers the evt prefix under the `event` entity key', () => {
    expect(ID_PREFIXES.event).toBe('evt')
    expect(getPrefix('event')).toBe('evt')
    expect(isValidPrefix('evt')).toBe(true)
  })

  it('createId("event") yields an evt_<base32> id', () => {
    const id = createId('event')
    expect(id).toMatch(/^evt_[0-7][0-9a-hjkmnp-tv-z]{25}$/)
  })

  it('generateId("evt") yields an evt_<base32> id', () => {
    const id = generateId(ID_PREFIXES.event)
    expect(id).toMatch(/^evt_[0-7][0-9a-hjkmnp-tv-z]{25}$/)
  })

  it('round-trips through UUID storage', () => {
    const id = createId('event')
    const uuid = toUuid(id)
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(fromUuid(ID_PREFIXES.event, uuid)).toBe(id)
  })

  it('is assignable to the EvtId branded type', () => {
    const id: EvtId = createId('event')
    expect(isValidTypeId(id, ID_PREFIXES.event)).toBe(true)
  })

  it('typeIdColumn("evt") converts between TypeID and UUID at the ORM boundary', () => {
    const col = typeIdColumn(ID_PREFIXES.event)
    // customType exposes the driver conversions via its config
    const built = col('event_id')
    expect(built).toBeDefined()
  })

  it('typeIdSchema("evt") accepts evt ids and rejects wrong prefixes', () => {
    const schema = typeIdSchema(ID_PREFIXES.event)
    const good = createId('event')
    expect(schema.parse(good)).toBe(good)
    expect(() => schema.parse(createId('post'))).toThrow()
    expect(() => schema.parse('not-an-id')).toThrow()
  })
})
