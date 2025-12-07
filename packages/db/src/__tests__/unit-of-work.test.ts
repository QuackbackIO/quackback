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

    it('accepts organizationId and callback parameters', () => {
      expect(withUnitOfWork.length).toBe(2)
    })

    it('throws error for invalid organization ID format', async () => {
      await expect(withUnitOfWork('invalid-id', async () => {})).rejects.toThrow(
        'Invalid organization ID format'
      )
    })

    it('throws error for empty organization ID', async () => {
      await expect(withUnitOfWork('', async () => {})).rejects.toThrow(
        'Invalid organization ID format'
      )
    })

    it('throws error for SQL injection attempt', async () => {
      await expect(withUnitOfWork("'; DROP TABLE users; --", async () => {})).rejects.toThrow(
        'Invalid organization ID format'
      )
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
