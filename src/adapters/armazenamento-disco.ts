import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { link, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import {
  ChaveDosAnexosMudouError,
  FalhaDeArmazenamento,
  type ArmazenamentoPort,
} from '../ports/armazenamento'
import { ambiente } from '../servidor/ambiente'
import { registrarLog } from '../servidor/observabilidade'

const CABECALHO_MAGICO = Buffer.from('SBP_ENC_v1!!') // 12 bytes
const TAMANHO_IV = 12 // 12 bytes para AES-GCM
const TAMANHO_TAG = 16 // 16 bytes para tag de autenticação

/**
 * Sentinela da chave: um arquivo na RAIZ, cifrado com a chave em uso, cujo
 * conteúdo é conhecido. Fica fora das subpastas de dois caracteres, então
 * nenhuma listagem de anexo (inclusive `scripts/recifrar-anexos.ts`) o conta.
 */
const NOME_DA_SENTINELA = '.sentinela-da-chave'
const CONTEUDO_DA_SENTINELA = Buffer.from('SBP-SENTINELA-DA-CHAVE-v1')

/**
 * A conferência de cada raiz, por chave, neste processo — a PROMESSA, não só o
 * resultado. Chaveado pelo `Buffer` que `chaveDeCifragem` memoriza: a mesma
 * chave é o mesmo objeto.
 *
 * Guardar a promessa em voo é o que fecha a corrida que a revisão reproduziu:
 * duas primeiras gravações simultâneas faziam cada uma a sua conferência, e a
 * que perdia o `EEXIST` relia a sentinela da outra AINDA SENDO ESCRITA —
 * acusando "a chave mudou", um 503 falso com a chave certa. Agora a segunda
 * espera a primeira. Conferência que falhou sai do mapa: a próxima confere de
 * novo, e falha de novo, se for o caso.
 */
const conferencias = new WeakMap<Buffer, Map<string, Promise<void>>>()

/**
 * Sistemas de arquivos sem link físico respondem com um destes.
 *
 * `EPERM` NÃO está aqui, e não é esquecimento. No Windows ele é o balde genérico
 * de `CreateHardLink`: antivírus segurando o temporário, ACL da pasta, arquivo
 * em uso. Tratá-lo como "disco sem link" degradava calado para a publicação não
 * atômica num disco que suporta link — reabrindo a corrida entre processos. Um
 * `EPERM` sobe como falha, com nome.
 */
const SEM_LINK_FISICO = new Set(['ENOTSUP', 'EXDEV', 'ENOSYS', 'EOPNOTSUPP'])

function codigoDoErro(erro: unknown): string | undefined {
  return erro instanceof Error && 'code' in erro && typeof erro.code === 'string'
    ? erro.code
    : undefined
}

function mensagemDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro)
}

/**
 * Armazenamento em disco local, cifrado em repouso (`H-D19`).
 *
 * Suficiente para o protótipo e para instalação em servidor único. Ao migrar
 * para nuvem, troca-se este adapter — nada fora dele sabe que existe sistema de
 * arquivos.
 *
 * A chave do ARQUIVO é sorteada, nunca derivada do nome do anexo. Nome de anexo
 * vem do remetente: usá-lo para montar caminho é convite a travessia de
 * diretório e a colisão entre dois `documento.pdf` de pessoas diferentes. O
 * nome original continua no banco, para exibir ao humano.
 *
 * Os arquivos são espalhados em subpastas de dois caracteres porque diretório
 * único com dezenas de milhares de entradas fica lento em qualquer sistema de
 * arquivos.
 *
 * ═══ CIFRAGEM ═══
 *
 * Os bytes vão para o disco em AES-256-GCM. GCM e não CBC porque GCM autentica:
 * um byte trocado no arquivo faz a leitura FALHAR, em vez de devolver lixo que
 * o resto do sistema trataria como documento. O IV é sorteado por arquivo — o
 * mesmo IV com a mesma chave duas vezes destrói a garantia do modo.
 */
/**
 * Deriva a chave de cifragem uma vez por segredo, e lembra.
 *
 * `scryptSync` é caro DE PROPÓSITO — é o que torna o segredo difícil de
 * quebrar por força bruta — e trava a thread enquanto roda. `criarArmazenamentoPort()`
 * constrói um adapter por requisição de ingestão: derivar ali dentro pagaria o
 * custo inteiro a cada chamada, sem ganho nenhum, porque o segredo é o mesmo.
 */
