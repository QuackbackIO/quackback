import { createContext, createElement, useContext, type ReactNode } from 'react'

const EmailPoweredByContext = createContext(false)

export function EmailPoweredByProvider(props: { value: boolean; children: ReactNode }) {
  return createElement(EmailPoweredByContext.Provider, { value: props.value }, props.children)
}

export function useEmailShowPoweredBy(): boolean {
  return useContext(EmailPoweredByContext)
}

const resolver = {
  current: async (): Promise<boolean> => false,
}

/** Installed by the workspace process so each send can read live cloud config. */
export function setEmailPoweredByResolver(fn: () => Promise<boolean>): void {
  resolver.current = fn
}

export async function resolveEmailPoweredBy(): Promise<boolean> {
  return resolver.current()
}
