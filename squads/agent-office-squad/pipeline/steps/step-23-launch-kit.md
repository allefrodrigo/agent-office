---
execution: inline
agent: devrel
tasks:
  - build-launch-kit
outputFile: squads/agent-office-squad/output/23-launch/launch-kit.md
---

# Step 23: Kit de lançamento e comunidade — 📣 Camila Comunidade

## Context Loading

Caminhos de output: `squads/agent-office-squad/output/{run_id}/…`. Em pastas de agente, use a maior `vN/` que contém o arquivo (run-conventions §2).

- `_opensquad/_memory/company.md` — proposta de valor, público, tom de voz e canais
- `squads/agent-office-squad/_memory/memories.md` — preferências e proibições de comunicação
- `squads/agent-office-squad/pipeline/data/run-conventions.md` — protocolo de pulo
- `output/{run_id}/02-plan/vN/run-plan.md` e `output/{run_id}/03-plan-approval.md` — track e condição "entrega relevante para usuários"
- `output/{run_id}/05-prd/vN/prd.md` e `output/{run_id}/04-discovery/vN/discovery-brief.md` — problema, público e métricas (se existirem)
- `output/{run_id}/19-docs/vN/docs-report.md` — notas de versão aprovadas
- `output/{run_id}/22-publish/vN/publish-report.md` — o que foi de fato publicado (PR, tag, release)
- `output/{run_id}/17-qa/vN/qa-gate.md` e `output/{run_id}/18-security/vN/security-gate.md` — limitações conhecidas
- `squads/agent-office-squad/pipeline/data/benchmark-landscape.md` — concorrentes e espaço de posicionamento
- `squads/agent-office-squad/pipeline/data/product-dossier.md` — diferenciais e público
- `squads/agent-office-squad/pipeline/data/product-voice.md` — voz e termos proibidos

## Instructions

### Gate do track

Aplique o protocolo de pulo (run-conventions §3). `release`: roda sempre. `iniciativa`: roda se o run-plan marcou a entrega como relevante para usuários. `entrega`, `bugfix` e `discovery`: pulam. Se nada foi publicado no step-22, o kit é escrito como "pronto para quando publicar" e diz isso no topo.

### Process

1. **Defina para quem e a mensagem-chave.** Uma frase que diga o benefício e o diferencial frente ao benchmark (governança espacial: o agente vem até você), sem adjetivo vazio.
2. **Liste requisitos e limitações** com honestidade: Claude Code instalado e logado, plataformas verificadas e não verificadas, CONCERNS e CONDITIONS em aberto. Nada de prometer o que não está no PR/release.
3. **Escreva os rascunhos** em pt-BR: post curto (até 280 caracteres, cabe no X), post para LinkedIn (até 6 linhas) e thread de 4–6 posts com o passo a passo.
4. **Roteiro de demo de 60 s** com marcação de tempo, gravado em instância isolada e modo demo (`AGENT_OFFICE_DATA_DIR` temporário), sem dados pessoais nem caminhos reais na tela.
5. **Checklist de assets**: GIF de 8–12 s, 2–3 capturas (`AGENT_OFFICE_SHOTS`), imagem do README, link do PR ou release.
6. **Comunidade**: chamada para feedback com 3 perguntas objetivas, rótulo sugerido para issues e lacunas de CONTRIBUTING percebidas.
7. **Métricas de acompanhamento** sem telemetria: estrelas, downloads do release, issues abertas por tema, menções; janela de 7 e 30 dias e o que levar de volta ao discovery.
8. **Nunca publique.** Tudo fica como rascunho para o usuário; nada é postado, enviado ou agendado.

## Output Format

The output MUST follow this exact structure:

````markdown
# Kit de Lançamento — {tema} (step-23)

- **Status:** {pronto para publicar | pronto para quando publicar — motivo}
- **Para quem:** {público}
- **Mensagem-chave:** {uma frase}

## Requisitos e limitações (dizer de cara)
- {…}

## Rascunhos
### Post curto (≤ 280 caracteres)
{texto}

### LinkedIn
{texto}

### Thread
1. {…}

## Roteiro de demo (60 s)
| Tempo | Na tela | Narração/legenda |
|---|---|---|

## Checklist de assets
- [ ] {…}

