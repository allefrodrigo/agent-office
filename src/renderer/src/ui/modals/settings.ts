import { HAIR_COLORS, HAIR_STYLE_INFO, HAIR_STYLES, PANTS_COLORS, SHIRT_COLORS, SKIN_TONES } from '@shared/describe'
import { canAddFloor, floorNameFor } from '@shared/projects'
import type { Look, OfficePermissionMode, ProjectFloor } from '@shared/types'
import type { State } from '../../state'
import { DEFAULT_VIDEO, QUALITY_LABELS, QUALITY_PRESETS, qualityOf, type FpsLimit, type Quality, type ShadowMapSize, type VideoSettings } from '@shared/video'
import { openAccounts } from '../accounts'
import { dataSection } from '../data'
import { h, icon } from '../dom'
import { portrait } from '../portrait'
import { updateSettingsBox } from '../updates'
import { in2d, wardrobe } from '../wardrobe'
import { DEFAULT_CONTEXT_WARN_TOKENS } from '@shared/economy'
import { AUTOSTOP_MIN_RANGE, DEFAULT_MEETING_SETTINGS, LOW_MEMORY_GB, RETENTION_DAYS_RANGE } from '@shared/meetings'
import type { MeetingSettings } from '@shared/types'
import { cleanError, field, modal } from './common'
import { brainFields, meterField, MODES } from './brain'
import { brandFields } from './brand'

// Configurações: player, defaults, floors, accounts, data, video, meetings and the terminal bridge.

