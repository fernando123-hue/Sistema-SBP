/**
 * Recifra os anexos que ainda estão em texto puro no disco (`H-D19`).
 *
 * A cifragem em repouso entrou sem rotina de migração, e o adapter aceita
 * arquivo sem o cabeçalho `SBP_ENC_v1!!` como legado — decisão registrada em
 * `DECISOES.md § AT-12`. A consequência que ninguém tinha medido: **todo anexo
 * gravado antes daquela versão continua legível com `cat`**. Um backup copiado
 * para disco externo leva os PDFs de associado abertos, enquanto a dívida
 * aparece como "cifragem em repouso — feito".
 *
 * Esta rotina fecha o buraco:
 *
 *   npm run anexos:conferir     lista quantos ainda estão em texto puro
 *   npm run anexos:recifrar     regrava cifrado, um por um
 *
 * ═══ POR QUE ESCREVE EM ARQUIVO NOVO E SÓ DEPOIS TROCA ═══
 *
 * Recifrar no lugar significa apagar o original antes de o cifrado estar no
 * disco. Uma queda de energia no meio deixaria o anexo perdido — e é documento
 * de associado, não cache. Aqui o cifrado é escrito ao lado, conferido lendo de
 * volta pelo próprio adapter, e só então substitui o original.
 */

import { readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ArmazenamentoEmDisco } from '../src/adapters/armazenamento-disco'
import { ambiente } from '../src/servidor/ambiente'

const CABECALHO_MAGICO = Buffer.from('SBP_ENC_v1!!')

/** Todas as chaves de anexo sob a raiz: `xx/arquivo.ext`, dois níveis. */
async function chavesDeAnexo(raiz: string): Promise<string[]> {
  const pastas = await readdir(raiz, { withFileTypes: true })
  const chaves: string[] = []
  for (const pasta of pastas) {
    if (!pasta.isDirectory()) continue
    for (const arquivo of await readdir(join(raiz, pasta.name))) {
      chaves.push(`${pasta.name}/${arquivo}`)
    }
  }
  return chaves
}

async function estaEmTextoPuro(caminho: string): Promise<boolean> {
  const inicio = await readFile(caminho)
  return !inicio.subarray(0, CABECALHO_MAGICO.length).equals(CABECALHO_MAGICO)
}

async function principal(): Promise<void> {
  const raiz = ambiente().ARMAZENAMENTO_DIR
  const somenteConferir = process.argv.includes('--conferir')
  const armazenamento = new ArmazenamentoEmDisco(raiz)

  // ═══ PASTA ILEGÍVEL NÃO É "NENHUM ANEXO" (achado N-24) ═══
  //
  // Era `.catch(() => [])`. Permissão negada, caminho errado em
  // `ARMAZENAMENTO_DIR`, disco desmontado — tudo virava lista vazia, e o
  // comando respondia "0 anexo(s) no disco; 0 ainda em texto puro". A
  // conferência que existe para dizer se os anexos estão cifrados passava a
  // dizer "está tudo certo" exatamente quando não conseguia olhar.
  //
  // Pasta INEXISTENTE é resposta legítima (instalação nova, nenhum anexo
  // recebido ainda) e continua valendo zero. Qualquer outra falha sobe.
  const chaves = await chavesDeAnexo(raiz).catch((erro: unknown) => {
    if (erro !== null && typeof erro === 'object' && (erro as { code?: unknown }).code === 'ENOENT') {
      process.stdout.write(`A pasta de anexos ainda não existe: ${raiz}\n`)
      return [] as string[]
    }
    throw new Error(
      `Não foi possível ler a pasta de anexos (${raiz}): ` +
        `${erro instanceof Error ? erro.message : String(erro)}. ` +
        `Nada foi conferido — e "nada conferido" não é o mesmo que "nada a corrigir".`,
    )
  })
  const emTextoPuro: string[] = []
  for (const chave of chaves) {
    if (await estaEmTextoPuro(join(raiz, chave))) emTextoPuro.push(chave)
  }

  process.stdout.write(
    `${chaves.length} anexo(s) no disco; ${emTextoPuro.length} ainda em texto puro.\n`,
  )

  if (somenteConferir || emTextoPuro.length === 0) return

  let recifrados = 0
  for (const chave of emTextoPuro) {
    const caminho = join(raiz, chave)
    const temporario = `${caminho}.recifrando`
    const bytes = await readFile(caminho)

    // Grava ao lado, confere lendo de volta, e só então troca. O original só
    // desaparece depois de existir uma cópia cifrada que o adapter consegue ler.
    await writeFile(temporario, cifrarComOAdapter(armazenamento, bytes))
    const conferencia = await new ArmazenamentoEmDisco(raiz).ler(`${chave}.recifrando`)
    if (!conferencia || Buffer.compare(Buffer.from(conferencia), bytes) !== 0) {
      await unlink(temporario)
      throw new Error(`Recusado: a releitura de "${chave}" não devolveu os bytes originais.`)
    }

    await rename(temporario, caminho)
    recifrados += 1
  }

  process.stdout.write(`${recifrados} anexo(s) recifrado(s).\n`)
}

/**
 * Usa a cifragem do próprio adapter, em vez de repetir o algoritmo aqui.
 *
 * Duas implementações do mesmo formato divergem em silêncio — e a segunda
 * envelhece porque ninguém lembra que existe. É a `H-D7` na camada onde custaria
 * mais caro: um anexo gravado com formato ligeiramente diferente não abre mais.
 */
function cifrarComOAdapter(armazenamento: ArmazenamentoEmDisco, bytes: Buffer): Buffer {
  return (armazenamento as unknown as { cifrar(dados: Uint8Array): Buffer }).cifrar(bytes)
}

principal().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
  process.exitCode = 1
})
