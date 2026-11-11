// @vitest-environment happy-dom
/** A portal page in waiting keeps the footer below the screen, so it does not jump when the page arrives. */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { RoutePendingComponent } from '../route-pending'

describe('RoutePendingComponent', () => {
  it('holds a screen inside the portal, and stays small in the admin', () => {
    const { container } = render(<RoutePendingComponent />)
    const classes = (container.firstElementChild as HTMLElement).className.split(' ')
    expect(classes).toContain(
      '[[data-portal]_&]:min-h-[calc(100svh-var(--portal-header-height,0px))]'
    )
    expect(classes).toContain('min-h-32')
  })
})
