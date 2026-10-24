import { mediaUrl } from '@shared/creative'
import { EMPTY_BRAND, HEX, MAX_BRAND_COLORS, brandIsSet, type BrandFont, type BrandKit } from '@shared/social'
import type { ProjectFloor } from '@shared/types'
import { h, icon } from '../dom'
import { cleanError } from '../modals'
import type { Widget } from './widget'

// Marca: the floor's brand kit (name, colors, font, logo, voice, visual direction). Image, art,
// carousel and caption nodes apply it unless their "Kit de marca" says otherwise.

const FONTS: [BrandFont, string][] = [
  ['sans', 'Moderna'],
  ['condensada', 'Condensada (impacto)'],
  ['serif', 'Serifada (editorial)'],
]

export function brandEditor(floor: ProjectFloor, w: Widget, toast: (t: string, k?: 'info' | 'ok' | 'err') => void): void {
  let kit: BrandKit = { ...EMPTY_BRAND }
  let timer: ReturnType<typeof setTimeout> | undefined
  const form = h('div', { class: 'st-brand' })
  w.body.append(form)

  const summary = () => {
    w.setSummary(brandIsSet(kit) ? kit.nome || `${kit.cores.length} cor(es)` : 'vazio', brandIsSet(kit) ? 'ok' : '')
    const pill = w.el.querySelector('.st-w-pill')
    pill?.querySelector('.st-brand-dots')?.remove()
    if (kit.cores.length) pill?.append(h('span', { class: 'st-brand-dots', 'aria-hidden': 'true' }, ...kit.cores.map((c) => h('i', { style: `background:${c}` }))))
  }

  const save = (now = false) => {
    clearTimeout(timer)
    const run = () =>
      void window.office
        .saveBrand(floor.id, kit)
        .then((k) => {
          const logoChanged = k.logo !== kit.logo
          kit = k
          summary()
          if (logoChanged) render()
        })
        .catch((err) => toast(cleanError(err), 'err'))
    if (now) run()
    else timer = setTimeout(run, 500)
  }

  const field = (label: string, control: HTMLElement, hint?: string) => h('label', { class: 'st-field' }, h('span', {}, label), control, hint ? h('small', { class: 'st-brand-hint' }, hint) : null)

  const render = () => {
    const name = h('input', { class: 'input st-input', value: kit.nome, maxlength: 60, placeholder: 'Ex.: FoodWise' })
    name.addEventListener('input', () => {
      kit.nome = name.value
      save()
    })
    const colors = h(
      'div',
      { class: 'st-brand-colors' },
      ...kit.cores.map((c, i) => {
        const inp = h('input', { type: 'color', value: c, title: `${c} — clique para trocar`, 'aria-label': `Cor ${i + 1} da marca` })
        inp.addEventListener('change', () => {
          if (HEX.test(inp.value)) kit.cores[i] = inp.value.toLowerCase()
          save(true)
          render()
        })
        const x = h('button', { class: 'st-brand-x', title: 'Tirar a cor', 'aria-label': `Tirar ${c}` }, icon('x', 10))
        x.addEventListener('click', () => {
          kit.cores = kit.cores.filter((_, k) => k !== i)
          save(true)
          render()
        })
        return h('span', { class: `st-brand-color${i === 0 ? ' main' : ''}` }, inp, x)
      }),
      kit.cores.length < MAX_BRAND_COLORS
        ? h(
            'button',
            {
              class: 'st-brand-add',
              title: kit.cores.length ? 'Adicionar uma cor' : 'Adicionar a cor principal',
              'aria-label': 'Adicionar cor',
              onclick: () => {
                kit.cores = [...kit.cores, kit.cores.length ? '#f5b94a' : '#d97757']
                save(true)
                render()
              },
            },
            icon('plus', 13),
          )
        : null,
    )
    const font = h('select', { class: 'input st-input' }, ...FONTS.map(([v, l]) => h('option', { value: v }, l)))
    font.value = kit.fonte
    font.addEventListener('change', () => {
      kit.fonte = font.value as BrandFont
      save(true)
    })
    const logo = h(
      'div',
      { class: 'st-brand-logo' },
      kit.logo ? h('img', { src: mediaUrl(kit.logo), alt: 'Logo da marca' }) : h('span', { class: 'st-note' }, 'Sem logo'),
      h(
        'button',
        {
          class: 'btn btn-small',
          onclick: async () => {
            const [p] = await window.office.pickMedia('image', false)
            if (!p) return
            kit.logo = p
            save(true)
          },
        },
        icon('image', 13),
        kit.logo ? 'Trocar' : 'Escolher logo',
      ),
      kit.logo
        ? h(
            'button',
            {
              class: 'btn btn-small',
              onclick: () => {
                kit.logo = ''
                save(true)
                render()
              },
            },
            'Tirar',
          )
        : null,
    )
    const tom = h('textarea', { class: 'input st-input', rows: 2, maxlength: 600, placeholder: 'Ex.: direto, próximo, sem jargão, emoji só no CTA.' })
    tom.value = kit.tom
    tom.addEventListener('input', () => {
      kit.tom = tom.value
      save()
    })
    const visual = h('textarea', { class: 'input st-input', rows: 2, maxlength: 600, placeholder: 'Ex.: fotos reais com luz natural, fundo limpo, nada de ilustração 3D.' })
    visual.value = kit.visual
    visual.addEventListener('input', () => {
      kit.visual = visual.value
      save()
    })
    form.replaceChildren(
      field('Nome', name),
      field('Cores', colors, 'A primeira é a principal: vira a cor do "Tema marca" e das chamadas.'),
      field('Fonte dos títulos', font, 'Vale quando a arte usa "Fonte do kit de marca".'),
      h('div', { class: 'st-field' }, h('span', {}, 'Logo'), logo, h('small', { class: 'st-brand-hint' }, 'Entra nas artes e na capa e no fim dos carrosséis sem logo ligado.')),
      field('Tom de voz', tom, 'As legendas usam quando o nó não tem tom próprio.'),
      field('Direção visual', visual, 'Vai junto em toda imagem gerada.'),
    )
  }

  void window.office
    .loadBrand(floor.id)
    .then((k) => {
      kit = k
      render()
      summary()
    })
    .catch((err) => form.replaceChildren(h('div', { class: 'st-error' }, icon('alert', 14), h('span', {}, cleanError(err)))))
}
