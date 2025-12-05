import { create } from 'zustand'

export interface UserProfileState {
  name: string | null
  email: string | null
  avatarUrl: string | null
  hasCustomAvatar: boolean
}

interface UserProfileActions {
  setProfile: (profile: Partial<UserProfileState>) => void
  setAvatarUrl: (url: string | null, hasCustomAvatar: boolean) => void
  setName: (name: string) => void
  clearAvatar: () => void
}

export type UserProfileStore = UserProfileState & UserProfileActions

export const useUserProfileStore = create<UserProfileStore>((set) => ({
  // Initial state - will be hydrated from server via provider
  name: null,
  email: null,
  avatarUrl: null,
  hasCustomAvatar: false,

  setProfile: (profile) =>
    set((state) => ({
      ...state,
      ...profile,
    })),

  setAvatarUrl: (url, hasCustomAvatar) =>
    set({
      avatarUrl: url,
      hasCustomAvatar,
    }),

  setName: (name) => set({ name }),

  clearAvatar: () =>
    set({
      avatarUrl: null,
      hasCustomAvatar: false,
    }),
}))
