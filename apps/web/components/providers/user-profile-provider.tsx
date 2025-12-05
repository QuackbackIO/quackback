'use client'

import { useRef, useLayoutEffect } from 'react'
import { useUserProfileStore } from '@/lib/stores/user-profile'

interface UserProfileProviderProps {
  children: React.ReactNode
  initialData: {
    name: string | null
    email: string | null
    avatarUrl: string | null
    hasCustomAvatar: boolean
  }
}

/**
 * Hydrates the user profile store with server-side data.
 * Place this in a layout that has access to user session data.
 *
 * Uses useLayoutEffect for synchronous hydration before paint.
 * Headers receive initialUserData props for SSR, then read from store after hydration.
 */
export function UserProfileProvider({ children, initialData }: UserProfileProviderProps) {
  const hasHydrated = useRef(false)

  // useLayoutEffect runs synchronously after DOM mutations, before paint
  // This hydrates the store before users see the UI
  useLayoutEffect(() => {
    if (!hasHydrated.current) {
      useUserProfileStore.setState(initialData)
      hasHydrated.current = true
    }
  }, [initialData])

  return <>{children}</>
}
