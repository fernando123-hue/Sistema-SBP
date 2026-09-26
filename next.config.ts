import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // O cliente Prisma não pode ser empacotado pelo bundler do servidor.
  serverExternalPackages: ['@prisma/client'],
  poweredByHeader: false,
  // Sem isto, `next dev` que detecta um agente de IA anexa um bloco próprio ao
  // `CLAUDE.md` e cria um `AGENTS.md` — as regras de quem escreve código aqui
  // mudando como efeito colateral de subir a tela (visto em 25/09/2026). Elas
  // mudam por decisão do dono, num PR que diz isso.
  agentRules: false,

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
          // A CSP NÃO está aqui: ela mora em `src/middleware.ts`.
          //
          // Cabeçalho estático não tem como carregar nonce, e sem nonce a única
          // forma de o Next funcionar era `script-src 'unsafe-inline'` — que
          // anula a proteção inteira. O middleware sorteia um nonce por
          // requisição; os cabeçalhos que não dependem da requisição continuam
          // aqui, onde custam menos.
        ],
      },
    ]
  },
}

export default config
