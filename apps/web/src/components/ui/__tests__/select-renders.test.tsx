// @vitest-environment happy-dom
/**
 * A select's trigger shows the chosen label and a chevron. Rendering the form
 * around it again, with nothing about the select changed, renders neither
 * again; choosing another value still updates the label.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useState, type ComponentType } from 'react'

const partRenders = { value: 0, icon: 0 }
function counting<P extends object>(part: keyof typeof partRenders, Part: ComponentType<P>) {
  return function CountingPart(props: P) {
    partRenders[part]++
    return <Part {...props} />
  }
}
vi.mock('@base-ui/react/select', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/select')>()
  return {
    Select: {
      ...actual.Select,
      Value: counting('value', actual.Select.Value),
      Icon: counting('icon', actual.Select.Icon),
    },
  }
})

const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } =
  await import('@/components/ui/select')

afterEach(() => {
  cleanup()
  partRenders.value = 0
  partRenders.icon = 0
})

let rerenderForm: () => void = () => {}
let choose: (value: string) => void = () => {}

function Form() {
  const [value, setValue] = useState('open')
  const [, setVersion] = useState(0)
  rerenderForm = () => setVersion((v) => v + 1)
  choose = setValue
  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger aria-label="Status">
        <SelectValue placeholder="None" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="open">Open</SelectItem>
        <SelectItem value="closed">Closed</SelectItem>
      </SelectContent>
    </Select>
  )
}

describe('Select trigger renders', () => {
  it('renders the value and icon for the select, not for the form around it', async () => {
    render(<Form />)
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Open')
    const settled = { ...partRenders }
    expect(settled.value).toBeGreaterThan(0)
    expect(settled.icon).toBeGreaterThan(0)

    act(() => rerenderForm())
    act(() => rerenderForm())
    expect(partRenders).toEqual(settled)

    await act(async () => choose('closed'))
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Closed')
  })
})
