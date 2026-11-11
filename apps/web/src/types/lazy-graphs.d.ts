/** Each lazily loaded page's chunk URL, from the client build; see lib/build/lazy-graphs.ts. */
declare module 'virtual:quackback-lazy-graphs' {
  const graphs: Partial<Record<'home' | 'feed', string>>
  export default graphs
}
