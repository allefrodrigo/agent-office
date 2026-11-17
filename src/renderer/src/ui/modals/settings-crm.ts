import { CRM_APP_DEFAULTS, CRM_LIMITS, type CrmAppSettings, type Pipeline, type PipelineStage, type StageKind } from '@shared/types'
import type { State } from '../../state'
import { connectBox } from '../crm/connect'
import { serverBox } from '../crm/server'
import type { Toast } from '../crm/util'
import { h, icon } from '../dom'
import { cleanError, field } from './common'

/** Days before the due date a recurrence makes the month's payment. */
const LEAD_DAYS = { min: 0, max: 28 }

const KIND_LABEL: Record<StageKind, string> = { open: 'Em andamento', won: 'Ganho', lost: 'Perdido' }

/**
 * Configurações → CRM (CR-07), only what phase 1 uses. The "CRM (prévia)" switch lives in
 * office.json (settings.crm); the recurrence lead days and the pipeline live in crm.json, so
 * they load with crmList and save through their own calls after the main settings.
 */
export function crmFields(state: State, toast: Toast): { el: HTMLElement; value: () => CrmAppSettings; save: () => Promise<void> } {
  const app: CrmAppSettings = { ...CRM_APP_DEFAULTS, ...state.settings.crm }
  const enabled = h('input', { type: 'checkbox' }) as HTMLInputElement
  enabled.checked = app.enabled

  const lead = h('input', { class: 'input', type: 'number', min: LEAD_DAYS.min, max: LEAD_DAYS.max, step: 1 }) as HTMLInputElement
  const stagesBox = h('div', { class: 'floor-list' })
  const addStage = h('button', { class: 'btn', type: 'button' }, icon('plus', 15), 'Adicionar etapa')
  const status = h('div', { class: 'field-hint' })
  // Fase 2: o WhatsApp. A caixa de conexão (CR-10) e a do servidor local (Docker ou Colima), que
  // só lê o docker quando a parte do CRM está aberta.
  let whatsapp: HTMLElement | null = null
  const whatsappSlot = h('div', { class: 'crm-settings-whatsapp' })
  const showWhatsapp = () => {
    if (whatsapp) return
    whatsapp = h(
      'div',
      { class: 'crm-settings-whatsapp' },
      h('div', { class: 'field-label' }, 'WhatsApp'),
      connectBox({ toast }).el,
      serverBox({ toast }).el,
    )
    whatsappSlot.replaceWith(whatsapp)
  }
  const details = h(
    'div',
    { class: 'crm-settings-details' },
    field('Criar o pagamento da recorrência (dias antes do vencimento)', lead, `De ${LEAD_DAYS.min} a ${LEAD_DAYS.max}. Padrão: 10.`),
    h('div', { class: 'field-label' }, 'Etapas do funil'),
    stagesBox,
    h('div', { class: 'bridge-row bridge-row-start' }, addStage),
    status,
    whatsappSlot,
  )

  // What crm.json had when the window opened; null until crmList answers (or when it failed).
  let saved: { lead: number; pipeline: Pipeline } | null = null
  let pipeline: Pipeline | null = null
  let loading: Promise<void> | null = null

  const renderStages = () => {
    if (!pipeline) return stagesBox.replaceChildren()
    const p = pipeline
    stagesBox.replaceChildren(
      ...p.stages.map((s, i) => {
        const name = h('input', {
          class: 'input',
          value: s.name,
          maxlength: CRM_LIMITS.stageName,
          'aria-label': `Nome da etapa ${i + 1}`,
        }) as HTMLInputElement
        name.addEventListener('input', () => (p.stages[i] = { ...p.stages[i], name: name.value }))
        // Won and lost close a deal: the board needs one of each, so only open stages come out.
        const remove =
          s.kind === 'open'
            ? h(
                'button',
                {
                  class: 'icon-btn',
                  type: 'button',
                  title: 'Tirar a etapa (só sem negócios nela)',
                  'aria-label': `Tirar a etapa ${s.name}`,
                },
                icon('x', 15),
              )
            : null
        remove?.addEventListener('click', () => {
          p.stages = p.stages.filter((_, j) => j !== i)
          renderStages()
        })
        return h(
          'div',
          { class: 'floor-row' },
          h('span', { class: 'floor-num' }, String(i + 1)),
          h('div', { class: 'floor-row-main' }, name, h('span', { class: 'floor-row-path' }, KIND_LABEL[s.kind])),
          remove,
        )
      }),
    )
    addStage.classList.toggle('hidden', p.stages.length >= CRM_LIMITS.stages)
  }

  addStage.addEventListener('click', () => {
    if (!pipeline) return
    const stage: PipelineStage = { id: `etapa-${Date.now().toString(36)}`, name: 'Nova etapa', kind: 'open' }
    // New stages go before the closing ones (won, lost), at the end of the open part.
    const at = pipeline.stages.findIndex((s) => s.kind !== 'open')
    pipeline.stages.splice(at < 0 ? pipeline.stages.length : at, 0, stage)
    renderStages()
  })

  const load = () => {
    loading ??= window.office
      .crmList()
      .then((data) => {
        const p = data.pipelines[0]
        if (!p) throw new Error('O CRM não tem funil. Feche e abra o app para ele recriar o padrão.')
        saved = { lead: data.settings.recurrenceLeadDays, pipeline: structuredClone(p) }
        pipeline = structuredClone(p)
        lead.value = String(saved.lead)
        status.textContent = ''
        renderStages()
      })
      .catch((err) => {
        status.textContent = `Não consegui ler o CRM: ${cleanError(err)}`
        loading = null
      })
    return loading
  }

  const showDetails = () => {
    details.classList.toggle('hidden', !enabled.checked)
    if (enabled.checked) {
      void load()
      showWhatsapp()
    }
  }
  enabled.addEventListener('change', showDetails)
  showDetails()

  const value = (): CrmAppSettings => ({ enabled: enabled.checked })

  /** Saves what changed in crm.json; throws the main process's message, which the window shows. */
  const save = async () => {
    if (!saved || !pipeline) return
    const typed = Number(lead.value)
    const days =
      lead.value.trim() && Number.isFinite(typed) ? Math.min(LEAD_DAYS.max, Math.max(LEAD_DAYS.min, Math.round(typed))) : saved.lead
    if (days !== saved.lead) {
      await window.office.saveCrmSettings({ recurrenceLeadDays: days })
      saved.lead = days
    }
    const next: Pipeline = { ...pipeline, stages: pipeline.stages.map((s) => ({ ...s, name: s.name.trim() || KIND_LABEL[s.kind] })) }
    if (JSON.stringify(next) !== JSON.stringify(saved.pipeline)) {
      saved.pipeline = structuredClone(await window.office.savePipeline(next))
    }
  }

  const el = h(
    'div',
    { class: 'bridge-box' },
    h('div', { class: 'bridge-title' }, icon('users', 16), 'CRM'),
    h(
      'div',
      { class: 'field-hint' },
      'Clientes, negócios, pagamentos e as conversas de WhatsApp do escritório. Os dados ficam em crm.json, nesta máquina, e entram nos backups. Os bots de CRM chegam nas próximas versões.',
    ),
    h('label', { class: 'check' }, enabled, 'CRM (prévia): mostrar o botão CRM e abrir a tela com V'),
    details,
  )
  return { el, value, save }
}
