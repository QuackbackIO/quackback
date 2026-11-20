// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { SettingRow, SettingRows } from '../setting-row'

afterEach(cleanup)

function Harness({ onChange }: { onChange: (v: boolean) => void }) {
  const [on, setOn] = useState(false)
  return (
    <SettingRow
      label="Allow comments"
      description="Visitors can comment on posts."
      htmlFor="comments"
      control={
        <Switch
          id="comments"
          checked={on}
          onCheckedChange={(v) => {
            setOn(v)
            onChange(v)
          }}
        />
      }
    />
  )
}

describe('SettingRow', () => {
  it('toggles the bound switch when the label is clicked', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByText('Allow comments'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('renders the description and badge', () => {
    render(
      <SettingRow
        label="Label"
        description="One line of help"
        badge={<span>Beta</span>}
        control={<button type="button">Go</button>}
      />
    )
    expect(screen.getByText('One line of help')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('puts the control in the right slot', () => {
    render(<SettingRow label="Label" control={<button type="button">Go</button>} />)
    const slot = screen
      .getByRole('button', { name: 'Go' })
      .closest('[data-slot="setting-row-control"]')
    expect(slot).toBeTruthy()
    expect(slot?.previousElementSibling?.textContent).toContain('Label')
  })

  it('dims a disabled row', () => {
    render(<SettingRow label="Label" disabled control={<span>c</span>} />)
    expect(document.querySelector('[data-slot="setting-row"]')?.getAttribute('data-disabled')).toBe(
      'true'
    )
  })

  it('sits label and control side by side unless asked to stack', () => {
    render(<SettingRow label="Label" control={<span>c</span>} />)
    const classes = document.querySelector('[data-slot="setting-row"]')!.className.split(' ')
    expect(classes).toContain('items-center')
    expect(classes).not.toContain('flex-col')
  })

  it('stacks the label over a wide control on a phone when asked, side by side from sm up', () => {
    render(<SettingRow label="Label" stackOnPhone control={<span>c</span>} />)
    const classes = document.querySelector('[data-slot="setting-row"]')!.className.split(' ')
    expect(classes).toContain('flex-col')
    expect(classes).toContain('sm:flex-row')
    expect(classes).toContain('sm:items-center')
    // Stacked, the control takes the row's width rather than being centred.
    expect(classes).not.toContain('items-center')
  })

  it('SettingRows stacks rows with dividers', () => {
    render(
      <SettingRows>
        <SettingRow label="A" control={<span />} />
        <SettingRow label="B" control={<span />} />
      </SettingRows>
    )
    const wrap = document.querySelector('[data-slot="setting-rows"]')
    expect(wrap?.className).toContain('divide-y')
    expect(wrap?.children.length).toBe(2)
  })
})
