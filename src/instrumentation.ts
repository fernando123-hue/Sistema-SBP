/**
 * O que o servidor liga ao subir.
 *
 * Hoje, uma coisa: a limpeza diária de `A17` — "a limpeza roda sozinha, uma vez
 * por dia". O Next chama `register` uma vez por instância de servidor, e em
 * todos os runtimes: por isso este arquivo só decide SE liga, e o que só existe
 * em Node (banco, `process.stderr`, temporizador) mora em
 * `instrumentation-node.ts`, carregado apenas no runtime Node — o padrão da
 * documentação do Next.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // `next build` também carrega o servidor para gerar páginas. Limpeza de dado
  // não tem nada a fazer durante um build — e o banco da máquina que compila
  // pode nem ser o de produção.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { agendarLimpezaDiaria } = await import('./instrumentation-node')
  await agendarLimpezaDiaria()
}
