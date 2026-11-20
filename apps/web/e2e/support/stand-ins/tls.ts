/**
 * The webhook sink's self-signed certificate, made once per checkout with
 * openssl (present on CI runners and developer machines). The app trusts it
 * through NODE_EXTRA_CA_CERTS, so certificate checks stay on.
 *
 * Generated rather than committed so no private key lives in the repo.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { WEBHOOK_SINK_HOSTNAME } from '../env'

export function ensureSinkCertificate(certPath: string, keyPath: string): void {
  if (existsSync(certPath) && existsSync(keyPath)) return
  mkdirSync(dirname(certPath), { recursive: true })
  // Write beside the final paths, then rename, so a reader never sees half a file.
  const tmpCert = `${certPath}.${process.pid}.tmp`
  const tmpKey = `${keyPath}.${process.pid}.tmp`
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      tmpKey,
      '-out',
      tmpCert,
      '-days',
      '30',
      '-subj',
      `/CN=${WEBHOOK_SINK_HOSTNAME}`,
      '-addext',
      `subjectAltName=DNS:${WEBHOOK_SINK_HOSTNAME}`,
    ],
    { stdio: 'pipe' }
  )
  renameSync(tmpKey, keyPath)
  renameSync(tmpCert, certPath)
}