## Comunidade e feedback
- {chamada, perguntas, rótulo, lacunas}

## Métricas (7 e 30 dias)
| Métrica | Fonte | Meta inicial |
|---|---|---|
````

## Output Example

````markdown
# Kit de Lançamento — Subagentes visíveis (step-23)

- **Status:** pronto para publicar (PR #12 aberto; publicar quando o merge sair)
- **Para quem:** devs que usam Claude Code com várias sessões e delegam trabalho a subagentes
- **Mensagem-chave:** Agora você vê quem está ajudando cada agente: os subagentes aparecem como estagiários ao lado da mesa.

## Requisitos e limitações (dizer de cara)
- Claude Code instalado e logado; Agent Office a partir da próxima versão.
- Testado no Windows; macOS ainda em verificação.
- Com muitos agentes na tela, a etiqueta "+N" pode encostar no crachá (correção em andamento).

## Rascunhos
### Post curto (≤ 280 caracteres)
Seu agente delegou parte da tarefa? No Agent Office, o subagente agora aparece como estagiário ao lado da mesa, com o que está fazendo no balão. Um olhar e você sabe quem está trabalhando em quê.

### LinkedIn
Delegar para subagentes é ótimo até você perder de vista quem está fazendo o quê.
No Agent Office, cada subagente vira um estagiário ao lado da mesa do agente, e o painel lista quem está ajudando e há quanto tempo.
Testado no Windows, macOS chegando. Feedback é bem-vindo nas issues do repositório.

### Thread
1. Subagentes agora aparecem no escritório. 🧵
2. Quando um agente usa a ferramenta Agent, nasce um estagiário ao lado da mesa dele.
3. O balão mostra a atividade; ao terminar, o estagiário acena e sai.
4. No painel do agente, a seção "Subagentes" lista todos, operável só com teclado.
5. Funciona com agentes do escritório e com sessões do terminal conectadas.

## Roteiro de demo (60 s)
| Tempo | Na tela | Narração/legenda |
|---|---|---|
| 0–5 s | escritório com 6 agentes trabalhando | "Seis agentes, um olhar." |
| 5–20 s | Ada delega; dois estagiários surgem | "Quando um agente delega, você vê." |
| 20–40 s | painel da Ada com a lista e Tab/Enter | "Quem ajuda, fazendo o quê, há quanto tempo." |
| 40–60 s | estagiários acenam e saem; Ada traz o resultado | "Terminou? Ele vem até você." |

## Checklist de assets
- [ ] GIF de 10 s gravado em instância isolada, sem caminhos pessoais
- [ ] Capturas `out/s15-depois-1.png` e `out/s16-depois-1.png`
- [ ] Link do PR #12 (e do release, quando sair)

## Comunidade e feedback
- Chamada: "Você usa subagentes? O que precisa ver deles no escritório?" — perguntas: o que delega, quantos ao mesmo tempo, o que falta no painel. Rótulo sugerido: `feedback:subagentes`. Lacuna: não há CONTRIBUTING.md.

## Métricas (7 e 30 dias)
| Métrica | Fonte | Meta inicial |
|---|---|---|
| Estrelas novas | GitHub | +50 em 30 dias |
| Issues com `feedback:subagentes` | GitHub | 5 em 30 dias |
| Downloads do próximo release | GitHub Releases | linha de base |
````

## Veto Conditions

Reject and redo if ANY of these are true (não se aplicam à nota de pulo):
1. Qualquer conteúdo publicado, enviado ou agendado em nome do usuário.
2. Promessa de recurso, plataforma ou data fora do que foi aprovado e publicado nesta run.
3. Limitação conhecida (plataforma não verificada, CONCERNS, CONDITIONS) omitida dos rascunhos.
4. Termos proibidos pelo product-voice ("revolucionário", "game changer") ou métricas que exijam telemetria sem consentimento.

## Quality Criteria

- [ ] Mensagem-chave cabe numa frase e cita o diferencial
- [ ] Post curto com até 280 caracteres contados
- [ ] Roteiro de demo com marcação de tempo e gravação em instância isolada
- [ ] Assets listados com origem (caminho ou link)
- [ ] Perguntas de feedback que alimentam o próximo discovery
- [ ] Métricas com fonte e janela definidas
