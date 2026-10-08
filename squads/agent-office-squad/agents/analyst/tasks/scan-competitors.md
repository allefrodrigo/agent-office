---
task: "Varredura competitiva focada"
order: 1
input: |
  - question: pergunta da iniciativa, extraída do intake e do run-plan
  - benchmark: pipeline/data/benchmark-landscape.md — matriz competitiva atual
  - dossier: pipeline/data/product-dossier.md — o que o Agent Office já faz
output: |
  - competitive_scan: achados datados com confiança, tabela "como cada concorrente resolve", paridade × diferencial, espaço vazio e fontes (entrada da task map-codebase-impact)
---

# Varredura competitiva focada

Responde, com fontes datadas, como os concorrentes e as plataformas resolvem o problema da iniciativa e onde está o espaço vazio para o Agent Office. É uma varredura focada na pergunta da run, não um censo do mercado.

## Process

1. Reescrever a pergunta da iniciativa em uma frase testável (ex.: "Como as ferramentas mostram subagentes e quem os disparou?"). Definir 3–5 critérios de comparação ligados a ela.
2. Ler o `benchmark-landscape.md` e marcar quais concorrentes são relevantes: escritórios visuais (Pixel Agents, roving-office, Claude-Office, Cubicle, Virtual Office do opensquad, AIOX Cockpit), GUIs de sessões paralelas (app desktop oficial do Claude Code, Conductor, Nimbalyst, Vibe Kanban, Claude Squad, Opcode), mission controls (GitHub Agent HQ, Cursor 3 Agents Window, Antigravity Agent Manager), aprovação remota (Greenlight) e monitores de uso (ccusage).
3. Fazer no máximo ~10 buscas: primeiro fontes primárias (README, changelog, docs oficiais, post de lançamento), depois secundárias para corroborar. Para cada fonte, anotar URL, data de acesso e tipo (primária, secundária, interessada).
4. Preencher a tabela de comparação por critério. Onde não houver evidência, escrever "sem evidência" — nunca deduzir.
5. Atribuir confiança a cada achado: alta (3+ fontes independentes), média (2), baixa (1 fonte ou conflito). Se fontes divergem, registrar as duas versões.
6. Classificar cada capacidade como **paridade** (todo mundo tem; ausência é risco), **diferencial** (só o Agent Office tem ou pode ter) ou **espaço vazio** (ninguém resolve bem).
7. Comparar com o que o Agent Office já faz (dossier e código) e escrever as implicações numa seção separada dos achados.
8. Entregar o scan como insumo da próxima task (map-codebase-impact), sem recomendações de escopo fechadas.

## Output Format

```yaml
competitive_scan:
  question: "pergunta testável"
  criteria: ["critério 1", "critério 2"]
  comparison:
    - product: "nome"
      approach: "como resolve"
      criteria_hits: { "critério 1": "sim | parcial | não | sem evidência" }
      source_ids: [S1, S2]
  findings:
    - id: F1
      statement: "fato verificável"
      confidence: alta | média | baixa
      sources: [S1]
  classification: { paridade: [], diferencial: [], espaco_vazio: [] }
  implications: ["o que isso significa para o Agent Office"]
  sources:
    - { id: S1, url: "...", accessed: "AAAA-MM-DD", type: primária | secundária | interessada }
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```yaml
competitive_scan:
  question: "Como as ferramentas mostram subagentes e Agent Teams, e o usuário consegue agir sobre eles?"
  criteria: ["mostra subagente", "liga ao agente pai", "permite agir (aprovar/parar)", "funciona com sessões do terminal"]
  comparison:
    - product: "Pixel Agents"
      approach: "subagentes e Agent Teams viram personagens separados ligados ao agente pai; detecção por hooks com fallback em JSONL"
      criteria_hits: { "mostra subagente": "sim", "liga ao agente pai": "sim", "permite agir (aprovar/parar)": "sem evidência", "funciona com sessões do terminal": "sim" }
      source_ids: [S1]
    - product: "roving-office (Atlassian)"
      approach: "um personagem por sessão; renderização de subagentes como fantasmas está no roadmap ('later')"
      criteria_hits: { "mostra subagente": "não", "liga ao agente pai": "não", "permite agir (aprovar/parar)": "não", "funciona com sessões do terminal": "sim" }
      source_ids: [S2]
    - product: "App desktop oficial do Claude Code"
      approach: "sessões paralelas com barra lateral e worktrees; subagentes podem ter worktree própria via frontmatter"
      criteria_hits: { "mostra subagente": "sem evidência", "liga ao agente pai": "sem evidência", "permite agir (aprovar/parar)": "sim (na sessão)", "funciona com sessões do terminal": "não" }
      source_ids: [S3, S4]
  findings:
    - { id: F1, statement: "Pixel Agents exibe subagentes e Agent Teams como personagens ligados ao pai", confidence: média, sources: [S1, S5] }
    - { id: F2, statement: "roving-office ainda não mostra subagentes; está no roadmap", confidence: baixa, sources: [S2] }
    - { id: F3, statement: "Agent Teams do Claude Code é experimental e exige flag", confidence: média, sources: [S6, S7] }
  classification:
    paridade: ["mostrar que um subagente existe"]
    diferencial: ["subagente pedindo permissão vai até o usuário como o agente pai"]
    espaco_vazio: ["agir sobre subagentes (parar, ver log) a partir do escritório"]
  implications:
    - "Mostrar subagentes é paridade com o Pixel Agents; o diferencial é governança: permissões de subagente já chegam via canUseTool e podem ganhar contexto de quem pediu."
  sources:
    - { id: S1, url: "https://github.com/pixel-agents-hq/pixel-agents", accessed: "2026-10-08", type: primária }
    - { id: S2, url: "https://github.com/atlassian-labs/roving-office", accessed: "2026-10-08", type: primária }
    - { id: S6, url: "https://code.claude.com/docs/en/agent-teams", accessed: "2026-10-08", type: primária }
```

## Quality Criteria

- [ ] Pergunta testável e 3–5 critérios definidos antes das buscas.
- [ ] Toda fonte com URL, data de acesso e tipo; vendor marcado como "interessada".
- [ ] Todo achado com confiança; divergências registradas com as duas versões.
- [ ] Classificação paridade × diferencial × espaço vazio preenchida.
- [ ] Implicações separadas dos achados.

## Veto Conditions

Rejeitar e refazer se QUALQUER condição for verdadeira:
1. Algum achado sem fonte ou sem data de acesso.
2. Critério preenchido por dedução ("provavelmente sim") em vez de "sem evidência".
3. Mais de ~15 buscas sem justificativa registrada.
4. Recomendação de escopo fechada nesta task (é papel da Rita Roadmap no step-05).