/** `section: 'bridge'` opens scrolled to the terminal sessions box (the dock's gear does it when the bridge fails). */
export function openSettings(root: HTMLElement, state: State, toast: (t: string, k?: 'info' | 'ok' | 'err') => void, opts: { section?: 'bridge'; tour?: () => void } = {}): void {
  const s = state.settings
  const look: Look = { ...s.playerLook }
  // 2D view: the wardrobe edits the look; the plain fields below stay for the 3D view
  const closet = in2d() ? wardrobe(s.playerLook) : null
  const name = h('input', { class: 'input', value: s.playerName, maxlength: 24 })
  const preview = h('div', { class: 'look-preview' })
  const renderPreview = () => preview.replaceChildren(portrait(look, 96))
  renderPreview()

  const swatches = (key: keyof Look, colors: string[]) => {
    const row = h('div', { class: 'swatches' })
    const paint = () => row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.c === look[key]))
    for (const c of colors) {
      const b = h('button', { class: 'swatch', style: `background:${c}`, type: 'button' })
      b.dataset.c = c
      b.addEventListener('click', () => {
        ;(look[key] as string) = c
        paint()
        renderPreview()
      })
      row.append(b)
    }
    paint()
    return row
  }
  const styles = h('div', { class: 'swatches' })
  for (let i = 0; i < HAIR_STYLES; i++) {
    const b = h('button', { class: 'swatch swatch-style', type: 'button', title: HAIR_STYLE_INFO[i].name, 'aria-label': HAIR_STYLE_INFO[i].name }, String(i + 1))
    b.classList.toggle('on', look.hairStyle === i)
    b.addEventListener('click', () => {
      look.hairStyle = i
      styles.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', j === i))
      renderPreview()
    })
    styles.append(b)
  }

  const pixel = h('select', { class: 'input' }, ...[2, 3, 4, 5].map((n) => h('option', { value: n }, `${n}px${n === 3 ? ' (padrão)' : ''}`)))
  pixel.value = String(s.pixelSize)
  const notify = h('input', { type: 'checkbox' }) as HTMLInputElement
  notify.checked = s.notifications
  const brain = brainFields({ model: s.defaultModel, effort: s.defaultEffort })
  const mode = h('select', { class: 'input' }, ...MODES.map((m) => h('option', { value: m.value }, m.label)))
  mode.value = s.defaultPermissionMode
  const maxSubs = h('input', { class: 'input', type: 'number', min: 0, max: 100, step: 1, value: s.maxSubagents ?? 10 }) as HTMLInputElement
  const budget = h('input', { class: 'input', type: 'number', min: 0, step: 0.5, value: s.agentBudgetUsd ?? 0 }) as HTMLInputElement
  const daily = h('input', { class: 'input', type: 'number', min: 0, step: 1, value: s.dailyBudgetUsd ?? 0 }) as HTMLInputElement
  // Typed in thousands of tokens: "200" reads better than "200000".
  const warnK = h('input', { class: 'input', type: 'number', min: 0, step: 50, value: Math.round((s.contextWarnTokens ?? DEFAULT_CONTEXT_WARN_TOKENS) / 1000) }) as HTMLInputElement
  const check = (on: boolean | undefined) => {
    const c = h('input', { type: 'checkbox' }) as HTMLInputElement
    c.checked = on !== false
    return c
  }
  const freshTicket = check(s.freshTicketSession)
  const freshSquad = check(s.freshSquadCycle)
  const coldAsk = check(s.coldConfirm)
  const updates = updateSettingsBox(root, s.updateChannel)
  const video = videoFields(state)
  const meetings = meetingFields(state, toast)

  const b = state.bridge
  const bridgeStatus = h(
    'div',
    { class: 'bridge-status' },
    h('span', { class: `dot ${b.installed && b.listening ? 'dot-working' : b.installed ? 'dot-error' : 'dot-stopped'}` }),
    b.installed ? (b.listening ? `Conectado (porta ${b.port})` : `Hooks instalados, servidor parado${b.error ? `: ${b.error}` : ''}`) : 'Desconectado',
  )
  // project floors: one per folder; renaming keeps whatever else a floor carries
  let floors: ProjectFloor[] = s.projects.map((p) => ({ ...p }))
  const floorList = h('div', { class: 'floor-list' })
  const addFloor = h('button', { class: 'btn', type: 'button' }, icon('plus', 15), 'Adicionar andar')
  const renderFloors = () => {
    floorList.replaceChildren(
      ...(floors.length
        ? floors.map((p, i) => {
            const nameIn = h('input', { class: 'input', value: p.name, maxlength: 32, title: 'Nome do andar' })
            nameIn.addEventListener('input', () => (floors[i] = { ...floors[i], name: nameIn.value }))
            const squads = state.squads.filter((q) => q.cwd === p.cwd).length
            const remove = h('button', { class: 'icon-btn', type: 'button', title: 'Tirar o andar: os agentes dele descem para o térreo' }, icon('x', 15))
            const set = (patch: Partial<ProjectFloor>) => (floors[i] = { ...floors[i], ...patch })
            remove.addEventListener('click', () => {
              floors = floors.filter((_, j) => j !== i)
              renderFloors()
            })
            return h(
              'div',
              { class: 'floor-row' },
              h('span', { class: 'floor-num' }, String(i + 1)),
              h('div', { class: 'floor-row-main' }, nameIn, h('span', { class: 'floor-row-path', title: p.cwd }, p.cwd, squads ? ` · ${squads === 1 ? '1 squad' : `${squads} squads`}` : ''), brandFields(floors[i], set, toast)),
              remove,
            )
          })
        : [h('div', { class: 'field-hint' }, 'Nenhum andar: o escritório fica só no térreo.')]),
    )
    addFloor.classList.toggle('hidden', !canAddFloor(floors))
    meetings.renderFloors(floors, (i, patch) => (floors[i] = { ...floors[i], ...patch }))
  }
  addFloor.addEventListener('click', async () => {
    const p = await window.office.pickFolder()
    if (!p) return
    if (floors.some((x) => x.cwd === p)) return toast('Essa pasta já tem um andar.', 'err')
    floors = [...floors, { id: `p-${Date.now().toString(36)}`, name: floorNameFor(p), cwd: p }]
    renderFloors()
  })
  renderFloors()

  const bridgeBtn = h('button', { class: 'btn' }, b.installed ? 'Desconectar' : 'Conectar')
  bridgeBtn.addEventListener('click', async () => {
    const next = b.installed ? await window.office.uninstallBridge() : await window.office.installBridge()
    toast(next.installed ? 'Sessões do terminal conectadas. Abra um novo `claude` no terminal.' : 'Sessões do terminal desconectadas.', 'ok')
    close()
  })

  const close = () => el.remove()
  const save = h('button', { class: 'btn btn-primary' }, icon('check', 16), 'Salvar')
  save.addEventListener('click', async () => {
    await window.office.saveSettings({
      playerName: name.value.trim() || 'Você',
      playerLook: closet ? closet.value() : look,
      pixelSize: Number(pixel.value),
      notifications: notify.checked,
      defaultModel: brain.model.value,
      defaultEffort: brain.value().effort ?? '',
      defaultPermissionMode: mode.value as OfficePermissionMode,
      // An emptied field keeps the current value instead of saving 0 (no limit).
      ...(numberField(maxSubs.value) !== undefined ? { maxSubagents: Math.max(0, Math.round(numberField(maxSubs.value)!)) } : {}),
      ...(numberField(budget.value) !== undefined ? { agentBudgetUsd: Math.max(0, numberField(budget.value)!) } : {}),
      ...(numberField(daily.value) !== undefined ? { dailyBudgetUsd: Math.max(0, numberField(daily.value)!) } : {}),
      ...(numberField(warnK.value) !== undefined ? { contextWarnTokens: Math.max(0, Math.round(numberField(warnK.value)! * 1000)) } : {}),
      freshTicketSession: freshTicket.checked,
      freshSquadCycle: freshSquad.checked,
      coldConfirm: coldAsk.checked,
      updateChannel: updates.value(),
      video: video.value(),
      meetings: meetings.value(),
      projects: floors.map((p) => ({ ...p, name: p.name.trim() || floorNameFor(p.cwd) })),
    })
    close()
  })

  const el = modal(
    'Configurações',
    [
      closet
        ? h('div', { class: 'look-editor-2d' }, field('Seu nome', name), closet.el)
        : h(
            'div',
            { class: 'look-editor' },
            preview,
            h(
              'div',
              { class: 'look-fields' },
              field('Seu nome', name),
              field('Pele', swatches('skin', SKIN_TONES)),
              field('Cabelo', swatches('hair', HAIR_COLORS)),
              field('Corte', styles),
              field('Camiseta', swatches('shirt', SHIRT_COLORS)),
              field('Calça', swatches('pants', PANTS_COLORS)),
            ),
          ),
      h('div', { class: 'field-row' }, field('Pixel art', pixel), field('Modelo padrão', brain.model), field('Permissão padrão', mode)),
      meterField('Esforço padrão', brain.meter),
      h('label', { class: 'check' }, notify, 'Notificar quando um agente precisar de mim ou terminar'),
      video.el,
      meetings.el,
      h(
        'div',
        { class: 'bridge-box' },
        h('div', { class: 'bridge-title' }, icon('users', 16), 'Andares por projeto'),
        h(
          'div',
          { class: 'field-hint' },
          'Cada andar é uma pasta de projeto: quem você contrata ou chama lá trabalha nela. Se a pasta tiver squads (squads/<code>/squad.yaml), a Diretoria do andar contrata um orquestrador com o squad.',
        ),
        floorList,
        addFloor,
      ),
      h(
        'div',
        { class: 'bridge-box' },
        h('div', { class: 'bridge-title' }, icon('coin', 16), 'Economia de tokens'),
        h(
          'div',
          { class: 'field-hint' },
          'O que mais gasta é a memória: cada chamada relê a conversa inteira, e um agente parado por mais de 1h paga para recarregá-la. Limpe entre tarefas diferentes.',
        ),
        h(
          'div',
          { class: 'field-row' },
          field('Teto de custo por dia (US$)', daily, 'O escritório todo. Ao chegar nele, os agentes param até a meia-noite. 0 = sem teto.'),
          field('Teto de custo por agente (US$)', budget, 'Ao chegar nele, o agente para e avisa. 0 = sem teto.'),
        ),
        h(
          'div',
          { class: 'field-row' },
          field('Avisar memória acima de (mil tokens)', warnK, 'O painel sugere limpar ou compactar. 0 = só pela porcentagem.'),
          field('Subagentes ao mesmo tempo', maxSubs, 'Por agente. 0 = limite do Claude Code (20).'),
        ),
        h('label', { class: 'check' }, freshTicket, 'Ticket delegado a um agente que já está aqui começa conversa nova'),
        h('label', { class: 'check' }, freshSquad, 'Cada ciclo de squad começa conversa nova (a memória do squad fica nos arquivos)'),
        h('label', { class: 'check' }, coldAsk, 'Perguntar antes de acordar um agente com memória fria e grande'),
      ),
      h(
        'div',
        { class: 'bridge-box' },
        h('div', { class: 'bridge-title' }, icon('users', 16), 'Contas do Claude'),
        h(
          'div',
          { class: 'field-hint' },
          `${s.accounts.length === 1 ? 'Uma conta' : `${s.accounts.length} contas`}. Adicione outras para separar projetos ou revezar quando uma bater o limite de 5h.`,
        ),
        h('div', { class: 'bridge-row' }, h('button', { class: 'btn', type: 'button', onclick: () => openAccounts(root, state, toast) }, 'Gerenciar contas')),
      ),
      h(
        'div',
        { class: 'bridge-box bridge-terminal' },
        h('div', { class: 'bridge-title' }, icon('terminal', 16), 'Sessões do Claude Code no terminal'),
        h(
          'div',
          { class: 'field-hint' },
          'Adiciona hooks HTTP em ~/.claude/settings.json. Cada `claude` aberto no terminal aparece como agente, e os pedidos de permissão vêm até você aqui. Com o app fechado, o terminal funciona normal.',
        ),
        h('div', { class: 'bridge-row' }, bridgeStatus, bridgeBtn),
      ),
      dataSection(toast),
      h(
        'div',
        { class: 'bridge-box bridge-help' },
        h('div', { class: 'bridge-title' }, icon('alert', 16), 'Ajuda'),
        h(
          'div',
          { class: 'field-hint' },
          'O app grava um log dos erros (sem prompts nem tokens). Ao relatar um problema, cole o diagnóstico: versão, sistema, versão do Claude Code e as últimas 200 linhas do log.',
        ),
        h(
          'div',
          { class: 'bridge-row bridge-row-start' },
          h('button', {
            class: 'btn',
            type: 'button',
            onclick: () => window.office.openLogs().catch((err) => toast(cleanError(err), 'err')),
          }, icon('folder', 14), 'Abrir pasta de logs'),
          h('button', {
            class: 'btn',
            type: 'button',
            onclick: async () => {
              try {
                await window.office.copyDiagnostics()
                toast('Diagnóstico copiado. Cole no relato do problema.', 'ok')
              } catch (err) {
                toast(cleanError(err), 'err')
              }
            },
          }, icon('copy', 14), 'Copiar diagnóstico'),
          opts.tour
            ? h('button', {
                class: 'btn',
                type: 'button',
                onclick: () => {
                  close()
                  opts.tour?.()
                },
              }, icon('walk', 14), 'Rever o tour')
            : null,
        ),
      ),
      updates.el,
    ],
    [
      h('span', { class: 'app-version', title: `Build de ${__APP_BUILD__}` }, `Agent Office v${__APP_VERSION__} · build ${__APP_BUILD__}`),
      h('button', { class: 'btn', onclick: close }, 'Cancelar'),
      save,
    ],
    close,
  )
  root.append(el)
  if (opts.section === 'bridge') el.querySelector('.bridge-terminal')?.scrollIntoView({ block: 'start' })
}

