declare module 'heic-convert' {
  interface HeicConvertOptions {
    buffer: ArrayBufferLike | Uint8Array
    format: 'JPEG' | 'PNG'
    /** 0 to 1, JPEG only. */
    quality?: number
  }
  /** Decode the primary image of a HEIC/HEIF file and encode it as JPEG or PNG. */
  function convert(options: HeicConvertOptions): Promise<ArrayBuffer>
  export default convert
}
