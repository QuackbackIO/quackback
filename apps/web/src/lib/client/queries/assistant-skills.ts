import { queryOptions } from '@tanstack/react-query'
import { listSkillsFn } from '@/lib/server/functions/assistant-skills'

export const skillKeys = {
  all: () => ['assistant', 'skills'] as const,
}

export const skillQueries = {
  list: () =>
    queryOptions({
      queryKey: skillKeys.all(),
      queryFn: listSkillsFn,
      staleTime: 30 * 1000,
    }),
}