/**
 * Configurações → Vídeo (AO-29, AO-32). Picking a quality fills the other fields; changing one
 * by hand shows "Personalizada". Everything applies on Salvar, without restarting.
 */
function videoFields(state: State): { el: HTMLElement; value: () => VideoSettings } {
  const v: VideoSettings = { ...DEFAULT_VIDEO, ...state.settings.video }
  const quality = h(
    'select',
    { class: 'input' },
    ...(Object.keys(QUALITY_LABELS) as Quality[]).map((q) => h('option', { value: q }, QUALITY_LABELS[q])),
    h('option', { value: 'custom', disabled: true }, 'Personalizada'),
  )
  const fps = h('select', { class: 'input' }, h('option', { value: 30 }, '30 fps'), h('option', { value: 60 }, '60 fps'), h('option', { value: 0 }, 'Sem limite'))
  const shadows = h('select', { class: 'input' }, h('option', { value: 'off' }, 'Desligadas'), h('option', { value: 1024 }, 'Ligadas · 1024'), h('option', { value: 2048 }, 'Ligadas · 2048'))
  const effects = h('select', { class: 'input' }, h('option', { value: 'full' }, 'Completos'), h('option', { value: 'reduced' }, 'Reduzidos'))
  const battery = h('input', { type: 'checkbox' }) as HTMLInputElement
  battery.checked = v.batterySaver
  const view = h('select', { class: 'input' }, h('option', { value: 'iso' }, 'Isométrico 3D (padrão)'), h('option', { value: '2d' }, '2D pixel art (mais leve)'))
  view.value = v.view ?? 'iso'

  const value = (): VideoSettings => ({
    shadows: shadows.value !== 'off',
    shadowMapSize: (shadows.value === 'off' ? v.shadowMapSize : Number(shadows.value)) as ShadowMapSize,
    fpsLimit: Number(fps.value) as FpsLimit,
    effects: effects.value === 'reduced' ? 'reduced' : 'full',
    batterySaver: battery.checked,
    view: view.value === '2d' ? '2d' : 'iso',
  })
  const fill = (x: Omit<VideoSettings, 'batterySaver'>) => {
    fps.value = String(x.fpsLimit)
    shadows.value = x.shadows ? String(x.shadowMapSize) : 'off'
    effects.value = x.effects
  }
  const syncQuality = () => (quality.value = qualityOf(value()) ?? 'custom')
  fill(v)
  syncQuality()
  quality.addEventListener('change', () => {
    const preset = QUALITY_PRESETS[quality.value as Quality]
    if (preset) fill(preset)
  })
  for (const sel of [fps, shadows, effects]) sel.addEventListener('change', syncQuality)

  const now: string[] = []
  if (state.onBattery && v.batterySaver) now.push('Na bateria agora: o modo Economia está valendo até ligar na tomada.')
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) now.push('O sistema pede menos movimento: os efeitos ficam reduzidos.')
  const el = h(
    'div',
    { class: 'bridge-box' },
    h('div', { class: 'bridge-title' }, icon('gauge', 16), 'Vídeo'),
    h('div', { class: 'field-hint' }, 'Economia desliga as sombras, limita a 30 fps e reduz fumaça, faíscas e giroflex. Com o escritório parado ou a janela minimizada, o app já desenha menos sozinho.'),
    h('div', { class: 'field-row' }, field('Visual', view), field('Qualidade', quality)),
    h('div', { class: 'field-hint' }, '2D pixel art desenha o escritório em sprites planos, sem 3D: gasta menos placa de vídeo e memória, bom para computador mais fraco. Trocar o visual recarrega o escritório.'),
    h('div', { class: 'field-row' }, field('Limite de fps', fps), field('Sombras', shadows)),
    h('div', { class: 'field-row' }, field('Efeitos', effects)),
    h('label', { class: 'check' }, battery, 'Economia automática na bateria'),
    ...(now.length ? [h('div', { class: 'field-hint' }, now.join(' '))] : []),
  )
  return { el, value }
}

