/**
 * The A-label (punycode) spelling of a domain, or '' when it is not one.
 *
 * Same answers as Node's `url.domainToASCII`, built on the WHATWG `URL` parser
 * so it runs in the browser too. Server modules that spell domains (config,
 * SSO domain checks) are reachable from client chunks, and a `node:url` import
 * there makes the browser refuse to load the whole chunk.
 *
 * `URL` parses some shapes `domainToASCII` refuses, so those are refused here
 * first: a value carrying userinfo or a port, one starting with a path
 * separator, and one ending in whitespace. The test pins this to Node's answers.
 */
export function domainToASCII(domain: string): string {
  if (/^[/\\]/.test(domain) || /\s$/.test(domain)) return ''
  if (/[@:]/.test(domain) && !/^\[[^\]]*\]$/.test(domain)) return ''
  try {
    return new URL(`http://${domain}`).hostname
  } catch {
    return ''
  }
}
