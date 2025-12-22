'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getProfileAction,
  updateProfileNameAction,
  removeAvatarAction,
  getUserRoleAction,
  getNotificationPreferencesAction,
  updateNotificationPreferencesAction,
  type UserProfile,
  type NotificationPreferences,
} from '@/lib/actions/user'
import type { ActionError } from '@/lib/actions/types'
import type { WorkspaceId } from '@quackback/ids'

// ============================================================================
// Query Key Factory
// ============================================================================

export const userKeys = {
  all: ['user'] as const,
  profile: () => [...userKeys.all, 'profile'] as const,
  role: () => [...userKeys.all, 'role'] as const,
  notificationPrefs: (workspaceId: WorkspaceId) =>
    [...userKeys.all, 'notificationPrefs', workspaceId] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseUserProfileOptions {
  enabled?: boolean
}

/**
 * Hook to get the current user's profile.
 */
export function useUserProfile({ enabled = true }: UseUserProfileOptions = {}) {
  return useQuery({
    queryKey: userKeys.profile(),
    queryFn: async (): Promise<UserProfile | null> => {
      const result = await getProfileAction()
      if (!result.success) {
        return null
      }
      return result.data
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

interface UseUserRoleOptions {
  enabled?: boolean
}

/**
 * Hook to get the current user's role in the workspace.
 */
export function useUserRole({ enabled = true }: UseUserRoleOptions = {}) {
  return useQuery({
    queryKey: userKeys.role(),
    queryFn: async (): Promise<'owner' | 'admin' | 'member' | 'user' | null> => {
      const result = await getUserRoleAction()
      if (!result.success) {
        return null
      }
      return result.data.role
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

interface UseNotificationPreferencesOptions {
  workspaceId: WorkspaceId
  enabled?: boolean
}

/**
 * Hook to get the user's notification preferences for a workspace.
 */
export function useNotificationPreferences({
  workspaceId,
  enabled = true,
}: UseNotificationPreferencesOptions) {
  return useQuery({
    queryKey: userKeys.notificationPrefs(workspaceId),
    queryFn: async (): Promise<NotificationPreferences> => {
      const result = await getNotificationPreferencesAction({})
      if (!result.success) {
        // Return default preferences on error
        return {
          emailStatusChange: true,
          emailNewComment: true,
          emailMuted: false,
        }
      }
      return result.data
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

interface UseUpdateProfileNameOptions {
  onSuccess?: (profile: UserProfile) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to update the user's display name.
 */
export function useUpdateProfileName({ onSuccess, onError }: UseUpdateProfileNameOptions = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (name: string) => {
      const result = await updateProfileNameAction({ name })
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(userKeys.profile(), data)
      onSuccess?.(data)
    },
    onError: (error: ActionError) => {
      onError?.(error)
    },
  })
}

interface UseRemoveAvatarOptions {
  onSuccess?: (profile: UserProfile) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to remove the user's custom avatar.
 */
export function useRemoveAvatar({ onSuccess, onError }: UseRemoveAvatarOptions = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const result = await removeAvatarAction()
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(userKeys.profile(), data)
      onSuccess?.(data)
    },
    onError: (error: ActionError) => {
      onError?.(error)
    },
  })
}

interface UseUpdateNotificationPreferencesOptions {
  workspaceId: WorkspaceId
  onSuccess?: (prefs: NotificationPreferences) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to update notification preferences.
 */
export function useUpdateNotificationPreferences({
  workspaceId,
  onSuccess,
  onError,
}: UseUpdateNotificationPreferencesOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (updates: {
      emailStatusChange?: boolean
      emailNewComment?: boolean
      emailMuted?: boolean
    }) => {
      const result = await updateNotificationPreferencesAction({
        ...updates,
      })
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(userKeys.notificationPrefs(workspaceId), data)
      onSuccess?.(data)
    },
    onError: (error: ActionError) => {
      onError?.(error)
    },
  })
}
