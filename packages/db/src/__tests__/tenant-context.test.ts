import { describe, it, expect } from 'vitest'
import {
  withTenantContext,
  setTenantContext,
  clearTenantContext,
  db,
} from '../tenant-context'

describe('Tenant Context Module', () => {
  describe('Exports', () => {
    it('exports withTenantContext function', () => {
      expect(typeof withTenantContext).toBe('function')
    })

    it('exports setTenantContext function', () => {
      expect(typeof setTenantContext).toBe('function')
    })

    it('exports clearTenantContext function', () => {
      expect(typeof clearTenantContext).toBe('function')
    })

    it('exports db instance', () => {
      expect(db).toBeDefined()
    })
  })

  describe('withTenantContext', () => {
    it('is an async function', () => {
      expect(withTenantContext.constructor.name).toBe('AsyncFunction')
    })

    it('accepts organizationId and callback parameters', () => {
      expect(withTenantContext.length).toBe(2)
    })
  })

  describe('setTenantContext', () => {
    it('is an async function', () => {
      expect(setTenantContext.constructor.name).toBe('AsyncFunction')
    })

    it('accepts organizationId parameter', () => {
      expect(setTenantContext.length).toBe(1)
    })
  })

  describe('clearTenantContext', () => {
    it('is an async function', () => {
      expect(clearTenantContext.constructor.name).toBe('AsyncFunction')
    })

    it('accepts no parameters', () => {
      expect(clearTenantContext.length).toBe(0)
    })
  })
})
