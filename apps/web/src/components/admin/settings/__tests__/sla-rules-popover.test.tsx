// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SlaRulesPopover } from '../sla-rules-popover'

afterEach(cleanup)

describe('SlaRulesPopover', () => {
  it('keeps the rules out of the page until the link is opened', async () => {
    const user = userEvent.setup()
    render(<SlaRulesPopover />)
    expect(screen.queryByText(/A conversation carries one active SLA/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'How SLAs apply' }))
    expect(await screen.findByText(/A conversation carries one active SLA/)).toBeTruthy()
    expect(screen.getByText(/Targets are snapshotted at apply time/)).toBeTruthy()
  })
})
