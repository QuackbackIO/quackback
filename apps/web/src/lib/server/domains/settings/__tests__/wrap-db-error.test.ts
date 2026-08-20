import { describe, expect, it } from 'vitest'
import { wrapDbError } from '../settings.helpers'
import { InternalError, ValidationError } from '@/lib/shared/errors'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'

describe('wrapDbError', () => {
  it('rethrows a TierLimitError instead of wrapping it as a 500', () => {
    const err = new TierLimitError({
      limit: 'features.customColors',
      message: 'Custom colours is not available on your plan. Upgrade to enable it.',
    })
    expect(() => wrapDbError('update branding config', err)).toThrow(err)
  })

  it('rethrows an entitlement refusal', () => {
    const err = new EntitlementRequiredError({
      entitlement: 'webhooks',
      friendly: 'Webhooks',
      friendlyIsPlural: true,
      requiredPlanArticle: 'a',
      currentPlan: 'free',
      currentPlanName: 'Free',
      requiredPlan: 'growth',
      requiredPlanName: 'Growth',
    })
    expect(() => wrapDbError('update developer config', err)).toThrow(err)
  })

  it('rethrows a validation error', () => {
    const err = new ValidationError(
      'INVALID_CUSTOM_CSS',
      'Custom CSS cannot contain the "<" character'
    )
    expect(() => wrapDbError('update custom CSS', err)).toThrow(err)
  })

  it('wraps an unexpected failure as InternalError', () => {
    expect(() => wrapDbError('fetch branding config', new Error('connection reset'))).toThrow(
      InternalError
    )
  })
})
