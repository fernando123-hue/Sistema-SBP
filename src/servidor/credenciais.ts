import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * Hash de senha.
 *
 * ESTA É A FRONTEIRA. Todo o resto do sistema fala com `gerarHash` e
 * `conferirSenha` — ninguém mais sabe qual algoritmo está em uso. Trocar
 * scrypt por Argon2id, ou plugar um provedor de identidade externo, é
 * substituir este arquivo.
 *
 * Por que `scrypt` do próprio Node em vez de `bcrypt`/`argon2` do npm: os dois
 * são módulos nativos que precisam compilar na máquina de quem instala, e o
 * ganho sobre scrypt com parâmetros adequados não paga o custo de uma
 * dependência a mais na cadeia de suprimentos de um sistema que guarda dados
 * de associado.
 *
 * O hash gravado carrega os PARÂMETROS usados:
 *
 *     scrypt$16384$8$1$<sal em base64url>$<derivado em base64url>
 *
 * Sem isso, endurecer o custo depois invalidaria todas as senhas existentes.
 * Com isso, um hash antigo continua conferindo com os parâmetros dele, e a
 * senha é reescrita no formato novo quando a pessoa entra.
 */

const derivar = promisify(scrypt) as (
  senha: string,
  sal: Buffer,
  tamanho: number,
  opcoes: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

const ALGORITMO = 'scrypt'
const CUSTO_N = 16_384
const BLOCO_R = 8
const PARALELISMO_P = 1
const TAMANHO_DO_SAL = 16
const TAMANHO_DO_DERIVADO = 64

/** Node recusa a derivação se `maxmem` não cobrir `128 * N * r`. */
function memoriaNecessaria(n: number, r: number): number {
  return 128 * n * r * 2
}

/** Teto absoluto por derivação. Os parâmetros atuais pedem 32 MB; isto dá folga sem dar buraco. */
const TETO_DE_MEMORIA_BYTES = 256 * 1024 * 1024

export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(TAMANHO_DO_SAL)
  const derivado = await derivar(senha.normalize('NFKC'), sal, TAMANHO_DO_DERIVADO, {
    N: CUSTO_N,
    r: BLOCO_R,
    p: PARALELISMO_P,
    maxmem: memoriaNecessaria(CUSTO_N, BLOCO_R),
  })

  return [
    ALGORITMO,
    CUSTO_N,
    BLOCO_R,
    PARALELISMO_P,
    sal.toString('base64url'),
    derivado.toString('base64url'),
  ].join('$')
}

/**
 * Confere a senha contra o hash gravado.
 *
 * Nunca lança por hash malformado: um registro corrompido no banco deve
 * significar "não entra", não uma exceção que a rota traduz em 500 e conta ao
 * cliente que aquela conta existe e está quebrada.
 */
export async function conferirSenha(senha: string, hashGravado: string): Promise<boolean> {
  const partes = hashGravado.split('$')
  if (partes.length !== 6) return false

  const [algoritmo, textoN, textoR, textoP, salBase64, derivadoBase64] = partes as [
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  if (algoritmo !== ALGORITMO) return false

  const n = Number(textoN)
  const r = Number(textoR)
  const p = Number(textoP)
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  // Parâmetros vindos do banco entram direto no custo da derivação. Um valor
  // absurdo gravado por engano viraria uma requisição que trava o processo.
  if (n < 1024 || n > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return false
  // Limitar `N` e `r` isoladamente não basta: no teto de cada um, o PRODUTO
  // pede ~8 GB numa única derivação. Um hash corrompido derrubaria o processo
  // inteiro — todo mundo fora do sistema, não só o dono daquela conta.
  if (memoriaNecessaria(n, r) > TETO_DE_MEMORIA_BYTES) return false

  const esperado = Buffer.from(derivadoBase64, 'base64url')
  // O tamanho do derivado vira `keylen`: sem teto, um valor gigante gravado na
  // coluna é CPU queimada por tentativa de login.
  if (esperado.length === 0 || esperado.length > 256) return false

  try {
    const derivado = await derivar(senha.normalize('NFKC'), Buffer.from(salBase64, 'base64url'), esperado.length, {
      N: n,
      r,
      p,
      maxmem: memoriaNecessaria(n, r),
    })
    return timingSafeEqual(derivado, esperado)
  } catch {
    return false
  }
}

/**
 * Senha provisória sorteada.
 *
 * O sistema NUNCA pede ao gestor que invente a senha de alguém: pessoa
 * apressada escolhe `Sbp2026!` para a equipe inteira, e a senha provisória vira
 * senha permanente conhecida por todos. Sorteada com o gerador criptográfico,
 * ela é forte por construção e ninguém precisa pensar nela — o que também
 * ajuda a tratá-la como descartável, que é o que ela é.
 */
export function sortearSenhaProvisoria(): string {
  return randomBytes(12).toString('base64url')
}

/** `true` quando o hash foi gerado com parâmetros mais fracos que os atuais e vale reescrever. */
export function precisaRehash(hashGravado: string): boolean {
  const partes = hashGravado.split('$')
  if (partes.length !== 6) return true
  return partes[0] !== ALGORITMO || Number(partes[1]) < CUSTO_N
}

/**
 * Consome o mesmo tempo de uma conferência real.
 *
 * Sem isto, "e-mail não existe" responde em 1 ms e "senha errada" em ~80 ms:
 * o relógio conta quais e-mails estão cadastrados, mesmo com a mensagem de
 * erro idêntica nos dois casos.
 */
export async function gastarTempoDeConferencia(): Promise<void> {
  await conferirSenha('senha-inexistente', HASH_DE_REFERENCIA)
}

/** Hash descartável de valor fixo, só para dar trabalho equivalente à CPU. */
const HASH_DE_REFERENCIA = [
  ALGORITMO,
  CUSTO_N,
  BLOCO_R,
  PARALELISMO_P,
  Buffer.alloc(TAMANHO_DO_SAL, 7).toString('base64url'),
  Buffer.alloc(TAMANHO_DO_DERIVADO, 9).toString('base64url'),
].join('$')
