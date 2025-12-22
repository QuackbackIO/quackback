import { describe, it, expect } from 'vitest'
import { UnitOfWork, withUnitOfWork } from '../unit-of-work'

describe('Unit of Work Module', () => {
  describe('Exports', () => {
    it('exports UnitOfWork class', () => {
      expect(typeof UnitOfWork).toBe('function')
      expect(UnitOfWork.name).toBe('UnitOfWork')
    })

    it('exports withUnitOfWork function', () => {
      expect(typeof withUnitOfWork).toBe('function')
    })
  })

  describe('withUnitOfWork', () => {
    it('is an async function', () => {
      expect(withUnitOfWork.constructor.name).toBe('AsyncFunction')
    })

    it('accepts callback parameter', () => {
      // In single-tenant mode, withUnitOfWork only takes a callback
      expect(withUnitOfWork.length).toBe(1)
    })
  })

  describe('UnitOfWork', () => {
    it('has db getter', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockDb = {} as any
      const uow = new UnitOfWork(mockDb)
      expect(uow.db).toBe(mockDb)
    })
  })
})
