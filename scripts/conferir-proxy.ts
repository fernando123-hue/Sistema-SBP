import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { problemasDoProxyNoManifesto } from './proxy-no-manifesto'

/**
 * Entrada do passo "Proxy registrado no build" do CI. Executa SEMPRE ao ser
 * carregado: a função pura mora em `proxy-no-manifesto.ts`, para o teste
 * importá-la sem disparar nada. Antes havia um guarda pelo caminho do
 * `process.argv`, e rodado por outro caminho ele não fazia nada e saía 0 —
 * um portão que passa calado (revisão técnica do PR).
 */
function principal(): void {
  const caminho = join(process.cwd(), '.next', 'server', 'functions-config-manifest.json')
  let manifesto: unknown
  try {
    manifesto = JSON.parse(readFileSync(caminho, 'utf8'))
  } catch (erro) {
    console.error(`Não consegui ler ${caminho}. Rode \`npm run build\` antes.`, erro)
    process.exit(1)
  }
  const problemas = problemasDoProxyNoManifesto(manifesto)
  if (problemas.length > 0) {
    console.error(
      'A CSP e a defesa de mesma origem NÃO estão ligadas neste build:\n' + problemas.map((p) => `- ${p}`).join('\n'),
    )
    process.exit(1)
  }
  console.log('Proxy registrado no build, cobrindo /api, as páginas e fora dos estáticos.')
}

principal()
