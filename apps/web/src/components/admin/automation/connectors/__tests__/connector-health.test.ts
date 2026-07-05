import { describe, it, expect } from 'vitest'
import { getConnectorHealth } from '../connector-health'

describe('getConnectorHealth', () => {
  it('reports Active for a healthy connector', () => {
    expect(getConnectorHealth({ status: 'active', failureCount: 0 })).toEqual({
      variant: 'default',
      label: 'Active',
    })
  })

  it('reports Issues once failures start accumulating', () => {
    expect(getConnectorHealth({ status: 'active', failureCount: 3 })).toMatchObject({
      variant: 'outline',
      label: 'Issues (3)',
    })
  })

  it('reports Failing at the warning threshold', () => {
    expect(getConnectorHealth({ status: 'active', failureCount: 25 })).toMatchObject({
      variant: 'destructive',
      label: 'Failing (25/50)',
    })
  })

  it('reports Disabled for an admin-disabled connector below the auto-disable threshold', () => {
    expect(getConnectorHealth({ status: 'disabled', failureCount: 0 })).toEqual({
      variant: 'secondary',
      label: 'Disabled',
    })
  })

  it('reports Auto-disabled once the circuit breaker trips', () => {
    expect(getConnectorHealth({ status: 'disabled', failureCount: 50 })).toMatchObject({
      variant: 'destructive',
      label: 'Auto-disabled',
      title: 'Auto-disabled after 50 failures',
    })
  })
})
