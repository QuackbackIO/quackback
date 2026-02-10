import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WIDGET_CONFIG,
  type WidgetConfig,
  type UpdateWidgetConfigInput,
  type PublicWidgetConfig,
} from '../settings.types'
import { generateWidgetSecret } from '../settings.service'

describe('Widget Config Types', () => {
  describe('DEFAULT_WIDGET_CONFIG', () => {
    it('should have enabled set to false', () => {
      expect(DEFAULT_WIDGET_CONFIG.enabled).toBe(false)
    })

    it('should have identifyVerification set to false', () => {
      expect(DEFAULT_WIDGET_CONFIG.identifyVerification).toBe(false)
    })

    it('should not have optional fields set', () => {
      expect(DEFAULT_WIDGET_CONFIG.defaultBoard).toBeUndefined()
      expect(DEFAULT_WIDGET_CONFIG.position).toBeUndefined()
      expect(DEFAULT_WIDGET_CONFIG.buttonText).toBeUndefined()
    })
  })

  describe('WidgetConfig type constraints', () => {
    it('should accept a full config', () => {
      const config: WidgetConfig = {
        enabled: true,
        defaultBoard: 'feature-requests',
        position: 'bottom-right',
        buttonText: 'Feedback',
        identifyVerification: true,
      }
      expect(config.enabled).toBe(true)
      expect(config.position).toBe('bottom-right')
    })

    it('should accept minimal config', () => {
      const config: WidgetConfig = {
        enabled: false,
      }
      expect(config.enabled).toBe(false)
    })

    it('should accept bottom-left position', () => {
      const config: WidgetConfig = {
        enabled: true,
        position: 'bottom-left',
      }
      expect(config.position).toBe('bottom-left')
    })
  })

  describe('UpdateWidgetConfigInput', () => {
    it('should accept partial updates', () => {
      const update: UpdateWidgetConfigInput = {
        enabled: true,
      }
      expect(update.enabled).toBe(true)
      expect(update.defaultBoard).toBeUndefined()
    })

    it('should accept all fields', () => {
      const update: UpdateWidgetConfigInput = {
        enabled: true,
        defaultBoard: 'bugs',
        position: 'bottom-left',
        buttonText: 'Report',
        identifyVerification: true,
      }
      expect(update.buttonText).toBe('Report')
    })
  })

  describe('PublicWidgetConfig', () => {
    it('should only include public fields', () => {
      const publicConfig: PublicWidgetConfig = {
        enabled: true,
        defaultBoard: 'bugs',
        position: 'bottom-right',
        buttonText: 'Send Feedback',
      }
      expect(publicConfig.enabled).toBe(true)
      // identifyVerification is NOT in PublicWidgetConfig (type-level check)
      expect('identifyVerification' in publicConfig).toBe(false)
    })
  })
})

describe('generateWidgetSecret', () => {
  it('should start with wgt_ prefix', () => {
    const secret = generateWidgetSecret()
    expect(secret).toMatch(/^wgt_/)
  })

  it('should be 68 chars total (4 prefix + 64 hex)', () => {
    const secret = generateWidgetSecret()
    expect(secret.length).toBe(68)
  })

  it('should have valid hex characters after prefix', () => {
    const secret = generateWidgetSecret()
    const hex = secret.slice(4)
    expect(hex).toMatch(/^[a-f0-9]{64}$/)
  })

  it('should generate unique secrets', () => {
    const secret1 = generateWidgetSecret()
    const secret2 = generateWidgetSecret()
    expect(secret1).not.toBe(secret2)
  })
})
