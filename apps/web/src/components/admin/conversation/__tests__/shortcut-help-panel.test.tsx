// @vitest-environment happy-dom
/**
 * <ShortcutHelpPanel> gating: the cheatsheet only lists Copilot bindings (the
 * `q` action row and the panel-scoped Copilot section) when the Copilot tab
 * actually exists for this viewer/viewport (`copilotAvailable`) — it must
 * never advertise a key that does nothing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// The real copilot-panel module drags in the whole Copilot dependency graph
// (SSE hooks, server fns); the help panel only reads its shortcut table.
vi.mock('../copilot-panel', () => ({
  COPILOT_PANEL_SHORTCUTS: [{ keys: '⌘↵', label: 'Insert last Copilot answer' }],
}))

import { ShortcutHelpPanel } from '../shortcut-help-panel'

afterEach(cleanup)

describe('<ShortcutHelpPanel>', () => {
  it('lists the Copilot section and the Ask Copilot row when copilotAvailable', () => {
    render(<ShortcutHelpPanel open onOpenChange={() => {}} copilotAvailable />)

    expect(screen.getByText('Ask Copilot')).toBeInTheDocument()
    expect(screen.getByText('Copilot')).toBeInTheDocument()
    expect(screen.getByText('Insert last Copilot answer')).toBeInTheDocument()
    // The non-Copilot rows are always there.
    expect(screen.getByText('Open command bar')).toBeInTheDocument()
  })

  it('hides the Copilot section AND the Ask Copilot action row when unavailable', () => {
    render(<ShortcutHelpPanel open onOpenChange={() => {}} copilotAvailable={false} />)

    expect(screen.queryByText('Ask Copilot')).not.toBeInTheDocument()
    expect(screen.queryByText('Copilot')).not.toBeInTheDocument()
    expect(screen.queryByText('Insert last Copilot answer')).not.toBeInTheDocument()
    // Everything else still renders.
    expect(screen.getByText('Open command bar')).toBeInTheDocument()
    expect(screen.getAllByText('Reply').length).toBeGreaterThan(0)
  })
})
