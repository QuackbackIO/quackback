import { describe, expect, it } from 'vitest'
import { betterAuthMcpResource } from '../mcp-plugin-resource'

describe('betterAuthMcpResource', () => {
  it('leaves https and bare loopback hosts alone', () => {
    expect(betterAuthMcpResource('https://feedback.example.com/api/mcp')).toBe(
      'https://feedback.example.com/api/mcp'
    )
    expect(betterAuthMcpResource('http://localhost:3008/api/mcp')).toBe(
      'http://localhost:3008/api/mcp'
    )
    expect(betterAuthMcpResource('http://127.0.0.1:3008/api/mcp')).toBe(
      'http://127.0.0.1:3008/api/mcp'
    )
  })

  it('collapses RFC 6761 *.localhost onto localhost for Better Auth 1.7.4', () => {
    expect(betterAuthMcpResource('http://acme.localhost:3000/api/mcp')).toBe(
      'http://localhost:3000/api/mcp'
    )
  })
})
