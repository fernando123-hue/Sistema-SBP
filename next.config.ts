import type { NextConfig } from 'next'

/**
 * Lido do ambiente do PROCESSO DE BUILD, não de `servidor/ambiente.ts`.
 *
 * Este arquivo roda antes de a aplicação existir, e importar a validação de
 * ambiente aqui faria o `next.config` falhar por falta de `DATABASE_URL` —
 * uma variável que a configuração de cabeçalhos não usa para nada.
 */
const emDesenvolvimento = process.env.NODE_ENV !== 'production'

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
          //
          // ═══ `unsafe-eval` SÓ EM DESENVOLVIMENTO ═══
          //
          // O Fast Refresh do Next avalia código em tempo de execução. Sem
          // `unsafe-eval`, o navegador recusa (`eval() is not supported`), o
          // HMR cai e — o pior sintoma — formulários controlados param de
          // reagir à digitação. Isso estava documentado no ESTADO como uma
          // "armadilha conhecida" que impedia conferir qualquer tela em modo de
          // desenvolvimento: quem fosse verificar uma correção de interface via
          // uma tela quebrada por um motivo que não era o dela.
          //
          // O custo de nunca ter conseguido verificar tela é maior que o risco
          // de afrouxar a política no ambiente onde não existe dado real e o
          // servidor escuta em localhost. Em produção nada muda: o build não
          // usa `eval`, e a diretriz sai.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              emDesenvolvimento
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
                : "script-src 'self' 'unsafe-inline'",
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
