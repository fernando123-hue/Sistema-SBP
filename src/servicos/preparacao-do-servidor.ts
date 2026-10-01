import { CATEGORIAS_CADASTRO, limiarConfiancaSemente } from '../core/config'
import { ErroDeNegocio } from '../core/erros'
import { CadastroDeColaboradorSchema } from '../core/esquemas'
import { gerarHash, sortearSenhaProvisoria } from '../servidor/credenciais'
import { novaCorrelacao } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditar } from './auditoria'
import { DOMINIO_SINTETICO } from './base-sintetica'

/**
 * O que uma base da operação recém-migrada precisa para alguém entrar nela.
 *
 * Até aqui, a única coisa que criava categoria e colaborador sem sessão de
 * gestor era o seed, e o seed cria a equipe FICTÍCIA, com senhas impressas no
 * terminal. Num servidor novo, o roteiro natural seria rodá-lo, e a base da
 * operação nasceria com contas inventadas ativas. A trava do seed não pega
 * isso: base vazia é igual a base de desenvolvimento nova (`AT-60`).
 *
 * Por isso a preparação é outra porta, com o mínimo: as categorias da
 * configuração (são a taxonomia da operação, não dado de teste) e UMA pessoa
 * real, gestora, que cadastra o resto da equipe pela tela.
 */

/**
 * As categorias de `CATEGORIAS_CADASTRO`, criadas ou com rótulo e ordem
 * atualizados. Repetir não duplica nada.
 */
export async function garantirCategorias(banco: Banco): Promise<number> {
  for (const [posicao, categoria] of CATEGORIAS_CADASTRO.entries()) {
    await banco.categoria.upsert({
      where: { codigo: categoria.codigo },
      create: {
        codigo: categoria.codigo,
        rotulo: categoria.rotulo,
        frente: categoria.frente,
        grupo: categoria.grupo,
        ordem: posicao,
        divisivel: categoria.divisivel,
        peso: categoria.peso,
        limiarIndivisivel: categoria.limiarIndivisivel,
        limiarConfianca: limiarConfiancaSemente(categoria.codigo),
        entraNoRateio: categoria.entraNoRateio,
        agrupaPorLiga: categoria.agrupaPorLiga,
      },
      // `peso` e `limiarConfianca` ficam DE FORA do update de propósito.
      //
      // Os dois são ajustáveis pelo operador sem deploy. Se o seed os
      // reescrevesse, um ajuste deliberado ("1,75 ficou pesado demais, põe
      // 1,5") voltaria ao padrão sozinho na próxima execução do seed, sem
      // aviso — sobrescrever decisão humana em silêncio é exatamente a doença
      // que este sistema existe para curar. Mudança de valor por decisão do
      // dono entra por MIGRAÇÃO, que é explícita, versionada e roda uma vez.
      update: { rotulo: categoria.rotulo, ordem: posicao },
    })
  }
  return CATEGORIAS_CADASTRO.length
}

export interface PrimeiroGestorCriado {
  colaboradorId: string
  email: string
  /** Em texto, UMA vez, para quem preparou o servidor entregar. Só o hash é gravado. */
  senhaProvisoria: string
}

/**
 * A primeira pessoa gestora da base, se ainda não há nenhuma.
 *
 * Recusa se já existe gestor, ativo ou não: daí em diante quem cadastra é a
 * tela, com sessão, papel conferido e trilha com nome. Uma porta de terminal
 * que continuasse aberta seria um jeito de criar gestor sem ninguém do setor
 * saber. Para gestor desligado, o caminho é outro gestor reativá-lo.
 *
 * Recusa também o domínio sintético: uma "primeira gestora" `@exemplo.test`
 * deixaria a base parecendo de desenvolvimento, e a trava da demo e do seed
 * (`exigirBaseSintetica`) a deixaria passar.
 *
 * LIMITE CONHECIDO: a conferência e a criação não são atômicas. Duas
 * execuções no mesmo instante poderiam criar duas gestoras, com e-mails
 * diferentes. É um comando de instalação, rodado uma vez, por uma pessoa; as
 * duas ficariam na trilha.
 */
export async function criarPrimeiroGestor(banco: Banco, entrada: unknown): Promise<PrimeiroGestorCriado> {
  const dados = CadastroDeColaboradorSchema.pick({ nome: true, email: true }).parse(entrada)

  if (dados.email.endsWith(DOMINIO_SINTETICO)) {
    throw new ErroDeNegocio(
      `O e-mail da primeira gestora não pode ser do domínio de teste (${DOMINIO_SINTETICO}): ` +
        'use o endereço real de quem vai administrar o sistema.',
    )
  }

  const senhaProvisoria = sortearSenhaProvisoria()
  // Fora da transação, como em `criarColaborador`: o hash custa CPU de propósito.
  const senhaHash = await gerarHash(senhaProvisoria)
  const correlacaoId = novaCorrelacao()

  return banco.$transaction(async (tx) => {
    const gestores = await tx.colaborador.count({ where: { papel: 'gestor' } })
    if (gestores > 0) {
      throw new ErroDeNegocio(
        'Esta base já tem gestor. O resto da equipe é cadastrado na tela "Acesso e cadastro", ' +
          'por quem já é gestor; e gestor desligado é reativado ali também.',
      )
    }

    // O mesmo e-mail como colaborador comum também recusa: promover alguém a
    // gestor é decisão de quem já administra, pela tela, com a trilha dizendo quem.
    const mesmoEmail = await tx.colaborador.findUnique({ where: { email: dados.email }, select: { id: true } })
    if (mesmoEmail !== null) {
      throw new ErroDeNegocio('Já existe uma pessoa com este e-mail na base. Nada foi criado.')
    }

    const gestor = await tx.colaborador.create({
      data: {
        nome: dados.nome,
        email: dados.email,
        papel: 'gestor',
        senhaHash,
        senhaDefinidaEm: new Date(),
        precisaTrocarSenha: true,
      },
      select: { id: true, email: true },
    })

    await auditar(tx, {
      entidade: 'Colaborador',
      entidadeId: gestor.id,
      acao: 'primeiro_gestor_criado',
      depois: { nome: dados.nome, email: gestor.email, papel: 'gestor' },
      // Não há sessão: quem rodou foi o terminal do servidor. A trilha diz
      // isso em vez de inventar um autor.
      usuario: 'sistema',
      correlacaoId,
    })

    return { colaboradorId: gestor.id, email: gestor.email, senhaProvisoria }
  })
}
