import { CATEGORIAS_CADASTRO } from '../src/core/config'
import { deslocarDias, hojeIso, sequenciaDeDatas } from '../src/core/util/datas'
import { gerarHash, sortearSenhaProvisoria } from '../src/servidor/credenciais'
import { obterPrisma } from '../src/servidor/prisma'

/**
 * Seed.
 *
 * TODOS os dados são SINTÉTICOS. Nenhum colaborador, associado, liga ou e-mail
 * real da associação entra no repositório — nem aqui, nem em teste, nem em
 * fixture. A ESTRUTURA imita a operação real (equipe pequena, habilitações
 * desiguais, 2 a 3 pessoas de plantão por dia); os DADOS são inventados.
 */

/** Espelha o padrão observado: nem todo mundo opera todas as categorias. */
const EQUIPE = [
  {
    nome: 'Ana Ribeiro Salgado',
    email: 'ana.operadora@exemplo.test',
    papel: 'operador',
    categorias: ['DOC_CADASTRO', 'FICHA_CADASTRO', 'EMAIL_CADASTRO', 'LIGA', 'LIGANTE', 'EMAIL_LIGA'],
  },
  {
    nome: 'Bianca Toledo Marques',
    email: 'bianca@exemplo.test',
    papel: 'colaborador',
    categorias: ['DOC_CADASTRO', 'FICHA_CADASTRO', 'EMAIL_CADASTRO', 'LIGA', 'LIGANTE', 'EMAIL_LIGA'],
  },
  {
    nome: 'Caio Bernardes Villas',
    email: 'caio@exemplo.test',
    papel: 'colaborador',
    categorias: ['DOC_CADASTRO', 'FICHA_CADASTRO', 'EMAIL_CADASTRO', 'LIGANTE'],
  },
  {
    nome: 'Dora Menezes Aguiar',
    email: 'dora@exemplo.test',
    papel: 'colaborador',
    categorias: ['LIGA', 'LIGANTE', 'EMAIL_LIGA'],
  },
  {
    // Reproduz o caso "só LIGANTE" dos blocos que ignoram Mov. Extra na planilha.
    nome: 'Elias Farias Quadros',
    email: 'elias@exemplo.test',
    papel: 'colaborador',
    categorias: ['LIGANTE'],
  },
  {
    nome: 'Fabiana Loureiro Sena',
    email: 'fabiana.gestora@exemplo.test',
    papel: 'gestor',
    categorias: [],
  },
] as const

/**
 * Janela de escala e vigência das habilitações.
 *
 * Ancorada em HOJE, não numa data fixa. Com data fixa no futuro, quem clonasse
 * o projeto e abrisse a tela veria "3 de 5 disponíveis" e, ao mesmo tempo,
 * "nenhum colaborador elegível" — porque a habilitação ainda não teria começado.
 * Confuso e indistinguível de defeito.
 */
export const DATA_INICIAL = deslocarDias(hojeIso(), -7)
export const TOTAL_DE_DIAS = 45

/**
 * Senha provisória: SORTEADA a cada execução e impressa uma única vez, nunca
 * escrita no repositório. Uma senha fixa no arquivo seria credencial
 * versionada — e valeria para toda instalação que rodasse este seed, inclusive
 * uma exposta por engano.
 *
 * Quem já tem senha não é tocado: rodar o seed de novo não derruba o acesso de
 * ninguém nem reimprime segredo que já foi trocado.
 *
 * O sorteio em si mora em `credenciais.ts`, junto do resto que lida com
 * segredo — o mesmo que a tela do gestor usa.
 */
async function principal(): Promise<void> {
  const banco = obterPrisma()
  const provisorias: { email: string; senha: string }[] = []

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
        entraNoRateio: categoria.entraNoRateio,
      },
      update: { rotulo: categoria.rotulo, ordem: posicao },
    })
  }

  const datas = sequenciaDeDatas(DATA_INICIAL, TOTAL_DE_DIAS)

  for (const [posicao, pessoa] of EQUIPE.entries()) {
    const existente = await banco.colaborador.findUnique({
      where: { email: pessoa.email },
      select: { senhaHash: true },
    })

    // Quem já tem senha não é tocado. O hash é calculado UMA vez, fora do
    // `upsert`: o objeto `create` é avaliado mesmo quando o registro já existe,
    // então `gerarHash(senha!)` ali dentro quebrava a segunda execução do seed
    // com "Cannot read properties of null". O `!` escondia isso do typecheck.
    const senhaProvisoria = existente?.senhaHash ? null : sortearSenhaProvisoria()
    const credencial = senhaProvisoria
      ? {
          senhaHash: await gerarHash(senhaProvisoria),
          senhaDefinidaEm: new Date(),
          precisaTrocarSenha: true,
        }
      : null

    if (senhaProvisoria) provisorias.push({ email: pessoa.email, senha: senhaProvisoria })

    const colaborador = await banco.colaborador.upsert({
      where: { email: pessoa.email },
      create: {
        nome: pessoa.nome,
        email: pessoa.email,
        papel: pessoa.papel,
        // Colaborador novo SEMPRE nasce com credencial: `credencial` só é nulo
        // quando o registro já existe, caso em que este ramo não roda.
        ...(credencial ?? {}),
      },
      update: { nome: pessoa.nome, papel: pessoa.papel, ...(credencial ?? {}) },
    })

    for (const codigo of pessoa.categorias) {
      const categoria = await banco.categoria.findUniqueOrThrow({ where: { codigo } })
      const vigenciaInicio = new Date(`${DATA_INICIAL}T00:00:00.000Z`)

      await banco.habilitacao.upsert({
        where: {
          colaboradorId_categoriaId_vigenciaInicio: {
            colaboradorId: colaborador.id,
            categoriaId: categoria.id,
            vigenciaInicio,
          },
        },
        create: { colaboradorId: colaborador.id, categoriaId: categoria.id, vigenciaInicio },
        update: { podeReceber: true },
      })
    }

    if (pessoa.categorias.length === 0) continue

    // Escala determinística: 3 pessoas por dia, rodando. Reproduz o `J = 2..3`
    // da planilha sem que ninguém precise editar fórmula para trocar o plantão.
    for (const [diaIndice, data] of datas.entries()) {
      const disponivel = (diaIndice + posicao) % 5 < 3

      await banco.escala.upsert({
        where: { data_colaboradorId: { data, colaboradorId: colaborador.id } },
        create: { data, colaboradorId: colaborador.id, disponivel },
        update: { disponivel },
      })
    }
  }

  const totais = {
    categorias: await banco.categoria.count(),
    colaboradores: await banco.colaborador.count(),
    habilitacoes: await banco.habilitacao.count(),
    escalas: await banco.escala.count(),
  }

  process.stdout.write(`Seed concluído: ${JSON.stringify(totais)}\n`)

  if (provisorias.length > 0) {
    process.stdout.write(
      '\nSenhas provisórias — aparecem UMA vez, não ficam gravadas em lugar nenhum.\n' +
        'O sistema exige a troca no primeiro acesso.\n\n',
    )
    for (const entrada of provisorias) {
      process.stdout.write(`  ${entrada.email}  ${entrada.senha}\n`)
    }
    process.stdout.write('\n')
  }
}

principal().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
  process.exitCode = 1
})
