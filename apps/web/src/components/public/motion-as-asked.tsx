import { useContext, useMemo, type ReactNode } from 'react'
import { MotionConfigContext } from 'framer-motion'

/**
 * Reduced motion as the visitor's device asks, for the motion inside: what
 * `<MotionConfig reducedMotion="user">` does, set on Motion's context. The
 * builder imports MotionConfig too, so the portal importing it as well puts
 * it in a script of its own on every portal page; the context is already in
 * the script every motion element loads.
 */
export function MotionAsAsked({ children }: { children: ReactNode }) {
  const outer = useContext(MotionConfigContext)
  const config = useMemo(() => ({ ...outer, reducedMotion: 'user' as const }), [outer])
  return <MotionConfigContext.Provider value={config}>{children}</MotionConfigContext.Provider>
}