const chavesDerivadas = new Map<string, Buffer>()

export function chaveDeCifragem(segredo: string): Buffer {
  const lembrada = chavesDerivadas.get(segredo)
  if (lembrada) return lembrada
  const derivada = scryptSync(segredo, 'sbp-armazenamento-sal-v1', 32)
  chavesDerivadas.set(segredo, derivada)
  return derivada
}

/**
 * Cifra bytes no formato do arquivo em repouso.
 *
 * Função de módulo, e não método privado, porque a migração dos anexos legados
 * (`scripts/recifrar-anexos.ts`) precisa gravar EXATAMENTE este formato. Uma
 * segunda implementação divergiria em silêncio, e o anexo gravado por ela
 * simplesmente não abriria depois.
 *
 * Estrutura: CABECALHO_MAGICO (12b) + IV (12b) + TAG (16b) + CIFRADO (Nb).
 */
export function cifrarBytes(dados: Uint8Array, chave: Buffer): Buffer {
  const iv = randomBytes(TAMANHO_IV)
  const cifrador = createCipheriv('aes-256-gcm', chave, iv)
  const cifrado = Buffer.concat([cifrador.update(dados), cifrador.final()])
  return Buffer.concat([CABECALHO_MAGICO, iv, cifrador.getAuthTag(), cifrado])
}

export class ArmazenamentoEmDisco implements ArmazenamentoPort {
  readonly nome = 'disco'
  private readonly chaveCifra: Buffer

  constructor(
    private readonly raiz: string = ambiente().ARMAZENAMENTO_DIR,
    segredo: string = ambiente().ANEXOS_SECRET ?? ambiente().SESSAO_SECRET,
  ) {
    this.chaveCifra = chaveDeCifragem(segredo)
  }

  private caminhoDe(chave: string): string {
    const alvo = resolve(this.raiz, chave)
    const raizResolvida = resolve(this.raiz)

    // Defesa em profundidade. A chave é gerada aqui e não deveria escapar da
    // raiz — mas se algum dia vier de fora (banco corrompido, migração mal
    // feita), `../../etc/passwd` não pode virar caminho válido.
    if (alvo !== raizResolvida && !alvo.startsWith(raizResolvida + sep)) {
      throw new FalhaDeArmazenamento('resolver', `chave fora da raiz: "${chave}"`)
    }
    return alvo
  }

  private cifrar(dados: Uint8Array): Buffer {
    return cifrarBytes(dados, this.chaveCifra)
  }

  private decifrar(conteudo: Buffer): Uint8Array {
    const temCabecalho = conteudo.subarray(0, CABECALHO_MAGICO.length).equals(CABECALHO_MAGICO)

    // Cabeçalho presente mas o arquivo é curto demais para ter IV e tag: é
    // gravação interrompida (disco cheio, processo morto no meio do
    // `writeFile`), não anexo antigo. Tratar como "legado" devolveria o próprio
    // IV como se fosse o documento — bytes plausíveis, conteúdo nenhum, e a
    // tela mostrando um PDF corrompido sem ninguém saber de onde veio.
    if (temCabecalho && conteudo.length < CABECALHO_MAGICO.length + TAMANHO_IV + TAMANHO_TAG) {
      throw new FalhaDeArmazenamento(
        'decifrar',
        `anexo truncado: ${conteudo.length} bytes, mínimo de ${CABECALHO_MAGICO.length + TAMANHO_IV + TAMANHO_TAG} — a gravação foi interrompida`,
      )
    }

    if (!temCabecalho) {
      // Arquivo sem o cabeçalho: gravado antes de a cifragem existir. É lido em
      // texto puro DE PROPÓSITO — recusar aqui apagaria da operação todo anexo
      // anterior a esta versão, sem que ninguém tivesse decidido isso.
      //
      // O preço está registrado em `DECISOES.md § C`: enquanto este ramo
      // existir, um arquivo em texto puro colocado na pasta é aceito como
      // legítimo. Ele sai quando houver rotina de migração — e aí a ausência do
      // cabeçalho passa a ser erro.
      return new Uint8Array(conteudo)
    }

    const inicioIv = CABECALHO_MAGICO.length
    const inicioTag = inicioIv + TAMANHO_IV
    const inicioCifrado = inicioTag + TAMANHO_TAG

    const iv = conteudo.subarray(inicioIv, inicioTag)
    const tag = conteudo.subarray(inicioTag, inicioCifrado)
    const cifrado = conteudo.subarray(inicioCifrado)

    try {
      const decifrador = createDecipheriv('aes-256-gcm', this.chaveCifra, iv)
      decifrador.setAuthTag(tag)
      const decifrado = Buffer.concat([decifrador.update(cifrado), decifrador.final()])
      return new Uint8Array(decifrado)
    } catch (erro) {
      // A causa mais provável NÃO é adulteração: é a chave ter mudado. O
      // segredo de sessão pode ser rotacionado por rotina de segurança, e sem
      // `ANEXOS_SECRET` definido isso troca também a chave dos anexos. Quem
      // investiga precisa ler essa hipótese aqui, não descobrir depois.
      throw new FalhaDeArmazenamento(
        'decifrar',
        `anexo não decifra — chave errada (${'ANEXOS_SECRET'} mudou?) ou arquivo adulterado: ${mensagemDoErro(erro)}`,
      )
    }
  }

