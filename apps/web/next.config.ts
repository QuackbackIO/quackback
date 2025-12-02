import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@quackback/db', '@quackback/shared'],
  allowedDevOrigins: [
    '127.0.0.1.nip.io',
    '*.127.0.0.1.nip.io',
  ],
}

export default nextConfig
