import { lstat, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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

/** Subpasta e nome que `guardar` cria — só eles podem ter sobra de recifragem. */
const SUBPASTA_DE_ANEXO = /^[0-9a-f]{2}$/
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
  const bytes = await readFile(caminho)

  // Qualquer falha antes da troca leva o temporário junto — mas só o que ESTA
  // execução criou: com `wx`, um temporário que já existia faz o `writeFile`
  // falhar com `EEXIST`, e apagá-lo seria apagar o de outra execução (revisão
  // de segurança do #215, S2). Qualquer OUTRA falha da gravação (disco cheio no
  // meio) já criou o arquivo, parcial, e ele sai também (rodada 2, N1). O original só desaparece depois de existir uma cópia cifrada
  // que o adapter consegue ler.
  const gravar = deps.gravar ?? gravarSemSobrescrever
  let criado = false
  try {
    try {
      await gravar(temporario, deps.cifrar(bytes))
    } catch (erro) {
      criado = codigoDoErro(erro) !== 'EEXIST'
      throw erro
    }
    criado = true
    const conferencia = await deps.lerDeVolta(`${chave}${SUFIXO_TEMPORARIO}`)
    if (!conferencia || Buffer.compare(Buffer.from(conferencia), bytes) !== 0) {
      throw new Error(`Recusado: a releitura de ${JSON.stringify(chave)} não devolveu os bytes originais.`)
    }
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
    for (const entrada of await readdir(join(raiz, pasta.name), { withFileTypes: true })) {
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
  try {
    return (await lstat(caminho)).isFile()
  } catch (erro) {
    if (codigoDoErro(erro) === 'ENOENT') return false
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
