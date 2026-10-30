import { escapeInlineStyle } from '@/lib/shared/safe-inline-content'

interface PortalDesignStyleProps {
  /** The workspace theme as CSS. */
  themeStyles: string
  /** The workspace's own CSS. It comes after the theme so it can override it. */
  customCss: string
}

/** A workspace's theme and custom CSS, for every page that carries its brand. */
export function PortalDesignStyle({ themeStyles, customCss }: PortalDesignStyleProps) {
  return (
    <>
      {themeStyles && (
        <style dangerouslySetInnerHTML={{ __html: escapeInlineStyle(themeStyles) }} />
      )}
      {customCss && <style dangerouslySetInnerHTML={{ __html: escapeInlineStyle(customCss) }} />}
    </>
  )
}
