import { EventEmitter } from 'node:events'

export const BRANDING_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64'
)
export interface BrandingTransportState {
  live: boolean
  lookups: string[]
  requests: RequestOptions[]
  objects: Map<string, { bytes: Buffer; mime: string }>
  created: Set<string>
}
interface RequestOptions {
  hostname: string
  family: number
  servername?: string
  method: string
  path: string
  headers: Record<string, string>
  timeout: number
  signal: AbortSignal
}
export function brandingDns(host: string, options: { all?: boolean }) {
  if (options.all !== true) throw new Error('Expected every DNS address')
  if (/^\d+(?:\.\d+){3}$/.test(host)) return [{ address: host, family: 4 }]
  if (host === 'example.com') return [{ address: '93.184.216.34', family: 4 }]
  if (host === 'assets.example.com') return [{ address: '93.184.216.35', family: 4 }]
  throw new Error('Unconfigured DNS fixture: ' + host)
}
export function brandingRequest(
  state: BrandingTransportState,
  options: RequestOptions,
  callback: (response: unknown) => void
) {
  const host = options.headers.host
  const expected = host === 'example.com' ? '93.184.216.34' : '93.184.216.35'
  if (
    !['example.com', 'assets.example.com'].includes(host) ||
    options.hostname !== expected ||
    options.family !== 4 ||
    options.servername !== host ||
    options.method !== 'GET' ||
    options.timeout <= 0 ||
    options.timeout > 10000 ||
    !(options.signal instanceof AbortSignal)
  )
    throw new Error('Unexpected pinned transport')
  const route = host + options.path
  const headers =
    route === 'example.com/'
      ? { 'content-type': 'text/html' }
      : route === 'example.com/touch.png'
        ? { location: 'https://assets.example.com/logo.png' }
        : { 'content-type': 'image/png' }
  const body =
    route === 'example.com/'
      ? Buffer.from(
          '<head><link rel="apple-touch-icon" href="/touch.png"><meta name="theme-color" content="#0F766E"></head>'
        )
      : BRANDING_PNG
  if (!['example.com/', 'example.com/touch.png', 'assets.example.com/logo.png'].includes(route))
    throw new Error('Unexpected fixture path: ' + route)
  const req = new EventEmitter() as EventEmitter & {
    write: () => void
    end: () => void
    destroy: (error?: Error) => void
  }
  req.write = () => {
    throw new Error('Unexpected request body')
  }
  req.destroy = (error) => {
    if (error) req.emit('error', error)
  }
  req.end = () => {
    let destroyed = false
    const res = new EventEmitter() as EventEmitter & {
      headers: typeof headers
      statusCode: number
      destroy: () => void
    }
    res.headers = headers
    res.statusCode = route === 'example.com/touch.png' ? 302 : 200
    res.destroy = () => {
      destroyed = true
    }
    callback(res)
    queueMicrotask(() => {
      if (!destroyed) res.emit('data', body)
      if (!destroyed) res.emit('end')
    })
  }
  return req
}
interface ObjectCommand {
  input: { Bucket: string; Key: string; Body?: Buffer; ContentType?: string; Range?: string }
  constructor: { name: string }
}
interface S3ConstructorConfig {
  region: string
  endpoint?: string
  forcePathStyle?: boolean
  credentials: { accessKeyId: string; secretAccessKey: string }
}
interface S3Transport {
  send(command: ObjectCommand): Promise<unknown>
  destroy(): void
}
export interface S3FixtureModule {
  S3Client: new (config: S3ConstructorConfig) => S3Transport
}
export function brandingS3Client(state: BrandingTransportState, actual: S3FixtureModule) {
  return class {
    private real: S3Transport | null
    constructor(config: S3ConstructorConfig) {
      if (!config.credentials.accessKeyId || !config.credentials.secretAccessKey)
        throw new Error('Missing scoped storage credentials')
      this.real = state.live ? new actual.S3Client(config) : null
    }
    async send(command: ObjectCommand): Promise<unknown> {
      const { Bucket, Key, Body, ContentType, Range } = command.input
      if (!Bucket || !/^w\/workspace_[a-z0-9]+\/logos\/[a-f0-9]{64}\.png$/.test(Key))
        throw new Error('Expected scoped verified logo key')
      const identity = Bucket + ':' + Key
      if (this.real) {
        const result = await this.real.send(command)
        if (command.constructor.name.includes('PutObject'))
          state.created.add(Key.split('/').slice(2).join('/'))
        return result
      }
      if (command.constructor.name.includes('PutObject')) {
        if (!Buffer.isBuffer(Body) || !Body.equals(BRANDING_PNG) || ContentType !== 'image/png')
          throw new Error('Expected exact verified image payload')
        state.objects.set(identity, { bytes: Buffer.from(Body), mime: ContentType })
        state.created.add(Key.split('/').slice(2).join('/'))
        return {}
      }
      if (command.constructor.name.includes('DeleteObject')) {
        if (!state.objects.delete(identity)) throw new Error('Unknown owned object')
        return {}
      }
      if (!command.constructor.name.includes('GetObject'))
        throw new Error('Unknown storage command')
      const object = state.objects.get(identity)
      if (!object || (Range !== undefined && Range !== 'bytes=0-0'))
        throw new Error('Unknown scoped logo or range')
      const bytes = Range ? object.bytes.subarray(0, 1) : object.bytes
      return {
        ContentType: object.mime,
        ContentLength: bytes.length,
        Body: {
          transformToWebStream: () =>
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(bytes))
                controller.close()
              },
            }),
        },
      }
    }
    destroy() {
      this.real?.destroy()
    }
  }
}
