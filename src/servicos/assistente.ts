import { papelAlcancaTela } from '../core/assistente/conhecimento'
import type { RespostaDoAssistente } from '../core/assistente/esquemas'
import type { QuemPergunta } from '../core/assistente/prompt'
import type { AssistentePort } from '../ports/assistente'
import type { Ator } from '../servidor/ator'
import { novaCorrelacao, registrarEvento, registrarLog } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'

/**
 * Assistente de ajuda — orquestração.
 *
 * ═══ O QUE ESTE SERVIÇO EXISTE PARA GARANTIR ═══
 *
 * 1. **A identidade vem do `Ator`.** Papel e dono da fila saem do cookie
 *    assinado, nunca do corpo da requisição (invariante 5). Não existe campo
 *    "sou gestor" que a pergunta possa carregar.
 *
 * 2. **O papel é conferido DUAS vezes, em códigos diferentes.** Antes: o
 *    material do prompt é filtrado por papel em `montarMaterial`. Depois: a
 *    tela sugerida pelo modelo é conferida contra o papel em
 *    `papelAlcancaTela`. A segunda existe porque a primeira depende de o
 *    modelo respeitar o material recebido, e essa é uma suposição que não se
 *    faz sobre modelo nenhum.
 *
 * 3. **O texto da pergunta não é persistido.** Nem na trilha, nem no evento,
 *    nem no log. É a mesma decisão de `Nota` — e aqui vale ainda mais, porque
 *    a pergunta mais provável da operação é "o que quer dizer este e-mail?",
 *    com o e-mail colado junto. Gravar isso seria criar uma segunda cópia de
 *    conteúdo de terceiro numa tabela que a política de retenção não alcança
 *    (invariante 11). O que fica é o FATO: alguém perguntou, foi respondido ou
 *    não, a partir de quais verbetes.
 *
 * 4. **Nada é escrito no domínio.** Este serviço não abre transação, não cria,
 *    não atualiza e não apaga nada além do próprio evento de observabilidade.
 *    Se um dia alguém precisar acrescentar uma escrita aqui, o lugar está
 *    errado: assistente que opera o sistema é um caminho paralelo à autorização.
 */

export interface DependenciasDoAssistente {
  readonly banco: Banco
  readonly assistente: AssistentePort
}

/**
 * Itens em aberto na fila de quem está perguntando.
 *
 * Contagem direta, sem passar por `minhaFila`: aqui não interessa a lista, só
 * o número, e trazer as linhas inteiras — com remetente, assunto e categoria —
 * carregaria para a memória deste serviço exatamente o tipo de conteúdo que ele
 * promete não tocar.
 */
async function contarFila(banco: Banco, colaboradorId: string): Promise<number> {
  return banco.atribuicao.count({
    where: {
      colaboradorId,
      ativa: true,
      item: { status: { in: ['distribuido', 'em_andamento'] } },
    },
  })
}

export async function perguntarAoAssistente(
  deps: DependenciasDoAssistente,
  pergunta: string,
  ator: Ator,
): Promise<RespostaDoAssistente> {
  const correlacaoId = novaCorrelacao()
  const inicio = Date.now()

  const quem: QuemPergunta = {
    // O nome não vai para o modelo — ver `montarMaterial`. Fica aqui porque a
    // interface o declara e porque uma versão futura da tela pode usá-lo para
    // saudar sem que isso implique enviá-lo.
    nome: '',
    papel: ator.papel,
    itensNaFila: await contarFila(deps.banco, ator.colaboradorId),
  }

  const bruta = await deps.assistente.responder(quem, pergunta)

  // Segunda conferência de papel, sobre a saída do modelo.
  //
  // O enum do esquema garante que a tela EXISTE; ele não garante que esta
  // pessoa a alcança. Sem esta linha, bastaria o modelo escorregar uma vez para
  // um colaborador receber "vá em Acesso e destrave a conta" — uma tela que a
  // navegação não mostra e cuja API vai responder 403. O link não daria acesso
  // a nada, mas mandaria a pessoa bater numa porta trancada e concluir que o
  // sistema está quebrado.
  const telaSugerida =
    bruta.telaSugerida && papelAlcancaTela(ator.papel, bruta.telaSugerida)
      ? bruta.telaSugerida
      : null

  if (bruta.telaSugerida && !telaSugerida) {
    registrarLog('aviso', 'assistente sugeriu tela fora do papel de quem perguntou', {
      adapter: deps.assistente.nome,
      papel: ator.papel,
      tela: bruta.telaSugerida,
    })
  }

  // Observabilidade, não auditoria: perguntar não altera registro nenhum, então
  // não é fato para a trilha append-only. `detalhe` leva só contagens e ids de
  // verbete — nunca o texto da pergunta nem o da resposta.
  //
  // O `catch` é deliberado e é a única falha que este serviço engole: a pessoa
  // já tem a resposta em mãos, e derrubar uma ajuda que funcionou porque o
  // registro de uso falhou seria trocar o essencial pelo acessório. A falha não
  // some — vira log de erro.
  try {
    await registrarEvento(deps.banco, {
      correlacaoId,
      etapa: 'assistente',
      situacao: 'sucesso',
      referencia: ator.colaboradorId,
      mensagem: bruta.respondida ? 'respondido pelo manual' : 'fora do manual',
      detalhe: {
        adapter: deps.assistente.nome,
        papel: ator.papel,
        verbetes: bruta.verbetesUsados,
        tamanhoDaPergunta: pergunta.length,
      },
      duracaoMs: Date.now() - inicio,
    })
  } catch (erro) {
    registrarLog('erro', 'falha ao registrar uso do assistente', {
      correlacaoId,
      erro: erro instanceof Error ? erro.message : 'erro inesperado',
    })
  }

  return {
    resposta: bruta.resposta,
    respondida: bruta.respondida,
    telaSugerida,
    origem: deps.assistente.nome,
  }
}
