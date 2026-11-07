import { describe, expect, it } from 'vitest'
import { asVisitorInDesigner } from '../designer-visitor'

const admin = { session: { user: { id: 'u' } }, userRole: 'admin' as const }

describe('asVisitorInDesigner', () => {
  it('draws the designer canvas as a signed-in visitor', () => {
    expect(asVisitorInDesigner(admin, { designer: '1', preview: true }).userRole).toBe('user')
  })

  it('leaves every other page, and the other previews, as the person is', () => {
    expect(asVisitorInDesigner(admin, {}).userRole).toBe('admin')
    expect(asVisitorInDesigner(admin, { preview: true }).userRole).toBe('admin')
    expect(asVisitorInDesigner(admin, { designer: '1' }).userRole).toBe('admin')
    const signedOut = { session: null, userRole: null }
    expect(asVisitorInDesigner(signedOut, { designer: '1', preview: true })).toBe(signedOut)
  })
})
