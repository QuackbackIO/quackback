/**
 * The parts of an email drawn in the workspace's brand: the main button,
 * links and the accent bars. They read the brand from context at render, so
 * a template called before the send wraps it still draws in the brand.
 */
import { Button, Column, Link, Section } from '@react-email/components'
import type { CSSProperties, ReactNode } from 'react'
import { useEmailBrand } from '../brand'
import { button, utils } from './shared-styles'

export function BrandButton({
  href,
  style,
  children,
}: {
  href: string
  style?: CSSProperties
  children: ReactNode
}) {
  const brand = useEmailBrand()
  return (
    <Button
      href={href}
      style={{
        ...button.primary,
        backgroundColor: brand.accent,
        color: brand.accentText,
        ...style,
      }}
    >
      {children}
    </Button>
  )
}

export function BrandLink({
  href,
  style,
  children,
}: {
  href: string
  style?: CSSProperties
  children: ReactNode
}) {
  const brand = useEmailBrand()
  return (
    <Link href={href} style={{ ...utils.link, color: brand.link, ...style }}>
      {children}
    </Link>
  )
}

/** The thin bar beside a quoted message (a column, for Outlook). */
export function AccentBar() {
  const brand = useEmailBrand()
  return <Column style={{ width: '3px', backgroundColor: brand.accent, borderRadius: '2px' }} />
}

/** A boxed quote with the accent down its edge. */
export function AccentQuote({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  const brand = useEmailBrand()
  return <Section style={{ ...style, borderLeft: `3px solid ${brand.accent}` }}>{children}</Section>
}
