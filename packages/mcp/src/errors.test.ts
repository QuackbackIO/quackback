import { describe, it, expect } from 'vitest'
import { ApiError, AuthError } from './errors.js'

describe('ApiError', () => {
  it('should create an error with status and message', () => {
    const error = new ApiError(404, 'Not Found')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(404)
    expect(error.message).toBe('Not Found')
    expect(error.name).toBe('ApiError')
  })
})

describe('AuthError', () => {
  it('should create an auth error with message', () => {
    const error = new AuthError('Invalid API key')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(AuthError)
    expect(error.message).toBe('Invalid API key')
    expect(error.name).toBe('AuthError')
  })
})
