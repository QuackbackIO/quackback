import { describe, it, expect } from 'vitest'
import { coerceAttributeValue } from '../coerce'

describe('coerceAttributeValue', () => {
  describe('string type', () => {
    it('should coerce numbers to strings', () => {
      expect(coerceAttributeValue(42, 'string')).toBe('42')
    })

    it('should coerce booleans to strings', () => {
      expect(coerceAttributeValue(true, 'string')).toBe('true')
    })

    it('should pass strings through', () => {
      expect(coerceAttributeValue('hello', 'string')).toBe('hello')
    })

    it('should coerce empty string', () => {
      expect(coerceAttributeValue('', 'string')).toBe('')
    })
  })

  describe('number type', () => {
    it('should pass numbers through', () => {
      expect(coerceAttributeValue(42, 'number')).toBe(42)
    })

    it('should coerce numeric strings', () => {
      expect(coerceAttributeValue('3.14', 'number')).toBe(3.14)
    })

    it('should coerce negative numbers', () => {
      expect(coerceAttributeValue('-10', 'number')).toBe(-10)
    })

    it('should return undefined for non-numeric strings', () => {
      expect(coerceAttributeValue('abc', 'number')).toBeUndefined()
    })

    it('should coerce zero', () => {
      expect(coerceAttributeValue(0, 'number')).toBe(0)
      expect(coerceAttributeValue('0', 'number')).toBe(0)
    })
  })

  describe('currency type', () => {
    it('should coerce like number type', () => {
      expect(coerceAttributeValue(99.99, 'currency')).toBe(99.99)
    })

    it('should coerce numeric strings', () => {
      expect(coerceAttributeValue('1250', 'currency')).toBe(1250)
    })

    it('should return undefined for non-numeric strings', () => {
      expect(coerceAttributeValue('$50', 'currency')).toBeUndefined()
    })
  })

  describe('boolean type', () => {
    it('should pass booleans through', () => {
      expect(coerceAttributeValue(true, 'boolean')).toBe(true)
      expect(coerceAttributeValue(false, 'boolean')).toBe(false)
    })

    it('should coerce string "true" and "1"', () => {
      expect(coerceAttributeValue('true', 'boolean')).toBe(true)
      expect(coerceAttributeValue('1', 'boolean')).toBe(true)
    })

    it('should coerce string "false" and "0"', () => {
      expect(coerceAttributeValue('false', 'boolean')).toBe(false)
      expect(coerceAttributeValue('0', 'boolean')).toBe(false)
    })

    it('should return undefined for non-boolean values', () => {
      expect(coerceAttributeValue('yes', 'boolean')).toBeUndefined()
      expect(coerceAttributeValue(42, 'boolean')).toBeUndefined()
    })
  })

  describe('date type', () => {
    it('should coerce ISO date strings', () => {
      const result = coerceAttributeValue('2024-01-15T12:00:00Z', 'date')
      expect(result).toBe('2024-01-15T12:00:00.000Z')
    })

    it('should coerce date-only strings', () => {
      const result = coerceAttributeValue('2024-06-01', 'date')
      expect(typeof result).toBe('string')
      expect(result).toContain('2024-06-01')
    })

    it('should coerce Unix timestamps (numbers)', () => {
      const timestamp = new Date('2024-01-15T00:00:00Z').getTime()
      const result = coerceAttributeValue(timestamp, 'date')
      expect(result).toBe('2024-01-15T00:00:00.000Z')
    })

    it('should return undefined for invalid date strings', () => {
      expect(coerceAttributeValue('not-a-date', 'date')).toBeUndefined()
    })

    it('should return undefined for non-string/non-number values', () => {
      expect(coerceAttributeValue(true, 'date')).toBeUndefined()
      expect(coerceAttributeValue({}, 'date')).toBeUndefined()
    })
  })

  describe('null and undefined handling', () => {
    it('should return undefined for null', () => {
      expect(coerceAttributeValue(null, 'string')).toBeUndefined()
      expect(coerceAttributeValue(null, 'number')).toBeUndefined()
      expect(coerceAttributeValue(null, 'boolean')).toBeUndefined()
    })

    it('should return undefined for undefined', () => {
      expect(coerceAttributeValue(undefined, 'string')).toBeUndefined()
      expect(coerceAttributeValue(undefined, 'number')).toBeUndefined()
    })
  })

  describe('unknown type', () => {
    it('should return undefined for unsupported types', () => {
      expect(coerceAttributeValue('value', 'unknown' as never)).toBeUndefined()
    })
  })
})
