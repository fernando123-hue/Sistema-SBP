import { redirect } from 'next/navigation'

import { atorAtual } from '../servidor/sessao'

export default async function Raiz() {
  const ator = await atorAtual()
  if (!ator) redirect('/entrar')

  // Operador cai na distribuição; colaborador, na própria fila.
  redirect(ator.papel === 'colaborador' ? '/fila' : '/distribuicao')
}
