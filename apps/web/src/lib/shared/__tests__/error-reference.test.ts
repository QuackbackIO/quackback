import { describe, expect, it } from 'vitest'
import {
  UNEXPECTED_ERROR_MESSAGE,
  errorReferenceOf,
  liftErrorReference,
  splitErrorReference,
  withErrorReference,
} from '../error-reference'

const carried = withErrorReference(UNEXPECTED_ERROR_MESSAGE, 'D264-C488')

describe('error reference', () => {
  it('travels at the end of the message and comes back off whole', () => {
    expect(carried).toBe(`${UNEXPECTED_ERROR_MESSAGE} (Ref D264-C488)`)
    expect(splitErrorReference(carried)).toEqual({
      message: UNEXPECTED_ERROR_MESSAGE,
      reference: 'D264-C488',
    })
  })

  it('leaves a message without one as it is', () => {
    expect(splitErrorReference('That slug is taken (Ref: see docs)')).toEqual({
      message: 'That slug is taken (Ref: see docs)',
      reference: null,
    })
  })

  it('lifts the reference onto the error so the message prints clean', () => {
    const error = new Error(carried)
    expect(liftErrorReference(error)).toBe(error)
    expect(error.message).toBe(UNEXPECTED_ERROR_MESSAGE)
    expect(errorReferenceOf(error)).toBe('D264-C488')
  })

  it('reads a reference still in the message, as a server-rendered error has it', () => {
    expect(errorReferenceOf({ message: carried })).toBe('D264-C488')
    expect(errorReferenceOf(carried)).toBe('D264-C488')
    expect(errorReferenceOf(new Error('boom'))).toBeNull()
    expect(errorReferenceOf(null)).toBeNull()
  })

  it('passes anything that is not a marked error through untouched', () => {
    const plain = new Error('Pick a board first')
    expect(liftErrorReference(plain)).toBe(plain)
    expect(plain.message).toBe('Pick a board first')
    const thrown = { isRedirect: true }
    expect(liftErrorReference(thrown)).toBe(thrown)
  })
})
