import { afterEach, describe, expect, it } from 'vitest'
import {
  __resetAfterCommitForTests,
  afterCommit,
  isInsideDbTransaction,
  noteDurableWork,
  onDurableWorkCommitted,
  runInAfterCommitFrame,
  wrapDbTransaction,
} from '../after-commit'

describe('after-commit signaling', () => {
  afterEach(() => {
    __resetAfterCommitForTests()
  })

  it('reports a transaction as open only while its callback runs', async () => {
    expect(isInsideDbTransaction()).toBe(false)
    let later!: Promise<boolean>
    await runInAfterCommitFrame(async () => {
      expect(isInsideDbTransaction()).toBe(true)
      // Work started inside the transaction that finishes after it.
      later = new Promise((resolve) => setTimeout(() => resolve(isInsideDbTransaction()), 10))
    })
    expect(isInsideDbTransaction()).toBe(false)
    expect(await later).toBe(false)
  })

  it('delivers immediately when no transaction is open', () => {
    const seen: string[] = []
    onDurableWorkCommitted((work) => seen.push(work.workspaceKey))
    noteDurableWork('ws_a')
    expect(seen).toEqual(['ws_a'])
  })

  it('does not deliver an uncommitted note outside a frame', () => {
    const seen: string[] = []
    onDurableWorkCommitted((work) => seen.push(work.workspaceKey))
    noteDurableWork('ws_a', { committed: false })
    expect(seen).toEqual([])
  })

  it('delivers only after the outer frame resolves', async () => {
    const seen: string[] = []
    onDurableWorkCommitted((work) => seen.push(work.workspaceKey))

    await runInAfterCommitFrame(async () => {
      noteDurableWork('ws_a')
      expect(seen).toEqual([])
    })

    expect(seen).toEqual(['ws_a'])
  })

  it('discards pending keys when the frame throws', async () => {
    const seen: string[] = []
    onDurableWorkCommitted((work) => seen.push(work.workspaceKey))

    await expect(
      runInAfterCommitFrame(async () => {
        noteDurableWork('ws_a')
        throw new Error('rollback')
      })
    ).rejects.toThrow('rollback')

    expect(seen).toEqual([])
  })

  it('coalesces the same workspace to one delivery per commit', async () => {
    const seen: string[] = []
    onDurableWorkCommitted((work) => seen.push(work.workspaceKey))

    await runInAfterCommitFrame(async () => {
      noteDurableWork('ws_a')
      noteDurableWork('ws_a')
      noteDurableWork('ws_b')
    })

    expect(seen.sort()).toEqual(['ws_a', 'ws_b'])
  })

  it('discards keys recorded in a nested frame that throws', async () => {
    const seen: string[] = []
    onDurableWorkCommitted((work) => seen.push(work.workspaceKey))

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
    onDurableWorkCommitted((work) => seen.push(work.workspaceKey))

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
    onDurableWorkCommitted((work) => seen.push(work.workspaceKey))

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
    onDurableWorkCommitted((work) => seen.push(work.workspaceKey))

    const original = async () => {
      noteDurableWork('ws_tx')
      throw new Error('boom')
    }
    await expect(wrapDbTransaction(original)()).rejects.toThrow('boom')
    expect(seen).toEqual([])
  })

  it('a throwing sink does not prevent other sinks', async () => {
    const seen: string[] = []
    onDurableWorkCommitted(() => {
      throw new Error('sink')
    })
    onDurableWorkCommitted((work) => seen.push(work.workspaceKey))

    noteDurableWork('ws_a')
    expect(seen).toEqual(['ws_a'])
  })

  it('coalesces job ids per workspace on the same commit', async () => {
    const seen: Array<{ workspaceKey: string; jobIds: string[] }> = []
    onDurableWorkCommitted((work) => seen.push(work))

    await runInAfterCommitFrame(async () => {
      noteDurableWork('ws_a', { jobId: 'job_1' })
      noteDurableWork('ws_a', { jobId: 'job_2' })
      noteDurableWork('ws_a', { jobId: 'job_1' })
    })

    expect(seen).toEqual([{ workspaceKey: 'ws_a', jobIds: ['job_1', 'job_2'] }])
  })

  describe('afterCommit', () => {
    it('runs at once outside a transaction', async () => {
      const ran: string[] = []
      await afterCommit(() => {
        ran.push('now')
      })
      expect(ran).toEqual(['now'])
    })

    it('waits for the outer commit, even from a nested frame', async () => {
      const ran: string[] = []
      await runInAfterCommitFrame(async () => {
        await runInAfterCommitFrame(async () => {
          await afterCommit(() => {
            ran.push('inner')
          })
        })
        expect(ran).toEqual([])
      })
      expect(ran).toEqual(['inner'])
    })

    it('drops the callback when the transaction rolls back', async () => {
      const ran: string[] = []
      await expect(
        runInAfterCommitFrame(async () => {
          await afterCommit(() => {
            ran.push('x')
          })
          throw new Error('rollback')
        })
      ).rejects.toThrow('rollback')
      await runInAfterCommitFrame(async () => {
        await expect(
          runInAfterCommitFrame(async () => {
            await afterCommit(() => {
              ran.push('nested')
            })
            throw new Error('savepoint')
          })
        ).rejects.toThrow('savepoint')
      })
      expect(ran).toEqual([])
    })

    it('a failing callback does not fail the commit', async () => {
      await expect(
        runInAfterCommitFrame(async () => {
          await afterCommit(() => {
            throw new Error('boom')
          })
          return 'ok'
        })
      ).resolves.toBe('ok')
    })
  })
})
