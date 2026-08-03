/**
 * Organizations + contacts query hooks.
 */
import { useQuery } from '@tanstack/react-query'
import type { OrganizationId, ContactId } from '@quackback/ids'
import { listOrganizationsFn, getOrganizationFn } from '@/lib/server/functions/organizations'
import {
  searchContactsFn,
  listContactsForOrganizationFn,
  getContactFn,
  listLinksForContactFn,
} from '@/lib/server/functions/contacts'

export const orgsKeys = {
  all: ['orgs'] as const,
  lists: () => [...orgsKeys.all, 'list'] as const,
  list: (filters: { query?: string; includeArchived?: boolean }) =>
    [...orgsKeys.lists(), filters] as const,
  detail: (id: OrganizationId) => [...orgsKeys.all, 'detail', id] as const,
}

export const contactsKeys = {
  all: ['contacts'] as const,
  search: (q: string) => [...contactsKeys.all, 'search', q] as const,
  byOrg: (id: OrganizationId) => [...contactsKeys.all, 'byOrg', id] as const,
  detail: (id: ContactId) => [...contactsKeys.all, 'detail', id] as const,
  links: (id: ContactId) => [...contactsKeys.all, 'links', id] as const,
}

export function useOrganizations(
  opts: { query?: string; includeArchived?: boolean; enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: orgsKeys.list({ query: opts.query, includeArchived: opts.includeArchived }),
    queryFn: () =>
      listOrganizationsFn({
        data: { search: opts.query, includeArchived: opts.includeArchived },
      }),
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  })
}

export function useOrganization(id: OrganizationId | null | undefined) {
  return useQuery({
    queryKey: id ? orgsKeys.detail(id) : ['orgs', 'detail', 'none'],
    queryFn: () => getOrganizationFn({ data: { organizationId: id! } }),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useContactSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: contactsKeys.search(query),
    queryFn: () => searchContactsFn({ data: { query } }),
    enabled,
    staleTime: 30_000,
  })
}

export function useContactsForOrganization(orgId: OrganizationId | null | undefined) {
  return useQuery({
    queryKey: orgId ? contactsKeys.byOrg(orgId) : ['contacts', 'byOrg', 'none'],
    queryFn: () => listContactsForOrganizationFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
    staleTime: 30_000,
  })
}

export function useContact(id: ContactId | null | undefined) {
  return useQuery({
    queryKey: id ? contactsKeys.detail(id) : ['contacts', 'detail', 'none'],
    queryFn: () => getContactFn({ data: { contactId: id! } }),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useContactLinks(id: ContactId | null | undefined) {
  return useQuery({
    queryKey: id ? contactsKeys.links(id) : ['contacts', 'links', 'none'],
    queryFn: () => listLinksForContactFn({ data: { contactId: id! } }),
    enabled: !!id,
    staleTime: 30_000,
  })
}
