import { criarColaborador } from '../../../servicos/colaboradores'
import { corpoJson, responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'
import { exigirPapel } from '../../../servidor/ator'

/**
 * Lista de colaboradores, com o estado de acesso de cada um.
 *
 * ERA PÚBLICA e não é mais. Enquanto a entrada não tinha senha, esta rota
 * precisava ser aberta — era ela que populava a tela de escolha de identidade,
 * e junto com `POST /api/sessao` significava que qualquer um que alcançasse o
 * servidor assumia qualquer identidade, inclusive a de gestor.
 *
 * Agora a entrada é por e-mail e senha e ninguém precisa ver a lista para
 * entrar. Quem consulta aqui é o gestor, para administrar acesso: nome e
 * papel da equipe são justamente o material de quem está montando um ataque
 * direcionado.
 *
 * Inclui os INATIVOS de propósito: sem eles a tela de acesso não teria como
 * reativar ninguém, e alguém desligado por engano ficaria invisível.
 */
export async function GET(): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    exigirPapel(ator, 'listar colaboradores', 'gestor')

    const colaboradores = await obterPrisma().colaborador.findMany({
      orderBy: [{ ativo: 'desc' }, { papel: 'asc' }, { nome: 'asc' }],
      select: {
        id: true,
        nome: true,
        papel: true,
        email: true,
        ativo: true,
        precisaTrocarSenha: true,
        senhaDefinidaEm: true,
        bloqueadoAte: true,
        tentativasFalhas: true,
        // Sem isto, a tela não tem como mostrar quem está sem categoria — e
        // quem está sem categoria some da distribuição sem nada acusar.
        habilitacoes: {
          where: { podeReceber: true },
          select: { categoria: { select: { codigo: true } } },
        },
      },
    })

    // O hash nunca sai daqui, em nenhuma forma. `senhaDefinidaEm` responde
    // "esta pessoa já tem acesso?" sem revelar nada sobre a senha em si.
    return responder(
      colaboradores.map((colaborador) => ({
        ...colaborador,
        habilitacoes: undefined,
        categorias: colaborador.habilitacoes.map((h) => h.categoria.codigo),
      })),
    )
  })
}

/**
 * Gestor cadastra alguém novo.
 *
 * Devolve a senha provisória em texto UMA vez, para ser entregue à pessoa.
 * Ela não é gravada em lugar nenhum além do hash e não volta em consulta
 * nenhuma depois disto.
 */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await criarColaborador(obterPrisma(), await corpoJson(requisicao), ator))
  })
}
