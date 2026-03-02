import { useMutation, useQueryClient } from '@tanstack/react-query'
import { acceptSuggestionFn, dismissSuggestionFn } from '@/lib/server/functions/feedback'

interface UseSuggestionActionsOptions {
  suggestionId: string
  isMerge: boolean
  onResolved?: () => void
}

export function useSuggestionActions({
  suggestionId,
  isMerge,
  onResolved,
}: UseSuggestionActionsOptions) {
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['feedback', 'suggestions'] })
    queryClient.invalidateQueries({ queryKey: ['feedback', 'suggestionStats'] })
  }

  const acceptMutation = useMutation({
    mutationFn: (opts?: { title: string; body: string } | { swapDirection: boolean }) =>
      acceptSuggestionFn({
        data: {
          id: suggestionId,
          ...(!isMerge && opts && 'title' in opts && { edits: opts }),
          ...(isMerge && opts && 'swapDirection' in opts && { swapDirection: opts.swapDirection }),
        },
      }),
    onSuccess: () => {
      invalidate()
      onResolved?.()
    },
  })

  const dismissMutation = useMutation({
    mutationFn: () => dismissSuggestionFn({ data: { id: suggestionId } }),
    onSuccess: () => {
      invalidate()
      onResolved?.()
    },
  })

  return {
    accept: acceptMutation.mutate,
    dismiss: () => dismissMutation.mutate(),
    isPending: acceptMutation.isPending || dismissMutation.isPending,
  }
}
