/**
 * Avatar mutation hooks
 *
 * Upload and delete user avatar using presigned S3 URLs.
 * Follows the same pattern as workspace logo mutations.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UserId } from '@quackback/ids'
import { getAvatarUploadUrlFn } from '@/lib/server/functions/uploads'
import { saveAvatarKeyFn, removeAvatarFn } from '@/lib/server/functions/user'
import { settingsQueries } from '@/lib/client/queries/settings'

export function useUploadAvatar(userId: UserId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: Blob) => {
      // 1. Get presigned URL from server
      const { uploadUrl, key } = await getAvatarUploadUrlFn({
        data: {
          filename: (file as File).name || 'avatar.png',
          contentType: file.type || 'image/png',
          fileSize: file.size,
        },
      })

      // 2. Upload directly to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'image/png',
        },
      })

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload avatar to storage')
      }

      // 3. Save the S3 key to the database
      await saveAvatarKeyFn({ data: { key } })
    },
    onSuccess: () => {
      queryClient.refetchQueries({
        queryKey: settingsQueries.userProfile(userId).queryKey,
      })
    },
  })
}

export function useDeleteAvatar(userId: UserId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => removeAvatarFn(),
    onSuccess: () => {
      queryClient.refetchQueries({
        queryKey: settingsQueries.userProfile(userId).queryKey,
      })
    },
  })
}
