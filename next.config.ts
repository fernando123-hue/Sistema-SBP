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
          // O cookie de sessão só ganha `secure` em produção. Sem HSTS, uma
          // primeira requisição em HTTP atrás de um proxy mal configurado o
          // exporia em texto claro.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          // Rede de segurança para o dia em que uma dependência introduzir um
          // `innerHTML` que passe despercebido na revisão. `unsafe-inline` em
          // `style-src` é exigência do Next para estilos críticos embutidos.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self'",
              "connect-src 'self'",
              "form-action 'self'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default config