  /**
   * Confere que a chave em uso é a mesma que cifrou os anexos desta raiz.
   *
   * ═══ O QUE ISTO FECHA ═══
   *
   * Rotacionar `SESSAO_SECRET` sem fixar `ANEXOS_SECRET` troca a chave dos
   * anexos. Existiam a variável, o aviso e a mensagem de erro — mas a falha só
   * ACONTECIA quando alguém abria um documento antigo, meses depois, e pela
   * pessoa errada. E nesse meio-tempo cada anexo novo era gravado com a chave
   * nova: a pasta passava a guardar documentos em duas chaves, e nenhuma das
   * duas abria tudo. Achado 34 da auditoria de 08/09/2026.
   *
   * Roda antes da primeira leitura ou gravação de cada processo, para cada
   * chave: a chave errada falha ANTES de o primeiro documento ser gravado com
   * ela. Não é "na partida do servidor", e isso é escolha: a documentação do
   * Next não diz o que acontece quando `instrumentation.register` lança, nem se
   * ele roda no build — e uma conferência cujo efeito não se prova seria outra
   * promessa sem prova.
   *
   * Instalação antiga, sem sentinela: antes de adotar a chave atual, ela é
   * testada contra um anexo cifrado que já exista. Sem isso, a primeira
   * sentinela seria gravada justamente com a chave errada, e passaria a
   * confirmá-la para sempre.
   */
  async conferirChave(): Promise<void> {
    const raiz = resolve(this.raiz)
    let porRaiz = conferencias.get(this.chaveCifra)
    if (!porRaiz) {
      porRaiz = new Map()
      conferencias.set(this.chaveCifra, porRaiz)
    }

    const emCurso = porRaiz.get(raiz)
    if (emCurso) return emCurso

    const conferencia = this.conferirNoDisco(raiz)
    porRaiz.set(raiz, conferencia)
    const mapa = porRaiz
    conferencia.catch(() => mapa.delete(raiz))
    return conferencia
  }

  private async conferirNoDisco(raiz: string): Promise<void> {
    const caminho = join(raiz, NOME_DA_SENTINELA)
    const sentinela = await this.lerSeExistir(caminho)

    if (sentinela !== null) {
      if (!this.sentinelaConfere(sentinela)) throw this.chaveDosAnexosMudou()
      return
    }

    await this.conferirContraAnexoExistente(raiz)

    if (await this.publicarSentinela(raiz, caminho)) return

    // Outro PROCESSO publicou primeiro. Com link físico, o que ele expôs já
    // estava escrito inteiro; a sentinela dele vale — se for da mesma chave.
    const publicadaPorOutro = await this.lerSeExistir(caminho)
    if (publicadaPorOutro === null || !this.sentinelaConfere(publicadaPorOutro)) {
      throw this.chaveDosAnexosMudou()
    }
  }

