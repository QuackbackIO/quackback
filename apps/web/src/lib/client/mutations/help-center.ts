/**
 * Help Center Mutations
 *
 * Mutation hooks for help center CRUD operations.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { HelpCenterCategoryId, HelpCenterArticleId } from '@quackback/ids'
import {
  createCategoryFn,
  updateCategoryFn,
  deleteCategoryFn,
  createArticleFn,
  updateArticleFn,
  publishArticleFn,
  unpublishArticleFn,
  deleteArticleFn,
} from '@/lib/server/functions/help-center'
import { helpCenterKeys } from '@/lib/client/queries/help-center'
import type {
  CreateCategoryInput,
  UpdateCategoryPayload,
  CreateArticleInput,
  UpdateArticlePayload,
} from '@/lib/shared/schemas/help-center'

// ============================================================================
// Category Mutations
// ============================================================================

export function useCreateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCategoryInput) => createCategoryFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.categories() })
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.publicCategories() })
    },
  })
}

export function useUpdateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCategoryPayload) => updateCategoryFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.categories() })
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.publicCategories() })
    },
  })
}

export function useDeleteCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: HelpCenterCategoryId) => deleteCategoryFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.categories() })
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.publicCategories() })
    },
  })
}

// ============================================================================
// Article Mutations
// ============================================================================

export function useCreateArticle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateArticleInput) => createArticleFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.articleLists() })
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.categories() })
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.public() })
    },
  })
}

export function useUpdateArticle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateArticlePayload) => updateArticleFn({ data: input }),
    onSuccess: (data) => {
      const id = data.id as HelpCenterArticleId
      queryClient.setQueryData(helpCenterKeys.articleDetail(id), data)
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.articleLists() })
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.public() })
    },
  })
}

export function usePublishArticle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: HelpCenterArticleId) => publishArticleFn({ data: { id } }),
    onSuccess: (data) => {
      queryClient.setQueryData(helpCenterKeys.articleDetail(data.id as HelpCenterArticleId), data)
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.articleLists() })
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.categories() })
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.public() })
    },
  })
}

export function useUnpublishArticle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: HelpCenterArticleId) => unpublishArticleFn({ data: { id } }),
    onSuccess: (data) => {
      queryClient.setQueryData(helpCenterKeys.articleDetail(data.id as HelpCenterArticleId), data)
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.articleLists() })
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.categories() })
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.public() })
    },
  })
}

export function useDeleteArticle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: HelpCenterArticleId) => deleteArticleFn({ data: { id } }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: helpCenterKeys.articleDetail(id) })
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.articleLists() })
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.categories() })
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.public() })
    },
  })
}
