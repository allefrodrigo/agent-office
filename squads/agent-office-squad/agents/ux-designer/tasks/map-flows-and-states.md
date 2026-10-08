---
task: "Mapear fluxos e estados"
order: 1
input: |
  - prd: output/{run_id}/05-prd/vN/prd.md e output/{run_id}/06-prd-approval.md (ou o intake, se o PRD foi pulado)
  - ui_code: src/renderer/src/ui/* e src/renderer/src/state.ts — comportamento atual
  - voice: pipeline/data/product-voice.md
output: |
  - flows: fluxos passo a passo, tabela de estados por componente, atalhos, caminhos de recuperação e pontos de contato com o mundo (entrada da task specify-interface)
---

# Mapear fluxos e estados

Descreve como o usuário percorre a mudança na interface 2D, passo a passo, e enumera todos os estados de cada componente tocado — inclusive os que ninguém pede. Também marca onde a interface conversa com o mundo isométrico, para alinhar com o Iuri Isométrico.

## Process

1. Ler o PRD (FR e NFR que tocam a interface) e listar os gatilhos de entrada do fluxo: clique no avatar, clique na lista de agentes, atalho, toast, notificação do sistema, item da caixa de entrada, cartão do quadro.
2. Ler o comportamento atual no código: `panel.ts` (abrir, log, composer, ações), `dialog.ts` (cartões e `dismissed`), `hud.ts` (lista, dock, caixa de entrada), `board.ts`, e como o `State` dispara `render()` em `main.ts`.
3. Escrever cada fluxo como passos numerados: ação do usuário → resposta da interface → resposta do mundo (se houver) → próximo passo. Incluir a saída do fluxo (Esc, fechar, concluir).
4. Para cada componente tocado, preencher a tabela de estados: vazio, carregando, erro, sucesso, bloqueado (e "parcial" se a lista puder truncar). Cada célula diz o que aparece e o que o usuário pode fazer.
5. Mapear atalhos e conflitos com os existentes (`Esc`, `T`, `E`, `Q`, WASD, setas); um atalho novo não pode disparar com foco em `input`, `textarea` ou `select`.
6. Escrever caminhos de recuperação: o que acontece se o agente sai do escritório, se a sessão do terminal fecha, se o evento chega duas vezes, se a lista tem 30 itens.
7. Marcar os pontos de contato com o mundo (foco da câmera com `game.focusAgent`, balões, agente indo até a sala) e anotar o que precisa ser combinado com o world-spec.
8. Entregar o mapa para a task specify-interface.

## Output Format

```markdown
## Fluxos
### F1 · {nome}
1. {ação} → {interface} → {mundo} 
## Estados por componente
| Componente | Vazio | Carregando | Erro | Sucesso | Bloqueado/Parcial |
## Atalhos
| Tecla | Ação | Contexto | Conflito |
## Recuperação
## Pontos de contato com o mundo
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```markdown
## Fluxos
### F1 · Ver quem está ajudando o agente
1. Usuário clica no avatar da Ada (ou em "Ada" na lista à direita) → o painel abre (`panel.open`) → a câmera foca a Ada (`game.focusAgent`).
2. Abaixo da barra de contexto aparece a seção "Subagentes (2)" → cada linha mostra a descrição e "trabalhando".
3. Usuário aperta Tab até a lista e usa ↑/↓ → a linha focada destaca; Enter destaca o estagiário correspondente no mundo por 2 s.
4. Esc com foco fora do composer → fecha o painel (comportamento atual).

### F2 · Permissão pedida por um subagente
1. O subagente pede para rodar `npm test` → a Ada anda até a sala do usuário (comportamento atual).
2. O cartão abre com o título atual e uma linha extra: "Pedido de um subagente: Rodar a suíte de testes".

## Estados por componente
| Componente | Vazio | Carregando | Erro | Sucesso | Bloqueado/Parcial |
|---|---|---|---|---|---|
| Seção "Subagentes" do painel | oculta (sem subagentes) | — (eventos são instantâneos) | — | lista com descrição e status | mais de 8: mostra 8 e "e mais N" |
| Linha do subagente | — | — | "terminou com problema" + ícone ✗ | "trabalhando" ou "terminou" | descrição truncada em 140 caracteres |
| Cartão de permissão | — | — | — | linha "Pedido de um subagente" | subagente já terminou: cartão segue válido |

## Atalhos
| Tecla | Ação | Contexto | Conflito |
|---|---|---|---|
| ↑ / ↓ | navegar na lista de subagentes | foco dentro da lista | nenhum (WASD/setas só movem o avatar com foco no mundo) |
| Enter | destacar o estagiário no mundo | linha focada | nenhum |

## Recuperação
- O agente pai é demitido com subagentes ativos: a seção some junto com o painel; nenhum erro é mostrado.
- Evento `done` duplicado: a linha continua "terminou", sem piscar.

## Pontos de contato com o mundo
- Destaque do estagiário por 2 s ao apertar Enter (combinar visual com o world-spec §2).
```

## Quality Criteria

- [ ] Todo FR de interface aparece em pelo menos um fluxo.
- [ ] Tabela de estados sem células em branco (use "—" com sentido explícito quando não se aplica).
- [ ] Atalhos novos verificados contra os existentes e contra foco em campos de texto.
- [ ] Recuperação cobre saída do agente, fechamento de sessão, evento duplicado e listas longas.
- [ ] Pontos de contato com o mundo listados para alinhamento com o Iuri Isométrico.

## Veto Conditions

Rejeitar e refazer se QUALQUER condição for verdadeira:
1. Fluxo descrito só no caminho feliz.
2. Atalho novo que conflita com `Esc`, `T`, `E`, `Q`, WASD ou setas sem resolução.
3. Comportamento atual descrito sem ter lido o componente no código.
