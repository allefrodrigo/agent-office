import { conversationMarkdown, exportFileName, finalReport } from '@shared/export-md'
import type { State } from '../state'
import { cleanError } from './modals'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/** Salva a conversa do agente em .md: o main abre o diálogo de salvar e grava o arquivo. */
export async function exportConversation(state: State, agentId: string, toast: Toast): Promise<void> {
  const a = state.agents.get(agentId)
  if (!a) return
  try {
    const log = await state.log(agentId)
    const md = conversationMarkdown({ agent: a.name, cwd: a.cwd, model: a.model, costUsd: a.costUsd, startedAt: a.createdAt, sessionId: a.sessionId }, log)
    const path = await window.office.saveMarkdown(exportFileName(a.name, a.cwd), md)
    if (path) toast(`Conversa de ${a.name} salva em ${path}`, 'ok')
  } catch (err) {
    toast(cleanError(err), 'err')
  }
}

/** Copia só o resultado final do agente (o último que ele entregou). */
export async function copyReport(state: State, agentId: string, toast: Toast): Promise<void> {
  const a = state.agents.get(agentId)
  if (!a) return
  const pending = [...state.results.values()].filter((r) => r.agentId === agentId).sort((x, y) => y.createdAt - x.createdAt)[0]
  const text = finalReport(await state.log(agentId)) || pending?.text.trim() || ''
  if (!text) return toast(`${a.name} ainda não entregou um resultado.`, 'info')
  try {
    await navigator.clipboard.writeText(text)
    toast('Relatório copiado.', 'ok')
  } catch (err) {
    toast(cleanError(err), 'err')
  }
}

/** Salva um Markdown já pronto (relatório por projeto). */
export async function saveMarkdown(fileName: string, md: string, toast: Toast): Promise<void> {
  try {
    const path = await window.office.saveMarkdown(fileName, md)
    if (path) toast(`Relatório salvo em ${path}`, 'ok')
  } catch (err) {
    toast(cleanError(err), 'err')
  }
}
