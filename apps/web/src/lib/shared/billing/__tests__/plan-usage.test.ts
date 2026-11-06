import { describe, expect, it } from 'vitest'
import { finiteUsageLines, formatUsageLine, planUsageLines } from '../plan-usage'

const NEW_KEYS = ['maxInboundEmailAddresses', 'maxHelpCenterLocales', 'maxStatusSubscribers']

describe('planUsageLines', () => {
  const limits = {
    maxInboundEmailAddresses: 1,
    maxHelpCenterLocales: null,
    maxStatusSubscribers: 100,
  }

  it('shows the three new caps with their labels, usage and limit', () => {
    const lines = planUsageLines(limits, {
      maxInboundEmailAddresses: 1,
      maxHelpCenterLocales: 2,
      maxStatusSubscribers: 37,
    })
    expect(lines.filter((line) => NEW_KEYS.includes(line.key))).toEqual([
      { key: 'maxInboundEmailAddresses', label: 'inbound email addresses', used: 1, limit: 1 },
      { key: 'maxHelpCenterLocales', label: 'help center languages', used: 2, limit: null },
      { key: 'maxStatusSubscribers', label: 'status subscribers', used: 37, limit: 100 },
    ])
  })

  it('reads a missing usage count as zero and a missing limit as unlimited', () => {
    const lines = planUsageLines({}, {})
    const subscribers = lines.find((line) => line.key === 'maxStatusSubscribers')
    expect(subscribers).toEqual({
      key: 'maxStatusSubscribers',
      label: 'status subscribers',
      used: 0,
      limit: null,
    })
  })

  it('keeps capped lines on the card and drops unlimited ones', () => {
    const keys = finiteUsageLines(planUsageLines(limits, {})).map((line) => line.key)
    expect(keys).toContain('maxInboundEmailAddresses')
    expect(keys).toContain('maxStatusSubscribers')
    expect(keys).not.toContain('maxHelpCenterLocales')
  })

  it('renders a capped subscriber line as used of limit', () => {
    const line = planUsageLines(limits, { maxStatusSubscribers: 37 }).find(
      (row) => row.key === 'maxStatusSubscribers'
    )!
    expect(formatUsageLine(line)).toBe('37 of 100 status subscribers')
  })
})
