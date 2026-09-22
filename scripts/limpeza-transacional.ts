import type { ArmazenamentoPort } from '../src/ports/armazenamento'
import type { Banco } from '../src/servidor/prisma'

/**
 * Apaga os dados TRANSACIONAIS, preservando o cadastro base.
 *
 * ═══ POR QUE ISTO NÃO MORA MAIS DENTRO DO SCRIPT ═══
 *
 * Morava — e o teste que deveria provar a ordem de limpeza reimplementava
 * essa ordem à mão, em vez de chamar o script. As duas listas divergiram na
 * primeira oportunidade: quando `JustificativaDeAtribuicao` virou `Restrict`
 * (achado N-22), o teste ganhou a linha nova e o script não. O teste ficou
 * verde afirmando "a rotina de desenvolvimento apaga na ordem certa", e a
 * rotina real quebrava depois de qualquer transferência ou devolução — achado
 * da revisão técnica do PR #82.
 *
 * Agora existe uma lista só, e é esta. O script chama daqui, e o teste também.
 *
 * Mora em `scripts/`, e não em `src/`: é a única rotina do repositório que
 * apaga trilha de auditoria, e de `scripts/` nenhum código de produção a
 * alcança por engano. A varredura de `trilha-append-only.test.ts` a conhece
 * pelo nome.
 *
 * ═══ OS BYTES SAEM ANTES DAS LINHAS (achado N-23) ═══
 *
 * Apagar `Email` leva `Anexo` junto (cascata), mas os ARQUIVOS ficariam no
 * disco — sem referência, fora de qualquer retenção, invisíveis para o
 * expurgo, que só sabe apagar o que ainda está no banco. A chave sai do banco
 * enquanto ela ainda existe, e o arquivo é removido antes.
 *
 * **Não é atômico, e não dá para ser:** disco e banco não compartilham
 * transação. Uma falha entre as duas etapas deixa linha apontando para arquivo
 * que já não existe. Numa base de desenvolvimento isso é aceitável (rodar de
 * novo resolve, `remover` é idempotente); é a razão de esta função ser
 * chamada só por um script que recusa produção.
 */
export interface LimpezaFeita {
  readonly anexosNoDisco: number
  readonly execucoes: number
  readonly justificativas: number
  readonly atribuicoes: number
  readonly revisoes: number
  readonly rodadas: number
  readonly travas: number
  readonly itens: number
  readonly emails: number
  readonly saldosCarga: number
  readonly saldosGlobais: number
  readonly eventos: number
  readonly auditoria: number
}

export async function limparTransacional(
  banco: Banco,
  armazenamento: ArmazenamentoPort,
): Promise<LimpezaFeita> {
  const comBytes = await banco.anexo.findMany({
    where: { chaveArmazenamento: { not: null } },
    select: { chaveArmazenamento: true },
  })
  for (const anexo of comBytes) {
    if (anexo.chaveArmazenamento) await armazenamento.remover(anexo.chaveArmazenamento)
  }

  // Filhos antes dos pais, respeitando as chaves estrangeiras. Desde o N-22 as
  // quatro relações de histórico são `Restrict`, então a ordem não é mais
  // conveniência: é o que faz a limpeza funcionar.
  return {
    anexosNoDisco: comBytes.length,
    execucoes: (await banco.execucao.deleteMany()).count,
    justificativas: (await banco.justificativaDeAtribuicao.deleteMany()).count,
    atribuicoes: (await banco.atribuicao.deleteMany()).count,
    revisoes: (await banco.revisao.deleteMany()).count,
    rodadas: (await banco.rodadaDistribuicao.deleteMany()).count,
    travas: (await banco.travaDeDistribuicao.deleteMany()).count,
    itens: (await banco.item.deleteMany()).count,
    emails: (await banco.email.deleteMany()).count,
    saldosCarga: (await banco.saldoCarga.deleteMany()).count,
    saldosGlobais: (await banco.saldoCargaGlobal.deleteMany()).count,
    eventos: (await banco.eventoProcessamento.deleteMany()).count,
    auditoria: (await banco.logAuditoria.deleteMany()).count,
  }
}
