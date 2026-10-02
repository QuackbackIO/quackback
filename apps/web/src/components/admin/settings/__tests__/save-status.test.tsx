// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AUTOSAVE } from '@/lib/client/autosave'
import { SaveStatus } from '../save-status'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function setup() {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <SaveStatus />
    </QueryClientProvider>
  )
  return client
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function run(client: QueryClient, meta: Record<string, unknown> | undefined, d = deferred()) {
  const mutation = client.getMutationCache().build(client, { meta, mutationFn: () => d.promise })
  const done = mutation.execute(undefined).catch(() => {})
  return { ...d, done }
}

describe('SaveStatus', () => {
  it('shows nothing while idle', () => {
    setup()
    expect(screen.queryByText('Saving…')).toBeNull()
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('shows Saving… while an autosave mutation is pending, then Saved for about 2 seconds', async () => {
    const client = setup()
    let save!: ReturnType<typeof run>
    await act(async () => {
      save = run(client, AUTOSAVE)
    })
    expect(screen.getByText('Saving…')).toBeInTheDocument()
    expect(screen.queryByText('Saved')).toBeNull()

    await act(async () => {
      save.resolve()
      await save.done
    })
    expect(screen.queryByText('Saving…')).toBeNull()
    expect(screen.getByText('Saved')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(2100)
    })
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('keeps showing Saving… until the last of several saves settles', async () => {
    const client = setup()
    let first!: ReturnType<typeof run>
    let second!: ReturnType<typeof run>
    await act(async () => {
      first = run(client, AUTOSAVE)
      second = run(client, AUTOSAVE)
    })
    await act(async () => {
      first.resolve()
      await first.done
    })
    expect(screen.getByText('Saving…')).toBeInTheDocument()
    await act(async () => {
      second.resolve()
      await second.done
    })
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('never shows an error, and clears when the save fails', async () => {
    const client = setup()
    let save!: ReturnType<typeof run>
    await act(async () => {
      save = run(client, AUTOSAVE)
    })
    await act(async () => {
      save.reject(new Error('nope'))
      await save.done
    })
    expect(screen.queryByText('Saving…')).toBeNull()
    expect(screen.queryByText('Saved')).toBeNull()
    expect(screen.queryByText(/nope|error/i)).toBeNull()
  })

  it('ignores mutations that are not autosaves', async () => {
    const client = setup()
    let plain!: ReturnType<typeof run>
    await act(async () => {
      plain = run(client, undefined)
    })
    expect(screen.queryByText('Saving…')).toBeNull()
    await act(async () => {
      plain.resolve()
      await plain.done
    })
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('announces politely', async () => {
    const client = setup()
    await act(async () => {
      run(client, AUTOSAVE)
    })
    expect(screen.getByText('Saving…').closest('[aria-live]')?.getAttribute('aria-live')).toBe(
      'polite'
    )
  })
})
