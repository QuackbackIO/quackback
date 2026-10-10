import {
  isProductEnabled,
  PRODUCT_DEFINITIONS,
  type FeatureFlags,
  type ProductId,
} from '@/lib/shared/types/settings'

/**
 * Admin landing destination. Overview is home for every team member —
 * the Getting Started card lives on this page until essentials resolve.
 */
export function resolveAdminHomePath(_input?: {
  isAdmin?: boolean
  launchResolved?: boolean
  flags?: unknown
}): string {
  return '/admin'
}

/** Settings → Modules label for a product — Home tiles and Actions use the same names. */
export function homeModuleTitle(productId: ProductId): string {
  return PRODUCT_DEFINITIONS.find((product) => product.id === productId)!.label
}

export type HomeActionId =
  | 'new-post'
  | 'new-changelog'
  | 'new-conversation'
  | 'new-ticket'
  | 'new-article'
  | 'report-incident'

export type HomeAction = {
  id: HomeActionId
  label: string
  productId: ProductId
}

export type HomeActionGroup = {
  productId: ProductId
  label: string
  actions: HomeAction[]
}

function actionsForProduct(
  productId: ProductId,
  flags: Partial<FeatureFlags> | undefined
): HomeAction[] {
  switch (productId) {
    case 'feedback':
      return isProductEnabled(flags, 'feedback')
        ? [{ id: 'new-post', label: 'New post', productId }]
        : []
    case 'changelog':
      return isProductEnabled(flags, 'changelog')
        ? [{ id: 'new-changelog', label: 'New changelog', productId }]
        : []
    case 'support': {
      const actions: HomeAction[] = []
      if (flags?.supportInbox) {
        actions.push({ id: 'new-conversation', label: 'New conversation', productId })
      }
      if (flags?.supportTickets) {
        actions.push({ id: 'new-ticket', label: 'New ticket', productId })
      }
      return actions
    }
    case 'helpCenter':
      return isProductEnabled(flags, 'helpCenter')
        ? [{ id: 'new-article', label: 'New article', productId }]
        : []
    case 'status':
      return isProductEnabled(flags, 'status')
        ? [{ id: 'report-incident', label: 'Report incident', productId }]
        : []
  }
}

/** Create-entity Actions, grouped in Settings → Modules order, only for modules that are on. */
export function homeActionGroups(flags: Partial<FeatureFlags> | undefined): HomeActionGroup[] {
  return PRODUCT_DEFINITIONS.flatMap((product) => {
    const actions = actionsForProduct(product.id, flags)
    return actions.length === 0 ? [] : [{ productId: product.id, label: product.label, actions }]
  })
}
