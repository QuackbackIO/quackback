import { useRouteContext } from '@tanstack/react-router'
import { isProductEnabled, type FeatureFlags, type ProductId } from '@/lib/shared/types/settings'
import type { VisualTheme } from '@/lib/shared/labs'

/**
 * Named reads of the route context. Every navigation hands the tree a new
 * context object, while the parts inside it stay the same objects until the
 * viewer, their role or the workspace changes (route-context-memo.ts). Each
 * hook selects one part, or the answer derived from it, so its caller renders
 * again only when that changed, never because the context object around it did.
 */

export function useWorkspaceSettings() {
  return useRouteContext({ from: '__root__', select: (context) => context.settings })
}

export function useSessionContext() {
  return useRouteContext({ from: '__root__', select: (context) => context.session })
}

export function useUserRole() {
  return useRouteContext({ from: '__root__', select: (context) => context.userRole })
}

export function useBaseUrl() {
  return useRouteContext({ from: '__root__', select: (context) => context.baseUrl })
}

/** Whether this deployment sells plans: false on every self-hosted install. */
export function useBillingEnabled(): boolean {
  return useRouteContext({ from: '__root__', select: (context) => !!context.billingEnabled })
}

export function useCloudEnabled(): boolean {
  return useRouteContext({ from: '__root__', select: (context) => !!context.cloudEnabled })
}

export function useManagedFieldPaths() {
  return useRouteContext({ from: '__root__', select: (context) => context.managedFieldPaths })
}

export function useFeatureFlags() {
  return useRouteContext({
    from: '__root__',
    select: (context) => context.settings?.featureFlags,
  })
}

export function useFeatureFlag(flag: keyof FeatureFlags): boolean {
  return useRouteContext({
    from: '__root__',
    select: (context) => context.settings?.featureFlags?.[flag] ?? false,
  })
}

export function useProductEnabled(product: ProductId): boolean {
  return useRouteContext({
    from: '__root__',
    select: (context) => isProductEnabled(context.settings?.featureFlags, product),
  })
}

/** The Labs appearance in effect: the viewer's own choice, else the workspace's. */
export function useVisualTheme(): VisualTheme {
  return useRouteContext({
    from: '__root__',
    select: (context) =>
      context.visualTheme === 'refined' || context.settings?.visualTheme === 'refined'
        ? 'refined'
        : 'legacy',
  })
}

export function useRefinedTheme(): boolean {
  return useVisualTheme() === 'refined'
}

/** The signed-in team member's principal id, inside the admin shell. */
export function usePrincipalId(): string | undefined {
  return useRouteContext({
    from: '/admin',
    select: (context) => (context as { principal?: { id?: string } | null }).principal?.id,
  })
}
