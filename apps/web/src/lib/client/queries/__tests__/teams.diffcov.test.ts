import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamId } from '@quackback/ids'

const mocks = vi.hoisted(() => ({
  listTeamsFn: vi.fn(),
  getTeamFn: vi.fn(),
  listTeamMembersFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/teams', () => ({
  listTeamsFn: (input: unknown) => mocks.listTeamsFn(input),
  getTeamFn: (input: unknown) => mocks.getTeamFn(input),
  listTeamMembersFn: (input: unknown) => mocks.listTeamMembersFn(input),
}))

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
}))

import { teamQueries } from '../teams'

const teamId = 'team_1' as TeamId

beforeEach(() => {
  vi.clearAllMocks()
})

describe('teamQueries.all', () => {
  it('exposes the root key', () => {
    expect(teamQueries.all).toEqual(['teams'])
  })
})

describe('teamQueries.list', () => {
  it('defaults to empty filters and forwards an undefined includeArchived', async () => {
    const options = teamQueries.list()
    expect(options.queryKey).toEqual(['teams', 'list', {}])
    expect(options.staleTime).toBe(30_000)

    mocks.listTeamsFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listTeamsFn).toHaveBeenCalledWith({ data: { includeArchived: undefined } })
  })

  it('forwards includeArchived when provided', async () => {
    const options = teamQueries.list({ includeArchived: true })
    expect(options.queryKey).toEqual(['teams', 'list', { includeArchived: true }])

    mocks.listTeamsFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listTeamsFn).toHaveBeenCalledWith({ data: { includeArchived: true } })
  })
})

describe('teamQueries.detail', () => {
  it('builds the detail query and calls getTeamFn', async () => {
    const options = teamQueries.detail(teamId)
    expect(options.queryKey).toEqual(['teams', 'detail', teamId])

    mocks.getTeamFn.mockResolvedValueOnce({ id: teamId })
    await options.queryFn!({} as never)

    expect(mocks.getTeamFn).toHaveBeenCalledWith({ data: { teamId } })
  })
})

describe('teamQueries.members', () => {
  it('builds the members query and calls listTeamMembersFn', async () => {
    const options = teamQueries.members(teamId)
    expect(options.queryKey).toEqual(['teams', 'members', teamId])

    mocks.listTeamMembersFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listTeamMembersFn).toHaveBeenCalledWith({ data: { teamId } })
  })
})
