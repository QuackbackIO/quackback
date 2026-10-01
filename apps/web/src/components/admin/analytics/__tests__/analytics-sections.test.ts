import { describe, it, expect } from 'vitest'
import { SECTION_NAV_ITEMS, parseSection } from '../analytics-sections'
import { ENTITY_ICONS } from '@/components/admin/entity-icon'

function item(key: string) {
  const found = SECTION_NAV_ITEMS.find((i) => i.key === key)
  if (!found) throw new Error(`missing section ${key}`)
  return found
}

describe('SECTION_NAV_ITEMS', () => {
  it('uses the rail icon for each product section', () => {
    expect(item('feedback').icon).toBe(ENTITY_ICONS.post)
    expect(item('support').icon).toBe(ENTITY_ICONS.conversation)
    expect(item('changelog').icon).toBe(ENTITY_ICONS.changelog)
  })

  it('names the assistant section Quinn', () => {
    expect(item('ai').label).toBe('Quinn')
  })
})

describe('parseSection', () => {
  it('accepts every section key', () => {
    for (const { key } of SECTION_NAV_ITEMS) expect(parseSection(key)).toBe(key)
  })

  it('falls back to overview for anything else', () => {
    expect(parseSection('nope')).toBe('overview')
    expect(parseSection(undefined)).toBe('overview')
    expect(parseSection(3)).toBe('overview')
  })
})
