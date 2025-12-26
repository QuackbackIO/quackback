'use client'

import { useTransition, useCallback, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ActionResult, ActionError } from '@/lib/actions/types'

/**
 * Options for useActionMutation hook.
 */
export interface UseActionMutationOptions<TInput, TOutput, TContext = unknown> {
  /** The server action to call */
  action: (input: TInput) => Promise<ActionResult<TOutput>>
  /** Query keys to invalidate on success */
  invalidateKeys?: readonly (readonly unknown[])[]
  /** Optimistic update function - receives input and returns context for rollback */
  onOptimisticUpdate?: (input: TInput) => TContext
  /** Rollback function - called on error with context from optimistic update */
  onRollback?: (context: TContext) => void
  /** Called on success with data */
  onSuccess?: (data: TOutput, input: TInput) => void
  /** Called on error */
  onError?: (error: ActionError, input: TInput) => void
  /** Called when mutation settles (success or error) */
  onSettled?: () => void
}

/**
 * Return type for useActionMutation hook.
 */
export interface UseActionMutationResult<TInput, TOutput> {
  /** Trigger the mutation */
  mutate: (input: TInput) => void
  /** Trigger the mutation and return a promise */
  mutateAsync: (input: TInput) => Promise<TOutput>
  /** Whether the mutation is in progress (includes transition state) */
  isPending: boolean
  /** Whether the mutation resulted in an error */
  isError: boolean
  /** The error if the mutation failed */
  error: ActionError | null
  /** The data returned from a successful mutation */
  data: TOutput | undefined
  /** Reset the mutation state */
  reset: () => void
}

/**
 * Hook that wraps server actions with Tanstack Query mutations and useTransition.
 *
 * Features:
 * - Automatic optimistic updates with rollback on error
 * - Loading state via useTransition for smooth UI transitions
 * - Type-safe error handling with ActionError
 * - Cache invalidation on success
 * - Works seamlessly with existing Tanstack Query setup
 *
 * @example
 * const createTag = useActionMutation({
 *   action: createTagAction,
 *   invalidateKeys: [tagKeys.lists()],
 *   onSuccess: (tag) => toast.success(`Created ${tag.name}`),
 *   onError: (error) => toast.error(error.message),
 * })
 *
 * // Usage in component:
 * <button
 *   onClick={() => createTag.mutate({ name: 'Bug', color: '#ef4444' })}
 *   disabled={createTag.isPending}
 * >
 *   {createTag.isPending ? 'Creating...' : 'Create Tag'}
 * </button>
 */
export function useActionMutation<TInput, TOutput, TContext = unknown>({
  action,
  invalidateKeys,
  onOptimisticUpdate,
  onRollback,
  onSuccess,
  onError,
  onSettled,
}: UseActionMutationOptions<TInput, TOutput, TContext>): UseActionMutationResult<TInput, TOutput> {
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<ActionError | null>(null)
  const [data, setData] = useState<TOutput | undefined>(undefined)
  const [isError, setIsError] = useState(false)

  // Track pending state from both transition and mutation
  const isMutatingRef = useRef(false)

  const mutation = useMutation({
    mutationFn: async (input: TInput) => {
      isMutatingRef.current = true
      const result = await action(input)
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onMutate: async (input) => {
      // Cancel outgoing refetches to prevent overwriting optimistic update
      if (invalidateKeys) {
        await Promise.all(invalidateKeys.map((key) => queryClient.cancelQueries({ queryKey: key })))
      }

      // Perform optimistic update
      if (onOptimisticUpdate) {
        return onOptimisticUpdate(input)
      }
      return undefined as TContext
    },
    onError: (err: ActionError, input, context) => {
      isMutatingRef.current = false
      setError(err)
      setIsError(true)

      // Rollback optimistic update
      if (onRollback && context) {
        onRollback(context)
      }
      onError?.(err, input)
    },
    onSuccess: (resultData, input) => {
      isMutatingRef.current = false
      setData(resultData)
      setError(null)
      setIsError(false)
      onSuccess?.(resultData, input)
    },
    onSettled: () => {
      isMutatingRef.current = false
      // Invalidate queries to refetch fresh data
      if (invalidateKeys) {
        invalidateKeys.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: key })
        })
      }
      onSettled?.()
    },
  })

  // Wrap mutate in startTransition for smoother UI updates
  const mutate = useCallback(
    (input: TInput) => {
      setError(null)
      setIsError(false)
      startTransition(() => {
        mutation.mutate(input)
      })
    },
    [mutation]
  )

  // Async version that returns a promise
  const mutateAsync = useCallback(
    async (input: TInput): Promise<TOutput> => {
      setError(null)
      setIsError(false)

      return new Promise((resolve, reject) => {
        startTransition(() => {
          mutation.mutate(input, {
            onSuccess: (resultData) => resolve(resultData),
            onError: (err) => reject(err),
          })
        })
      })
    },
    [mutation]
  )

  const reset = useCallback(() => {
    setError(null)
    setIsError(false)
    setData(undefined)
    mutation.reset()
  }, [mutation])

  return {
    mutate,
    mutateAsync,
    // Combine transition pending with mutation pending for accurate loading state
    isPending: isPending || mutation.isPending || isMutatingRef.current,
    isError,
    error,
    data,
    reset,
  }
}

/**
 * Create an optimistic update helper for list queries.
 * Provides common operations for lists with rollback support.
 *
 * @example
 * const queryClient = useQueryClient()
 * const helper = createListOptimisticUpdate<Tag>(queryClient, tagKeys.lists())
 *
 * // In onOptimisticUpdate:
 * const previous = helper.add(optimisticTag)
 * return { previous }
 *
 * // In onRollback:
 * helper.restore(context.previous)
 */
export function createListOptimisticUpdate<T extends { id: string }>(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: readonly unknown[]
) {
  return {
    /** Add item to list */
    add: (item: T, position: 'start' | 'end' = 'end') => {
      const previous = queryClient.getQueryData<T[]>(queryKey)
      queryClient.setQueryData<T[]>(queryKey, (old) => {
        if (!old) return [item]
        return position === 'start' ? [item, ...old] : [...old, item]
      })
      return previous
    },

    /** Update item in list */
    update: (id: string, updates: Partial<T>) => {
      const previous = queryClient.getQueryData<T[]>(queryKey)
      queryClient.setQueryData<T[]>(queryKey, (old) =>
        old?.map((item) => (item.id === id ? { ...item, ...updates } : item))
      )
      return previous
    },

    /** Remove item from list */
    remove: (id: string) => {
      const previous = queryClient.getQueryData<T[]>(queryKey)
      queryClient.setQueryData<T[]>(queryKey, (old) => old?.filter((item) => item.id !== id))
      return previous
    },

    /** Restore previous state */
    restore: (previous: T[] | undefined) => {
      queryClient.setQueryData(queryKey, previous)
    },
  }
}
