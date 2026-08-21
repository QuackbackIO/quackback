import { describe, expect, it } from 'vitest'
import { displayWorkspaceName } from '../-ready-copy'

describe('displayWorkspaceName', () => {
  it('hides the provisioned placeholder so the ready title never reads as Untitled', () => {
    expect(displayWorkspaceName('Untitled workspace')).toBeNull()
    expect(displayWorkspaceName('  untitled workspace  ')).toBeNull()
    expect(displayWorkspaceName('')).toBeNull()
    expect(displayWorkspaceName(null)).toBeNull()
  })

  it('keeps a name the owner chose, even if it has punctuation', () => {
    expect(displayWorkspaceName('Awesome!')).toBe('Awesome!')
    expect(displayWorkspaceName('Acme')).toBe('Acme')
  })
})
