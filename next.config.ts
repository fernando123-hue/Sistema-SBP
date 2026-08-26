import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // O cliente Prisma não pode ser empacotado pelo bundler do servidor.
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-better-sqlite3'],
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:caminho*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default config