  /**
   * Publica a sentinela de forma atômica. `true` quando ESTA chamada publicou.
   *
   * Grava inteira num arquivo temporário e só então a expõe com `link`, que
   * falha com `EEXIST` se o destino já existir. Assim ninguém — nem outro
   * processo — lê uma sentinela pela metade. A promessa compartilhada em
   * `conferirChave` resolve o caso de dentro do processo; isto, o de fora.
   *
   * LIMITE ASSUMIDO: disco sem link físico (alguns compartilhamentos de rede)
   * cai na gravação direta com `wx`, e aí a corrida entre DOIS PROCESSOS na
   * primeira gravação de uma pasta nova volta a ser possível. Não entre
   * requisições do mesmo servidor.
   */
  private async publicarSentinela(raiz: string, caminho: string): Promise<boolean> {
    const cifrada = this.cifrar(CONTEUDO_DA_SENTINELA)
    const temporario = join(raiz, `${NOME_DA_SENTINELA}.${randomBytes(8).toString('hex')}.tmp`)

    // UM `finally` para as duas etapas. A limpeza morava só na segunda: se a
    // gravação do temporário criasse o arquivo e falhasse no meio (disco cheio),
    // o `.tmp` ficava órfão na raiz — um a mais por tentativa, porque a
    // conferência que falhou volta a ser tentada com outro nome.
    try {
      try {
        await mkdir(raiz, { recursive: true })
        await writeFile(temporario, cifrada, { flag: 'wx' })
      } catch (erro) {
        throw new FalhaDeArmazenamento('conferir-chave', mensagemDoErro(erro))
      }

      try {
        await link(temporario, caminho)
        return true
      } catch (erro) {
        const codigo = codigoDoErro(erro)
        if (codigo === 'EEXIST') return false
        if (codigo === undefined || !SEM_LINK_FISICO.has(codigo)) {
          throw new FalhaDeArmazenamento('conferir-chave', mensagemDoErro(erro))
        }
        // Degradar é decisão com custo — a corrida entre processos volta a ser
        // possível —, então fica escrito. Sem este registro, "o disco não tem
        // link físico" seria uma hipótese presumida, nunca conferível.
        registrarLog('aviso', 'armazenamento sem link físico: sentinela publicada sem atomicidade entre processos', {
          codigo,
          raiz,
        })
        // `await`: sem ele o `finally` apagaria o temporário antes de a gravação
        // alternativa terminar.
        return await this.publicarSemLink(caminho, cifrada)
      }
    } finally {
      // Falhar ao APAGAR o temporário não pode esconder o erro que trouxe até
      // aqui — mas também não some: vira aviso.
      await rm(temporario, { force: true }).catch((erro: unknown) =>
        registrarLog('aviso', 'temporário da sentinela da chave não foi apagado', {
          temporario,
          causa: mensagemDoErro(erro),
        }),
      )
    }
  }

  private async publicarSemLink(caminho: string, cifrada: Buffer): Promise<boolean> {
    try {
      await writeFile(caminho, cifrada, { flag: 'wx' })
      return true
    } catch (erro) {
      if (codigoDoErro(erro) === 'EEXIST') return false
      throw new FalhaDeArmazenamento('conferir-chave', mensagemDoErro(erro))
    }
  }

  /** `null` quando o arquivo não existe; qualquer outra falha sobe com nome. */
  private async lerSeExistir(caminho: string): Promise<Buffer | null> {
    try {
      return await readFile(caminho)
    } catch (erro) {
      if (codigoDoErro(erro) === 'ENOENT') return null
      throw new FalhaDeArmazenamento('conferir-chave', mensagemDoErro(erro))
    }
  }

  /**
   * Entradas de um diretório; vazio quando ele não existe.
   *
   * Era `readdir(...).catch(() => [])`, que engolia QUALQUER falha — permissão
   * negada na raiz virava "pasta vazia", e a chave em uso seria adotada sem ser
   * conferida contra anexo nenhum. Ausente é resposta legítima; o resto não.
   */
  private async listarSeExistir(diretorio: string): Promise<string[]> {
    try {
      return await readdir(diretorio)
    } catch (erro) {
      if (codigoDoErro(erro) === 'ENOENT') return []
      throw new FalhaDeArmazenamento('conferir-chave', mensagemDoErro(erro))
    }
  }

