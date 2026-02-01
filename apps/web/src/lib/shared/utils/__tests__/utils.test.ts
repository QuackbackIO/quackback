import { describe, it, expect } from 'vitest'
import { cn } from '..'

describe('cn utility', () => {
  describe('basic class merging', () => {
    it('merges class names', () => {
      expect(cn('foo', 'bar')).toBe('foo bar')
    })

    it('handles single class', () => {
      expect(cn('foo')).toBe('foo')
    })

    it('handles empty input', () => {
      expect(cn()).toBe('')
    })

    it('handles multiple classes', () => {
      expect(cn('a', 'b', 'c', 'd')).toBe('a b c d')
    })
  })

  describe('conditional classes', () => {
    it('handles truthy conditional classes', () => {
      const isActive = true
      expect(cn('base', isActive && 'active')).toBe('base active')
    })

    it('handles falsy conditional classes', () => {
      const isInactive = false
      expect(cn('base', isInactive && 'inactive')).toBe('base')
    })

    it('handles mixed conditionals', () => {
      const show = true
      const hide = false
      expect(cn('base', show && 'visible', hide && 'hidden')).toBe('base visible')
    })
  })

  describe('nullish values', () => {
    it('handles undefined', () => {
      expect(cn('base', undefined, 'end')).toBe('base end')
    })

    it('handles null', () => {
      expect(cn('base', null, 'end')).toBe('base end')
    })

    it('handles undefined and null together', () => {
      expect(cn('base', undefined, null, 'end')).toBe('base end')
    })
  })

  describe('tailwind class merging', () => {
    it('merges conflicting padding classes', () => {
      expect(cn('px-4 py-2', 'px-6')).toBe('py-2 px-6')
    })

    it('handles conflicting text color classes', () => {
      expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
    })

    it('handles conflicting background classes', () => {
      expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500')
    })

    it('preserves non-conflicting classes', () => {
      expect(cn('bg-red-500', 'text-white')).toBe('bg-red-500 text-white')
    })

    it('handles conflicting font size classes', () => {
      expect(cn('text-sm', 'text-lg')).toBe('text-lg')
    })

    it('handles conflicting margin classes', () => {
      expect(cn('m-2', 'm-4')).toBe('m-4')
    })

    it('handles conflicting width classes', () => {
      expect(cn('w-full', 'w-1/2')).toBe('w-1/2')
    })

    it('handles conflicting flex classes', () => {
      expect(cn('flex-row', 'flex-col')).toBe('flex-col')
    })
  })

  describe('arrays of classes', () => {
    it('handles array of classes', () => {
      expect(cn(['foo', 'bar'], 'baz')).toBe('foo bar baz')
    })

    it('handles nested arrays', () => {
      expect(cn(['a', 'b'], ['c', 'd'])).toBe('a b c d')
    })

    it('handles array with conditionals', () => {
      const isActive = true
      expect(cn(['base'], isActive && 'active')).toBe('base active')
    })
  })

  describe('objects with boolean values', () => {
    it('handles object with true values', () => {
      expect(cn({ active: true, disabled: false })).toBe('active')
    })

    it('handles object with all true values', () => {
      expect(cn({ foo: true, bar: true })).toBe('foo bar')
    })

    it('handles object with all false values', () => {
      expect(cn({ foo: false, bar: false })).toBe('')
    })

    it('handles mixed strings and objects', () => {
      expect(cn('base', { active: true, disabled: false })).toBe('base active')
    })
  })

  describe('complex combinations', () => {
    it('handles complex real-world example', () => {
      const isActive = true
      const isDisabled = false
      const variant = 'primary'
      expect(
        cn(
          'px-4 py-2 rounded',
          variant === 'primary' && 'bg-blue-500 text-white',
          isActive && 'ring-2 ring-blue-300',
          isDisabled && 'opacity-50 cursor-not-allowed'
        )
      ).toBe('px-4 py-2 rounded bg-blue-500 text-white ring-2 ring-blue-300')
    })

    it('handles button variant pattern', () => {
      const baseStyles = 'inline-flex items-center justify-center rounded-md'
      const variants = {
        default: 'bg-primary text-primary-foreground',
        destructive: 'bg-destructive text-destructive-foreground',
      }
      const sizes = {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-8',
      }
      expect(cn(baseStyles, variants.default, sizes.sm)).toBe(
        'inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground h-9 px-3'
      )
    })
  })
})
