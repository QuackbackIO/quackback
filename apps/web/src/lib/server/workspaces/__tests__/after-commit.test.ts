import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetAfterCommitForTests,
  noteDurableWork,
  onDurableWorkCommitted,
  runInAfterCommitFrame,
  wrapDbTransaction,
} from '../after-commit'

const nudgeWorker = vi.hoisted(() => vi.fn())
vi.mock('../wake-nudge', () => ({
  nudgeWorker: (...a: unknown[]) => nudgeWorker(...a),
}))

describe('after-commit signaling', () => {
  afterEach(() => {
    __resetAfterCommitForTests()
    nudgeWorker.mockReset()
  })

  it('delivers immediately when no transaction is open', () => {
    const seen: string[] = []
    onDurableWorkCommitted((key) => seen.push(key))
    noteDurableWork('ws_a')
    expect(seen).toEqual(['ws_a'])
    expect(nudgeWorker).toHaveBeenCalledWith('ws_a')
  })

  it('does not deliver an uncommitted note outside a frame', () => {
    const seen: string[] = []
    onDurableWorkCommitted((key) => seen.push(key))
    noteDurableWork('ws_a', { committed: false })
    expect(seen).toEqual([])
    expect(nudgeWorker).not.toHaveBeenCalled()
  })

  it('delivers only after the outer frame resolves', async () => {
    const seen: string[] = []
    onDurableWorkCommitted((key) => seen.push(key))

    await runInAfterCommitFrame(async () => {
      noteDurableWork('ws_a')
      expect(seen).toEqual([])
      expect(nudgeWorker).not.toHaveBeenCalled()
    })

    expect(seen).toEqual(['ws_a'])
    expect(nudgeWorker).toHaveBeenCalledOnce()
  })

  it('discards pending keys when the frame throws', async () => {
    const seen: string[] = []
    onDurableWorkCommitted((key) => seen.push(key))

    await expect(
      runInAfterCommitFrame(async () => {
        noteDurableWork('ws_a')
        throw new Error('rollback')
      })
    ).rejects.toThrow('rollback')

    expect(seen).toEqual([])
    expect(nudgeWorker).not.toHaveBeenCalled()
  })

  it('coalesces the same workspace to one delivery per commit', async () => {
    const seen: string[] = []
    onDurableWorkCommitted((key) => seen.push(key))

    await runInAfterCommitFrame(async () => {
      noteDurableWork('ws_a')
      noteDurableWork('ws_a')
      noteDurableWork('ws_b')
    })

    expect(seen.sort()).toEqual(['ws_a', 'ws_b'])
  })

  it('discards keys recorded in a nested frame that throws', async () => {
    const seen: string[] = []
    onDurableWorkCommitted((key) => seen.push(key))

    await runInAfterCommitFrame(async () => {
      noteDurableWork('outer')
      await expect(
        runInAfterCommitFrame(async () => {
          noteDurableWork('inner')
          throw new Error('savepoint')
        })
      ).rejects.toThrow('savepoint')
    })

    expect(seen).toEqual(['outer'])
  })

  it('keeps nested keys when the inner frame succeeds', async () => {
    const seen: string[] = []
    onDurableWorkCommitted((key) => seen.push(key))

    await runInAfterCommitFrame(async () => {
      noteDurableWork('outer')
      await runInAfterCommitFrame(async () => {
        noteDurableWork('inner')
      })
      expect(seen).toEqual([])
    })

    expect(seen.sort()).toEqual(['inner', 'outer'])
  })

  it('wrapDbTransaction flushes after the wrapped promise resolves', async () => {
    const seen: string[] = []
    onDurableWorkCommitted((key) => seen.push(key))

    const original = async (fn: () => Promise<string>) => {
      noteDurableWork('ws_tx')
      return fn()
    }
    const wrapped = wrapDbTransaction(original)
    const result = await wrapped(async () => 'ok')
    expect(result).toBe('ok')
    expect(seen).toEqual(['ws_tx'])
  })

  it('wrapDbTransaction discards on rejection', async () => {
    const seen: string[] = []
    onDurableWorkCommitted((key) => seen.push(key))

    const original = async () => {
      noteDurableWork('ws_tx')
      throw new Error('boom')
    }
    await expect(wrapDbTransaction(original)()).rejects.toThrow('boom')
    expect(seen).toEqual([])
  })

  it('a throwing sink does not prevent the nudge or other sinks', async () => {
    const seen: string[] = []
    onDurableWorkCommitted(() => {
      throw new Error('sink')
    })
    onDurableWorkCommitted((key) => seen.push(key))

    noteDurableWork('ws_a')
    expect(seen).toEqual(['ws_a'])
    expect(nudgeWorker).toHaveBeenCalledWith('ws_a')
  })
})