  /**
   * As subpastas da raiz — só elas guardam anexo. Pelo TIPO da entrada, não pelo
   * nome: na raiz também moram a sentinela e os temporários dela, e um arquivo
   * solto qualquer não pode ser tratado como pasta.
   */
  private async listarSubpastas(raiz: string): Promise<string[]> {
    try {
      const entradas = await readdir(raiz, { withFileTypes: true })
      return entradas.filter((entrada) => entrada.isDirectory()).map((entrada) => entrada.name)
    } catch (erro) {
      if (codigoDoErro(erro) === 'ENOENT') return []
      throw new FalhaDeArmazenamento('conferir-chave', mensagemDoErro(erro))
    }
  }

  private sentinelaConfere(conteudo: Buffer): boolean {
    // Sem cabeçalho, `decifrar` devolveria o arquivo como "legado" — e uma
    // sentinela em texto puro colocada na pasta confirmaria qualquer chave.
    if (!conteudo.subarray(0, CABECALHO_MAGICO.length).equals(CABECALHO_MAGICO)) return false
    try {
      return Buffer.from(this.decifrar(conteudo)).equals(CONTEUDO_DA_SENTINELA)
    } catch {
      return false
    }
  }

  private async conferirContraAnexoExistente(raiz: string): Promise<void> {
    const minimo = CABECALHO_MAGICO.length + TAMANHO_IV + TAMANHO_TAG

    for (const pasta of await this.listarSubpastas(raiz)) {
      // Dentro da subpasta, TUDO é lido: uma pasta no lugar de um arquivo é
      // estrutura corrompida, e tem de falhar com nome, não ser pulada.
      for (const nome of await this.listarSeExistir(join(raiz, pasta))) {
        const conteudo = await this.lerSeExistir(join(raiz, pasta, nome))
        // Removido entre a listagem e a leitura — a retenção pode estar
        // expurgando agora. Não diz nada sobre a chave.
        if (conteudo === null) continue
        // Legado em texto puro e gravação truncada também não.
        const cifrado = conteudo.subarray(0, CABECALHO_MAGICO.length).equals(CABECALHO_MAGICO)
        if (!cifrado || conteudo.length < minimo) continue
        try {
          this.decifrar(conteudo)
          return
        } catch {
          throw this.chaveDosAnexosMudou()
        }
      }
    }
  }

  private chaveDosAnexosMudou(): ChaveDosAnexosMudouError {
    return new ChaveDosAnexosMudouError()
  }

  async guardar(bytes: Uint8Array, extensao: string): Promise<string> {
    await this.conferirChave()
    const sorteio = randomBytes(16).toString('hex')
    const seguraExtensao = /^\.[a-z0-9]{1,10}$/i.test(extensao) ? extensao.toLowerCase() : ''
    const chave = join(sorteio.slice(0, 2), `${sorteio}${seguraExtensao}`)
    const caminho = this.caminhoDe(chave)

    try {
      await mkdir(dirname(caminho), { recursive: true })
      // `wx` falha se o arquivo já existir: sobrescrever em silêncio esconderia
      // uma colisão de chave, que aqui significaria defeito no sorteio.
      await writeFile(caminho, this.cifrar(bytes), { flag: 'wx' })
    } catch (erro) {
      throw new FalhaDeArmazenamento('guardar', mensagemDoErro(erro))
    }

    return chave
  }

  async ler(chave: string): Promise<Uint8Array | null> {
    // Fora do `try`: chave trocada não é "arquivo ausente", e o `catch` abaixo
    // devolveria `null` para um ENOENT qualquer do caminho.
    await this.conferirChave()
    try {
      const conteudo = await readFile(this.caminhoDe(chave))
      return this.decifrar(conteudo)
    } catch (erro) {
      // Falha de decifragem já vem descrita: não pode ser confundida com
      // "arquivo ausente" no ramo abaixo.
      if (erro instanceof FalhaDeArmazenamento) throw erro
      // Ausente é resposta legítima: o arquivo pode ter sido expurgado pela
      // retenção. Qualquer OUTRA falha (permissão, disco) precisa subir alto,
      // porque significa que o arquivo existe e não conseguimos entregá-lo.
      if (codigoDoErro(erro) === 'ENOENT') return null
      throw new FalhaDeArmazenamento('ler', mensagemDoErro(erro))
    }
  }

  async remover(chave: string): Promise<void> {
    try {
      await rm(this.caminhoDe(chave), { force: true })
    } catch (erro) {
      throw new FalhaDeArmazenamento('remover', mensagemDoErro(erro))
    }
  }
}
