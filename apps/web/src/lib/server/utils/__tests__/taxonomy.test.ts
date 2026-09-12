import { describe, expect, it } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'
import { assertHexColor, assertTrimmedName } from '../taxonomy'

describe('assertTrimmedName', () => {
  it('trims and returns a valid name', () => {
    expect(assertTrimmedName('  Bug ', { required: 'Name is required', tooLong: 'too long' })).toBe(
      'Bug'
    )
  })

  it('rejects empty / whitespace with the call-site required message', () => {
    expect(() =>
      assertTrimmedName('   ', { required: 'PostTag name is required', tooLong: 'too long' })
    ).toThrow(new ValidationError('VALIDATION_ERROR', 'PostTag name is required'))
  })

  it('rejects over-length with the call-site tooLong message', () => {
    expect(() =>
      assertTrimmedName('x'.repeat(51), {
        required: 'required',
        tooLong: 'Name must be 50 characters or less',
      })
    ).toThrow(new ValidationError('VALIDATION_ERROR', 'Name must be 50 characters or less'))
  })

  it('honors a custom max length', () => {
    expect(assertTrimmedName('x'.repeat(60), { required: 'r', tooLong: 't' }, 60)).toHaveLength(60)
    expect(() =>
      assertTrimmedName('x'.repeat(61), { required: 'r', tooLong: 'too long' }, 60)
    ).toThrow(new ValidationError('VALIDATION_ERROR', 'too long'))
  })
})

describe('assertHexColor', () => {
  it('accepts #rrggbb', () => {
    expect(assertHexColor('#3b82f6', 'bad')).toBe('#3b82f6')
  })

  it('rejects non-hex with the call-site message', () => {
    expect(() => assertHexColor('blue', 'Color must be a valid hex color (e.g., #6b7280)')).toThrow(
      new ValidationError('VALIDATION_ERROR', 'Color must be a valid hex color (e.g., #6b7280)')
    )
  })
})
