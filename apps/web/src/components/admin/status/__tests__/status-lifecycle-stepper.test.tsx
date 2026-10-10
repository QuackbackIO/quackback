// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { StatusLifecycleStepper } from '../status-lifecycle-stepper'

afterEach(cleanup)

describe('StatusLifecycleStepper', () => {
  it('marks an earlier stage on a resolved incident as a reopen', () => {
    render(
      <StatusLifecycleStepper
        kind="incident"
        current="resolved"
        target="monitoring"
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('reopens here')).toBeInTheDocument()
  })

  it('keeps the usual hint when moving an open incident forward', () => {
    render(
      <StatusLifecycleStepper
        kind="incident"
        current="identified"
        target="monitoring"
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('next update posts here')).toBeInTheDocument()
    expect(screen.queryByText('reopens here')).toBeNull()
  })
})
