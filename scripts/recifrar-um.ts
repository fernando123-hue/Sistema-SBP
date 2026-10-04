import { lstat, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

import { SUBPASTA_DE_ANEXO, ehAnexoDoSistema } from '../src/adapters/armazenamento-disco'

/**
 * A recifragem de UM anexo, e a limpeza das sobras — separadas de
 * `recifrar-anexos.ts` para o teste importá-las sem disparar o script.
 *
 * O cifrado é gravado ao lado (`<chave>.recifrando`), conferido lendo de volta
 * e só então troca o original. O que faltava: se a releitura LANÇASSE (não
 * decifra, disco), o temporário ficava — uma cópia do documento inteiro fora de
 * qualquer prazo (invariante 11), que a varredura do `A78` nem lista, porque o
 * nome não é de anexo. Revisão técnica do #211, N7.
 */

export const SUFIXO_TEMPORARIO = '.recifrando'

/** Nome que `guardar` cria, mais o sufixo — só ele pode ser sobra de recifragem. */
const NOME_DE_SOBRA = /^([0-9a-f]{32}(?:\.[a-z0-9]{1,10})?)\.recifrando$/

export interface DependenciasDaRecifragem {
  cifrar: (bytes: Buffer) => Buffer
  /** Lê o temporário pelo adapter de verdade — é o que prova que ele abre. */
  lerDeVolta: (chaveTemporaria: string) => Promise<Uint8Array | null>
  /** Grava o temporário com `wx`. Injetável só para o teste simular disco cheio. */
  gravar?: (caminho: string, dados: Buffer) => Promise<void>
}

const gravarSemSobrescrever = (caminho: string, dados: Buffer): Promise<void> =>
  writeFile(caminho, dados, { flag: 'wx' })

function codigoDoErro(erro: unknown): string | undefined {
  return erro instanceof Error && 'code' in erro && typeof erro.code === 'string' ? erro.code : undefined
}

export async function recifrarUm(raiz: string, chave: string, deps: DependenciasDaRecifragem): Promise<void> {
  const caminho = join(raiz, chave)
  const temporario = `${caminho}${SUFIXO_TEMPORARIO}`
  // O `readFile` segue link simbólico, e o `rename` do fim trocaria o link por
  // uma cópia cifrada do ALVO, que passaria a morar na pasta de anexos
  // (revisão de segurança do #215, S3). Só arquivo comum é recifrado. Ausente
  // não é "link": entre a listagem e aqui a limpeza pode ter expurgado, e a
  // mensagem não pode mandar ninguém procurar um link que não existe
  // (revisões do #219, técnica 1 e segurança S2).
  await exigirArquivoComum(caminho, chave)
  const bytes = await readFile(caminho)

  // Qualquer falha antes da troca leva o temporário junto — mas só o que ESTA
  // execução criou: com `wx`, um temporário que já existia faz o `writeFile`
  // falhar com `EEXIST`, e apagá-lo seria apagar o de outra execução (revisão
  // de segurança do #215, S2). Qualquer OUTRA falha da gravação (disco cheio no
  // meio) já criou o arquivo, parcial, e ele sai também (rodada 2, N1). O original só desaparece depois de existir uma cópia cifrada
  // que o adapter consegue ler.
  const gravar = deps.gravar ?? gravarSemSobrescrever
  // Fora do `try`: um `cifrar` que lança não pode marcar `criado` e levar o
  // temporário de outra execução (rodada 3 da técnica, B9).
  const dados = deps.cifrar(bytes)
  let criado = false
  try {
    try {
      await gravar(temporario, dados)
    } catch (erro) {
      criado = codigoDoErro(erro) !== 'EEXIST'
      throw erro
    }
    criado = true
    const conferencia = await deps.lerDeVolta(`${chave}${SUFIXO_TEMPORARIO}`)
    if (!conferencia || Buffer.compare(Buffer.from(conferencia), bytes) !== 0) {
      throw new Error(`Recusado: a releitura de ${JSON.stringify(chave)} não devolveu os bytes originais.`)
    }
    // Se a limpeza diária expurgou o original depois da leitura, o `rename`
    // recriaria o documento sem linha que o aponte, fora do prazo, até a
    // varredura do A78 achá-lo 7 dias depois (revisão de segurança do #215,
    // S4). Conferir logo antes estreita a janela a microssegundos; fechá-la de
    // vez é não rodar a recifragem junto com a limpeza, como diz o cabeçalho.
    // Confere o tipo também: virar link depois da leitura é recusado igual.
    await exigirArquivoComum(caminho, chave)
    await rename(temporario, caminho)
  } catch (erro) {
    if (criado) {
      // Falhar ao apagar o temporário não pode esconder a causa que trouxe até
      // aqui (revisão técnica do #215, M1): a causa sobe, e esta falha é dita.
      await rm(temporario, { force: true }).catch((aoApagar: unknown) => {
        console.error(
          `Temporário ${JSON.stringify(`${chave}${SUFIXO_TEMPORARIO}`)} não foi apagado: ` +
            `${aoApagar instanceof Error ? aoApagar.message : String(aoApagar)}`,
        )
      })
    }
    throw erro
  }
}

async function exigirArquivoComum(caminho: string, chave: string): Promise<void> {
  const tipo = await tipoDaEntrada(caminho)
  if (tipo === 'ausente') {
    throw new Error(
      `Recusado: ${JSON.stringify(chave)} sumiu no meio da recifragem (expurgado pela limpeza diária?). ` +
        'Nada foi recriado; rode de novo para seguir com os outros.',
    )
  }
  if (tipo === 'outro') {
    throw new Error(`Recusado: ${JSON.stringify(chave)} não é arquivo comum (link simbólico ou pasta). Nada foi trocado.`)
  }
}

/**
 * As chaves de anexo sob a raiz, com a mesma forma que o `listar` do adapter
 * aceita: subpasta de duas letras hexadecimais, arquivo comum, nome que
 * `guardar` cria. Antes, qualquer arquivo de qualquer pasta da raiz entrava, e
 * um `backup/planilha.xlsx` deixado ali seria cifrado com a chave dos anexos
 * (revisão de segurança do #219, S1).
 *
 * O resto volta em `ignoradas`, para ser dito em vez de sumir: dentro das
 * subpastas, tudo que não é anexo nem sobra de recifragem; na raiz, só o que
 * tem NOME de subpasta e não é pasta de verdade (uma junção `ab` para outro
 * disco, que deixaria anexos fora da contagem — segurança S4). Outras entradas
 * da raiz, como a sentinela da chave, não são do assunto e não poluem a saída.
 *
 * Pasta inexistente sobe com `ENOENT`: quem chama decide se é zero. Só a
 * RAIZ: uma subpasta que some entre as duas leituras sobe como erro próprio,
 * sem esse código — antes, o script a lia como "a pasta de anexos ainda não
 * existe" e respondia zero com a raiz cheia (revisões do #219, técnica 5 e
 * segurança N2).
 */
export async function chavesDeAnexo(raiz: string): Promise<{ chaves: string[]; ignoradas: string[] }> {
  const chaves: string[] = []
  const ignoradas: string[] = []
  for (const pasta of await readdir(raiz, { withFileTypes: true })) {
    if (!SUBPASTA_DE_ANEXO.test(pasta.name)) continue
    if (!pasta.isDirectory()) {
      ignoradas.push(pasta.name)
      continue
    }
    for (const entrada of await lerSubpasta(raiz, pasta.name)) {
      const chave = `${pasta.name}/${entrada.name}`
      // Sobra de recifragem não é anexo: `limparSobras` cuida dela. Testada
      // ANTES da forma de anexo: `<32 hex>.recifrando`, a sobra de anexo sem
      // extensão, também passa na forma de anexo, porque `recifrando` cabe nos
      // 10 caracteres de extensão (revisões do #219, rodada 2, N1).
      if (ehSobra(pasta.name, entrada)) continue
      if (ehAnexoDoSistema(pasta.name, entrada)) chaves.push(chave)
      else ignoradas.push(chave)
    }
  }
  return { chaves: chaves.sort(), ignoradas: ignoradas.sort() }
}

function ehSobra(pasta: string, entrada: Dirent): boolean {
  return entrada.isFile() && NOME_DE_SOBRA.test(entrada.name) && entrada.name.startsWith(pasta)
}

async function lerSubpasta(raiz: string, pasta: string): Promise<Dirent[]> {
  try {
    return await readdir(join(raiz, pasta), { withFileTypes: true })
  } catch (erro) {
    if (codigoDoErro(erro) !== 'ENOENT') throw erro
    // O `code` fica só na causa: no erro de cima, `ENOENT` é o que o script lê
    // como "pasta não existe" (revisão de segurança do #222, S3).
    throw new Error(
      `A subpasta ${JSON.stringify(pasta)} sumiu durante a listagem (o sistema não apaga subpasta: alguém mexeu na pasta?). ` +
        'Rode de novo.',
      { cause: erro },
    )
  }
}

export interface SobrasEncontradas {
  /** O original está ao lado: a sobra é cópia, e pode sair. */
  comOriginal: string[]
  /** O original NÃO está: a sobra pode ser a única cópia, e fica. */
  semOriginal: string[]
}

/**
 * Os temporários de uma execução que MORREU no meio (energia, `kill`) — o caso
 * que nenhum `catch` alcança. Só conta o que tem a forma do sistema: subpasta
 * de duas letras hexadecimais, arquivo comum, nome de chave mais o sufixo. Um
 * `backup/x.recifrando` ou um `qualquer.recifrando` não é sobra desta rotina
 * (revisão de segurança do #215, S1).
 */
export async function encontrarSobras(raiz: string): Promise<SobrasEncontradas> {
  const encontradas: SobrasEncontradas = { comOriginal: [], semOriginal: [] }
  let pastas
  try {
    pastas = await readdir(raiz, { withFileTypes: true })
  } catch (erro) {
    // Pasta que ainda não existe não tem sobra; qualquer outra falha sobe.
    if (codigoDoErro(erro) === 'ENOENT') return encontradas
    throw erro
  }
  for (const pasta of pastas) {
    if (!pasta.isDirectory() || !SUBPASTA_DE_ANEXO.test(pasta.name)) continue
    for (const entrada of await lerSubpasta(raiz, pasta.name)) {
      const original = entrada.name.match(NOME_DE_SOBRA)?.[1]
      if (!entrada.isFile() || original === undefined || !original.startsWith(pasta.name)) continue
      const chave = `${pasta.name}/${entrada.name}`
      if (await ehArquivo(join(raiz, pasta.name, original))) encontradas.comOriginal.push(chave)
      else encontradas.semOriginal.push(chave)
    }
  }
  return encontradas
}

async function ehArquivo(caminho: string): Promise<boolean> {
  return (await tipoDaEntrada(caminho)) === 'arquivo'
}

/** `lstat` não segue link: um link para arquivo é `'outro'`, nunca `'arquivo'`. */
async function tipoDaEntrada(caminho: string): Promise<'arquivo' | 'ausente' | 'outro'> {
  try {
    return (await lstat(caminho)).isFile() ? 'arquivo' : 'outro'
  } catch (erro) {
    if (codigoDoErro(erro) === 'ENOENT') return 'ausente'
    throw erro
  }
}

/**
 * Apaga as sobras que têm o original ao lado. É seguro porque o temporário só
 * vira o original pelo `rename`: se ele ainda existe E o original também, é
 * cópia. Sem o original, NÃO apaga — conferir em vez de supor (revisões do
 * #215, M2 e S1) —, e devolve a sobra em `mantidas`, para alguém olhar.
 */
export async function limparSobras(raiz: string): Promise<{ apagadas: string[]; mantidas: string[] }> {
  const { comOriginal, semOriginal } = await encontrarSobras(raiz)
  for (const chave of comOriginal) await rm(join(raiz, chave), { force: true })
  return { apagadas: comOriginal, mantidas: semOriginal }
}
