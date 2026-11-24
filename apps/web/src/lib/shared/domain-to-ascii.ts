/**
 * The A-label (punycode) spelling of a domain, or '' when it is not one.
 *
 * Same answers as Node's `url.domainToASCII`, built on the WHATWG `URL` parser
 * so it runs in the browser too. Server modules that spell domains (config,
 * SSO domain checks) are reachable from client chunks, and a browser refuses
 * to load a chunk that imports `node:url`.
 *
 * `URL` accepts some shapes `domainToASCII` refuses, so those are refused here
 * first: a value carrying userinfo or a port, and one starting with a path
 * separator. A control character or space anywhere is refused too. `URL`
 * strips them silently (`acme.com\u0000` parses as `acme.com`), which would
 * let a malformed address match a verified domain; Node keeps some of them,
 * so here the answer is '' where Node's may not be. The test pins every other
 * answer to Node's.
 */
export function domainToASCII(domain: string): string {
  if (hasControlOrSpace(domain)) return ''
  if (/^[/\\]/.test(domain)) return ''
  if (/[@:]/.test(domain) && !/^\[[^\]]*\]$/.test(domain)) return ''
  try {
    return new URL(`http://${domain}`).hostname
  } catch {
    return ''
  }
}

/** A C0 control character, a space or DEL anywhere in the value. */
function hasControlOrSpace(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f) return true
  }
  return false
}
