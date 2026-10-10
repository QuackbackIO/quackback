/**
 * The Roles card's unsaved draft, shared with the Profile card's preview rail
 * so the rail's Role line answers for the rules on screen, not only the saved
 * ones. Scoped to one provider page; null whenever the Roles card is clean.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import type { Role } from '@/lib/shared/roles'
import type { RoleMapping } from './provider-shared'

export type RolesDraftShare = {
  /** The role section Save would write; undefined when it would remove it. */
  role: RoleMapping | undefined
  defaultRole: Role
}

type Shared = { value: RolesDraftShare | null; set: (value: RolesDraftShare | null) => void }

const RolesDraftContext = createContext<Shared | null>(null)

export function RolesDraftProvider({ children }: { children: React.ReactNode }) {
  const [value, set] = useState<RolesDraftShare | null>(null)
  return <RolesDraftContext.Provider value={{ value, set }}>{children}</RolesDraftContext.Provider>
}

/** The Roles card's unsaved draft, or null when it has none (or no provider page). */
export function useRolesDraft(): RolesDraftShare | null {
  return useContext(RolesDraftContext)?.value ?? null
}

/** Publishes the Roles card's draft while it has edits; clears it otherwise. */
export function usePublishRolesDraft(value: RolesDraftShare | null) {
  const set = useContext(RolesDraftContext)?.set
  const key = value ? JSON.stringify(value) : null
  useEffect(() => {
    if (!set) return
    set(key ? (JSON.parse(key) as RolesDraftShare) : null)
  }, [set, key])
  useEffect(() => () => set?.(null), [set])
}
