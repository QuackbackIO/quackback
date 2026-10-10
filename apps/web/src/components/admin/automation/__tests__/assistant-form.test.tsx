// @vitest-environment happy-dom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  AssistantDirtyStateProvider,
  useAssistantAutosave,
  type AssistantSettingsTab,
  useAssistantDirtyState,
  useUnsavedChanges,
} from '../assistant-form'

afterEach(cleanup)

function DirtyForm({ label, tab }: { label: string; tab: AssistantSettingsTab }) {
  const [dirty, setDirty] = useState(false)
  useUnsavedChanges(dirty, tab)
  return <button onClick={() => setDirty((current) => !current)}>{label}</button>
}

function DirtySummary() {
  const { dirtyTabs, hasUnsavedChanges } = useAssistantDirtyState()
  return (
    <output>
      {hasUnsavedChanges ? 'Unsaved' : 'Clean'}: {Array.from(dirtyTabs).join(',')}
    </output>
  )
}

it('tracks multiple dirty forms without clearing a tab prematurely', () => {
  render(
    <AssistantDirtyStateProvider>
      <DirtyForm label="Identity form" tab="basics" />
      <DirtyForm label="Voice form" tab="basics" />
      <DirtySummary />
    </AssistantDirtyStateProvider>
  )

  expect(screen.getByText('Clean:')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Identity form' }))
  fireEvent.click(screen.getByRole('button', { name: 'Voice form' }))
  expect(screen.getByText('Unsaved: basics')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Identity form' }))
  expect(screen.getByText('Unsaved: basics')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Voice form' }))
  expect(screen.getByText('Clean:')).toBeInTheDocument()
})

describe('useAssistantAutosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function Harness({
    save,
    initial = 'a',
    valid = true,
    delayMs = 500,
    label = 'field',
  }: {
    save: (value: string) => Promise<void>
    initial?: string
    valid?: boolean
    delayMs?: number
    label?: string
  }) {
    const [value, setValue] = useState(initial)
    const [saved, setSaved] = useState(initial)
    const { conflict, clearConflict, touch } = useAssistantAutosave({
      dirty: value !== saved,
      valid,
      signature: value,
      delayMs,
      save: async () => {
        const sent = value
        await save(sent)
        setSaved(sent)
      },
    })
    return (
      <div>
        <input aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} />
        <output>{conflict ? 'conflict' : 'ok'}</output>
        <button onClick={clearConflict}>clear {label}</button>
        <button onClick={touch}>touch {label}</button>
      </div>
    )
  }

  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  const flush = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

  it('saves once after the delay, not before', async () => {
    const save = vi.fn(async () => {})
    render(<Harness save={save} />)
    type('field', 'ab')
    await flush(499)
    expect(save).not.toHaveBeenCalled()
    type('field', 'abc')
    await flush(499)
    expect(save).not.toHaveBeenCalled()
    await flush(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('abc')
    await flush(5000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('saves immediately when the delay is zero', async () => {
    const save = vi.fn(async () => {})
    render(<Harness save={save} delayMs={0} />)
    type('field', 'b')
    await flush(0)
    expect(save).toHaveBeenCalledWith('b')
  })

  it('does not save an invalid draft', async () => {
    const save = vi.fn(async () => {})
    render(<Harness save={save} valid={false} />)
    type('field', 'b')
    await flush(5000)
    expect(save).not.toHaveBeenCalled()
  })

  it('does not retry a failed save until the draft changes again', async () => {
    const save = vi.fn(async () => {
      throw new Error('boom')
    })
    render(<Harness save={save} />)
    type('field', 'b')
    await flush(5000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('ok')
    type('field', 'bc')
    await flush(500)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('stops saving on a revision conflict until it is cleared', async () => {
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(
        Object.assign(new Error('changed in another session'), { statusCode: 409 })
      )
      .mockResolvedValue(undefined)
    render(<Harness save={save} />)
    type('field', 'b')
    await flush(500)
    expect(screen.getByRole('status')).toHaveTextContent('conflict')
    type('field', 'bc')
    await flush(5000)
    expect(save).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('clear field'))
    await flush(500)
    expect(screen.getByRole('status')).toHaveTextContent('ok')
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('saves again when the draft changed while a save was in flight', async () => {
    let release = () => {}
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
      .mockResolvedValue(undefined)
    render(<Harness save={save} delayMs={0} />)
    type('field', 'b')
    await flush(0)
    expect(save).toHaveBeenCalledTimes(1)
    type('field', 'bc')
    await flush(1000)
    expect(save).toHaveBeenCalledTimes(1)
    release()
    await flush(10)
    await flush(10)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith('bc')
  })

  it('flushes a pending draft when the page is left', async () => {
    const save = vi.fn(async () => {})
    const view = render(<Harness save={save} />)
    type('field', 'b')
    await flush(100)
    expect(save).not.toHaveBeenCalled()
    view.unmount()
    await flush(0)
    expect(save).toHaveBeenCalledWith('b')
  })

  it('runs saves from different fields one at a time', async () => {
    const order: string[] = []
    let release = () => {}
    const slow = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push('slow:start')
          release = () => {
            order.push('slow:end')
            resolve()
          }
        })
    )
    const fast = vi.fn(async () => {
      order.push('fast:start')
    })
    render(
      <>
        <Harness save={slow} label="one" delayMs={0} />
        <Harness save={fast} label="two" delayMs={0} />
      </>
    )
    type('one', 'b')
    await flush(0)
    type('two', 'b')
    await flush(100)
    expect(order).toEqual(['slow:start'])
    release()
    await flush(0)
    expect(order).toEqual(['slow:start', 'slow:end', 'fast:start'])
  })

  it('sends the same values again after a failure once the user acts on the field again', async () => {
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined)
    render(<Harness save={save} />)
    type('field', 'b')
    await flush(500)
    expect(save).toHaveBeenCalledTimes(1)
    await flush(5000)
    expect(save).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('touch field'))
    await flush(500)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith('b')
  })

  it('does nothing when touched with nothing failed or changed', async () => {
    const save = vi.fn(async () => {})
    render(<Harness save={save} />)
    fireEvent.click(screen.getByText('touch field'))
    await flush(5000)
    expect(save).not.toHaveBeenCalled()
  })

  it('flushes an edit typed while a save was in flight when the page is left', async () => {
    let release = () => {}
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
      .mockResolvedValue(undefined)
    const view = render(<Harness save={save} delayMs={0} />)
    type('field', 'b')
    await flush(0)
    expect(save).toHaveBeenCalledTimes(1)
    type('field', 'bc')
    view.unmount()
    release()
    await flush(10)
    await flush(10)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith('bc')
  })

  it('does not save the in-flight value a second time when the page is left', async () => {
    let release = () => {}
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
      .mockResolvedValue(undefined)
    const view = render(<Harness save={save} delayMs={0} />)
    type('field', 'b')
    await flush(0)
    view.unmount()
    release()
    await flush(10)
    await flush(10)
    expect(save).toHaveBeenCalledTimes(1)
  })
})
