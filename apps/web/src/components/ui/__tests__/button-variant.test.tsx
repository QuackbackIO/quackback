// @vitest-environment happy-dom
/**
 * A button names its variant, so a design can colour primary buttons without
 * touching the others.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '../button'

describe('a button', () => {
  it('names its variant, primary by default', () => {
    render(
      <>
        <Button>Save</Button>
        <Button variant="outline">Cancel</Button>
        <Button asChild>
          <a href="/x">Go</a>
        </Button>
      </>
    )
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('data-variant')).toBe(
      'default'
    )
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('data-variant')).toBe(
      'outline'
    )
    expect(screen.getByRole('link', { name: 'Go' }).getAttribute('data-variant')).toBe('default')
  })
})
