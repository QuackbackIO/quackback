import { create } from 'zustand'

interface InboxUIState {
  isEditDialogOpen: boolean
}

interface InboxUIActions {
  openEditDialog: () => void
  closeEditDialog: () => void
  setEditDialogOpen: (open: boolean) => void
}

export type InboxUIStore = InboxUIState & InboxUIActions

export const useInboxUIStore = create<InboxUIStore>((set) => ({
  // Initial state
  isEditDialogOpen: false,

  // Actions
  openEditDialog: () => set({ isEditDialogOpen: true }),
  closeEditDialog: () => set({ isEditDialogOpen: false }),
  setEditDialogOpen: (open) => set({ isEditDialogOpen: open }),
}))
