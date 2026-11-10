/**
 * The workspace's brand in an email: the button fill and the text that reads
 * on it, and the colour links and accent bars take. The app derives it from
 * the published portal design; without one, emails keep Quackback gold.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react'

export interface EmailBrand {
  /** The brand colour: the button fill and the accent bars. */
  accent: string
  /** The button text, readable on the accent. */
  accentText: string
  /** Link text, readable on the white email card. */
  link: string
  /**
   * A plate behind the header image, for a logo in light ink that would
   * vanish on the white card; absent draws it as it is.
   */
  logoPlate?: string
}

/** Quackback gold, for a workspace with no published design. */
export const DEFAULT_EMAIL_BRAND: EmailBrand = {
  accent: '#FFD43B',
  accentText: '#09090b',
  link: '#b45309',
}

const EmailBrandContext = createContext<EmailBrand>(DEFAULT_EMAIL_BRAND)

/** Absent or undefined keeps the default brand. */
export function EmailBrandProvider(props: { value: EmailBrand | undefined; children: ReactNode }) {
  return createElement(
    EmailBrandContext.Provider,
    { value: props.value ?? DEFAULT_EMAIL_BRAND },
    props.children
  )
}

export function useEmailBrand(): EmailBrand {
  return useContext(EmailBrandContext)
}
