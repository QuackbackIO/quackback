/** Each bundled font's stylesheet and Latin files, from the client build; see lib/build/font-manifest.ts. */
declare module 'virtual:quackback-font-manifest' {
  const manifest: Record<string, { css: string; latin: Record<string, string> }>
  export default manifest
}