type MeetingFields = Omit<MeetingSettings, 'templates' | 'recipes'>

/**
 * Configurações → Reuniões (RN-13), in the mold of Vídeo. The model list comes from main (file
 * names only); the per-floor transcript switch edits the floors being saved with the form.
 */
function meetingFields(
  state: State,
  toast: (t: string, k?: 'info' | 'ok' | 'err') => void,
): { el: HTMLElement; value: () => MeetingFields; renderFloors: (floors: ProjectFloor[], set: (i: number, patch: Partial<ProjectFloor>) => void) => void } {
  const m: MeetingSettings = { ...DEFAULT_MEETING_SETTINGS, ...state.settings.meetings }
  const select = (options: [string, string][], current: string) => {
    const el = h('select', { class: 'input' }, ...options.map(([value, label]) => h('option', { value }, label))) as HTMLSelectElement
    el.value = current
    return el
  }
  const toggle = (on: boolean) => {
    const c = h('input', { type: 'checkbox' }) as HTMLInputElement
    c.checked = on
    return c
  }
  const number = (value: number, range: { min: number; max: number }, step: number) =>
    h('input', { class: 'input', type: 'number', min: range.min, max: range.max, step, value }) as HTMLInputElement

  const lang = select([['pt', 'Português'], ['en', 'Inglês'], ['auto', 'Detectar sozinho']], m.lang)
  const model = h('select', { class: 'input' }) as HTMLSelectElement
  const modelHint = h('span', { class: 'field-hint' }, 'Procurando os modelos instalados…')
  const sources = select([['mic+system', 'Microfone + áudio do computador'], ['mic', 'Só o microfone']], m.defaultSources)
  const ataModel = select([['sonnet', 'Sonnet (padrão)'], ['opus', 'Opus (mais caprichado, mais caro)']], m.ataModel)
  const autoStop = number(m.autoStopMin, AUTOSTOP_MIN_RANGE, 5)
  const retention = number(m.retentionDays, RETENTION_DAYS_RANGE, 30)
  const autoAta = toggle(m.autoAta)
  const dnd = toggle(m.doNotDisturb)
  const keepAudio = toggle(m.keepAudio)
  const readAtas = toggle(m.agentsReadAtas)

  // '' = the best one found; a saved model that is gone stays listed so saving does not drop it.
  const fillModels = (found: string[]) => {
    const names = m.whisperModel && !found.includes(m.whisperModel) ? [...found, m.whisperModel] : found
    model.replaceChildren(
      h('option', { value: '' }, found.length ? `O melhor achado (${found[0]})` : 'O melhor achado'),
      ...names.map((n) => h('option', { value: n }, found.includes(n) ? n : `${n} (não achado)`)),
    )
    model.value = m.whisperModel
  }
  fillModels([])
  window.office
    .meetingWhisperModels()
    .then(({ models, totalMemGb }) => {
      fillModels(models)
      const lines = [
        models.length
          ? `${models.length === 1 ? '1 modelo achado' : `${models.length} modelos achados`}. Para instalar outro, baixe o ggml-<nome>.bin para ~/.cache/whisper.`
          : 'Nenhum modelo achado. Baixe o ggml-small.bin para ~/.cache/whisper (huggingface.co/ggerganov/whisper.cpp).',
      ]
      if (totalMemGb > 0 && totalMemGb <= LOW_MEMORY_GB) lines.push(`Este computador tem ${totalMemGb} GB de memória: prefira o modelo base (ggml-base.bin).`)
      modelHint.textContent = lines.join(' ')
    })
    .catch((err) => {
      modelHint.textContent = 'Não consegui listar os modelos do whisper.'
      toast(cleanError(err), 'err')
    })

  const floorBox = h('div', { class: 'meeting-floors' })
  const renderFloors = (floors: ProjectFloor[], set: (i: number, patch: Partial<ProjectFloor>) => void) => {
    floorBox.replaceChildren(
      ...floors.map((p, i) => {
        const c = toggle(p.meetingsTranscripts === true)
        c.addEventListener('change', () => set(i, { meetingsTranscripts: c.checked }))
        return h('label', { class: 'check' }, c, `${p.name.trim() || floorNameFor(p.cwd)}: agentes podem ler as transcrições`)
      }),
    )
  }

  const int = (input: HTMLInputElement, range: { min: number; max: number }, fallback: number) => {
    const n = numberField(input.value)
    return n === undefined ? fallback : Math.min(range.max, Math.max(range.min, Math.round(n)))
  }
  const value = (): MeetingFields => ({
    lang: lang.value as MeetingSettings['lang'],
    whisperModel: model.value,
    defaultSources: sources.value as MeetingSettings['defaultSources'],
    autoAta: autoAta.checked,
    ataModel: ataModel.value as MeetingSettings['ataModel'],
    doNotDisturb: dnd.checked,
    autoStopMin: int(autoStop, AUTOSTOP_MIN_RANGE, m.autoStopMin),
    keepAudio: keepAudio.checked,
    retentionDays: int(retention, RETENTION_DAYS_RANGE, m.retentionDays),
    agentsReadAtas: readAtas.checked,
  })

  const el = h(
    'div',
    { class: 'bridge-box' },
    h('div', { class: 'bridge-title' }, icon('mic', 16), 'Reuniões'),
    h('div', { class: 'field-hint' }, 'A transcrição roda no seu computador com o whisper. Só o texto (notas, transcrição e ata) vai para o Claude, quando você gera a ata ou pergunta.'),
    h('div', { class: 'field-row' }, field('Idioma das reuniões', lang), field('Fontes padrão', sources)),
    field('Modelo do whisper', model, modelHint),
    h('div', { class: 'field-row' }, field('Modelo do Claude para a ata', ataModel), field('Encerrar sozinho após (minutos sem fala)', autoStop, `De ${AUTOSTOP_MIN_RANGE.min} a ${AUTOSTOP_MIN_RANGE.max}.`)),
    field('Apagar reuniões com mais de (dias)', retention, '0 = nunca apagar.'),
    h('label', { class: 'check' }, autoAta, 'Gerar a ata ao encerrar'),
    h('label', { class: 'check' }, dnd, 'Não perturbe durante a reunião: pedidos e entregas vão para a caixa de entrada'),
    h('label', { class: 'check' }, keepAudio, 'Guardar o áudio depois de transcrever'),
    h('label', { class: 'check' }, readAtas, 'Agentes podem ler as atas'),
    floorBox,
  )
  return { el, value, renderFloors }
}

/** A number typed in a settings field, or undefined when the field is empty or not a number. */
function numberField(raw: string): number | undefined {
  if (!raw.trim()) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}
