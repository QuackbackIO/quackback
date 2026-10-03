// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AdminWorkspaceFrame } from '../admin-workspace-frame'

const sidebar = <aside aria-label="Workspace navigation">Navigation</aside>
const notices = <div role="status">Workspace notice</div>

describe('focused workspace frame', () => {
  it('keeps navigation and notices on Home', () => {
    render(
      <AdminWorkspaceFrame focused={false} sidebar={sidebar} notices={notices}>
        <input aria-label="Draft" defaultValue="Keep this draft" />
      </AdminWorkspaceFrame>
    )
    expect(screen.getByRole('complementary', { name: 'Workspace navigation' })).toBeVisible()
    expect(screen.getByRole('status')).toBeVisible()
  })

  it('hides surrounding chrome during chat and restores it without replacing the content', () => {
    const child = <input aria-label="Draft" defaultValue="Keep this draft" />
    const { rerender } = render(
      <AdminWorkspaceFrame focused={false} sidebar={sidebar} notices={notices}>
        {child}
      </AdminWorkspaceFrame>
    )
    const draft = screen.getByRole('textbox', { name: 'Draft' })
    rerender(
      <AdminWorkspaceFrame focused sidebar={sidebar} notices={notices}>
        {child}
      </AdminWorkspaceFrame>
    )
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft)
    rerender(
      <AdminWorkspaceFrame focused={false} sidebar={sidebar} notices={notices}>
        {child}
      </AdminWorkspaceFrame>
    )
    expect(screen.getByRole('complementary')).toBeVisible()
    expect(screen.getByRole('status')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep this draft')
  })
})
