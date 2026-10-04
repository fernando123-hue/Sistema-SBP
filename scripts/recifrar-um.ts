import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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

export interface DependenciasDaRecifragem {
  cifrar: (bytes: Buffer) => Buffer
  /** Lê o temporário pelo adapter de verdade — é o que prova que ele abre. */
  lerDeVolta: (chaveTemporaria: string) => Promise<Uint8Array | null>
}

export async function recifrarUm(raiz: string, chave: string, deps: DependenciasDaRecifragem): Promise<void> {
  const caminho = join(raiz, chave)
  const temporario = `${caminho}${SUFIXO_TEMPORARIO}`
  const bytes = await readFile(caminho)

  // Qualquer falha antes da troca leva o temporário junto. O original só
  // desaparece depois de existir uma cópia cifrada que o adapter consegue ler.
  try {
    await writeFile(temporario, deps.cifrar(bytes))
    const conferencia = await deps.lerDeVolta(`${chave}${SUFIXO_TEMPORARIO}`)
    if (!conferencia || Buffer.compare(Buffer.from(conferencia), bytes) !== 0) {
      throw new Error(`Recusado: a releitura de "${chave}" não devolveu os bytes originais.`)
    }
    await rename(temporario, caminho)
  } catch (erro) {
    await rm(temporario, { force: true })
    throw erro
  }
}

/**
 * Apaga os temporários de uma execução que MORREU no meio (energia, `kill`) —
 * o caso que nenhum `catch` alcança. É seguro: o temporário só vira o original
 * pelo `rename`, então, se ele ainda existe, o original está ao lado, intacto.
 * Devolve as chaves apagadas, para o script dizer quais.
 */
export async function limparSobras(raiz: string): Promise<string[]> {
  const apagadas: string[] = []
  let pastas
  try {
    pastas = await readdir(raiz, { withFileTypes: true })
  } catch (erro) {
    // Pasta que ainda não existe não tem sobra; qualquer outra falha sobe.
    if (erro instanceof Error && 'code' in erro && erro.code === 'ENOENT') return []
    throw erro
  }
  for (const pasta of pastas) {
    if (!pasta.isDirectory()) continue
    for (const nome of await readdir(join(raiz, pasta.name))) {
      if (!nome.endsWith(SUFIXO_TEMPORARIO)) continue
      await rm(join(raiz, pasta.name, nome), { force: true })
      apagadas.push(`${pasta.name}/${nome}`)
    }
  }
  return apagadas
}
