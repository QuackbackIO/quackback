// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Tabs, TabsList, TabsTrigger } from '../tabs'

afterEach(cleanup)

const renderTabs = (dirty: boolean) =>
  render(
    <Tabs variant="line" defaultValue="a">
      <TabsList>
        <TabsTrigger value="a" dirty={dirty} dirtyLabel="Unsaved changes">
          Guidance
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )

describe('TabsTrigger dirty marker', () => {
  it('shows a dot and announces it when the tab has unsaved changes', () => {
    renderTabs(true)
    const tab = screen.getByRole('tab', { name: /Guidance/ })
    expect(tab.textContent).toContain('Unsaved changes')
    expect(tab.querySelector('[data-slot="tabs-trigger-dirty"]')).not.toBeNull()
  })

  it('renders nothing extra when clean', () => {
    renderTabs(false)
    const tab = screen.getByRole('tab', { name: 'Guidance' })
    expect(tab.textContent).toBe('Guidance')
    expect(tab.querySelector('[data-slot="tabs-trigger-dirty"]')).toBeNull()
  })
})
