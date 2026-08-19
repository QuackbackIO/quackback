import { queryOptions } from '@tanstack/react-query'
import { listMacrosFn } from '@/lib/server/functions/macros'

/** Query keys for macro lists (manager = all scopes; composer = one surface). */
export const macroKeys = {
  all: () => ['macros'] as const,
  list: (surface?: 'support' | 'feedback') => ['macros', surface ?? 'all'] as const,
}

/** Macros for a surface (composer) or every scope (admin manager). */
export const macrosQuery = (surface?: 'support' | 'feedback') =>
  queryOptions({
    queryKey: macroKeys.list(surface),
    queryFn: () => listMacrosFn({ data: surface ? { surface } : undefined }),
    staleTime: 60 * 1000,
  })
