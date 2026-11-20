/**
 * An address as a person reads it: "Name <address>", or the bare address when
 * there is no name. Dependency-free, so a settings page can show a From the
 * way the server words it.
 */
export function namedAddress(name: string | null | undefined, address: string): string {
  return name ? `${name} <${address}>` : address
}
