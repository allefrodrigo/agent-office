---
task: "Definir resultados, métricas e prioridade"
order: 1
input: |
  - discovery_brief: output/{run_id}/04-discovery/vN/discovery-brief.md (ou o intake, se o step-04 foi pulado)
  - intake: output/{run_id}/01-intake.md e output/{run_id}/03-plan-approval.md
  - dossier: pipeline/data/product-dossier.md — personas, capacidades e lacunas
output: |
  - outcomes: problema, persona, JTBD, hipótese, métrica norte, métricas de guarda com plano de medição, RICE e decisão de ir/não ir (entrada da task write-prd)
---

# Definir resultados, métricas e prioridade

Antes de escrever requisitos, fixa o problema, para quem, o que muda se der certo e como saberemos — com plano de medição compatível com um produto que não tem telemetria. Fecha com RICE e uma recomendação de ir, ajustar ou não ir.

## Process

1. Ler o discovery-brief (ou o intake, se o step-04 foi pulado) e escrever o problema em até 3 frases, citando os achados F-n que o sustentam.
2. Escolher a persona principal entre as do dossier (dev com várias sessões em paralelo, tech lead que orquestra por tickets, criador de conteúdo dev) e escrever o JTBD no formato "Quando…, quero…, para…".
3. Formular a hipótese: "Se {mudança}, então {comportamento observável}, porque {evidência}".
4. Definir a métrica norte e 2–3 métricas de guarda. Para cada uma: alvo, prazo e **fonte de medição**. Fontes válidas sem telemetria: contagem local exibida ao próprio usuário, pesquisa curta com usuários, issues e discussões, demos de comunidade, teste manual roteirizado. Telemetria só como proposta opt-in, marcada como CON de privacidade.
5. Pontuar RICE: Alcance (usuários por trimestre, com premissa), Impacto (0,25 · 0,5 · 1 · 2 · 3), Confiança (50 % · 80 % · 100 %, ligada à confiança dos achados), Esforço (pessoa-semana estimada com o run-plan). Calcular (R × I × C) ÷ E e mostrar a conta.
6. Comparar com o roadmap (`product-dossier.md`) e com o diferencial (governança espacial): a iniciativa reforça, é neutra ou é só paridade?
7. Recomendar ir, ajustar escopo ou não ir, com o motivo principal, e entregar o resultado para a task write-prd.

## Output Format

```yaml
outcomes:
  problem: "até 3 frases, com F-n"
  persona: "nome da persona do dossier"
  jtbd: "Quando ..., quero ..., para ..."
  hypothesis: "Se ..., então ..., porque ..."
  north_star: { metric: "", target: "", deadline: "", measurement: "" }
  guardrails:
    - { metric: "", target: "", measurement: "" }
  rice: { reach: 0, impact: 0, confidence: 0, effort: 0, score: 0, math: "R×I×C÷E = ..." }
  differentiation: reforça | neutra | paridade
  recommendation: { decision: ir | ajustar | não ir, reason: "" }
```

## Output Example

> Use como referência de qualidade, não como template rígido.

```yaml
outcomes:
  problem: >
    Quando um agente dispara subagentes (ferramenta Agent/Task), o escritório não mostra nada:
    hoje AgentManager.handle() descarta mensagens com parent_tool_use_id. O usuário não sabe
    quantos estagiários trabalham nem de quem é uma permissão (F1, impacto no código).
  persona: "Dev com várias sessões do Claude Code em paralelo"
  jtbd: "Quando delego uma tarefa grande, quero ver quem está ajudando o agente, para confiar no progresso e saber a quem responder."
  hypothesis: >
    Se subagentes aparecerem como estagiários ao lado da mesa e no painel, então o usuário vai
    interromper menos agentes por dúvida ("está travado?"), porque passa a ver trabalho em paralelo.
  north_star:
    metric: "Sessões com subagentes em que o usuário abriu o painel do agente ao menos uma vez"
    target: "60 % nas sessões observadas"
    deadline: "4 semanas após a v0.3"
    measurement: "teste roteirizado com 5 usuários + pesquisa curta no lançamento (sem telemetria)"
  guardrails:
    - { metric: "FPS no demo com 10 agentes e 3 subagentes cada", target: "≥ 55 fps com foco", measurement: "medição manual do Vitor Voxel" }
    - { metric: "Interrupções sem motivo", target: "não aumentar", measurement: "relato no teste roteirizado" }
  rice: { reach: 300, impact: 1, confidence: 0.8, effort: 1.5, score: 160, math: "300 × 1 × 0,8 ÷ 1,5 = 160" }
  differentiation: reforça
  recommendation:
    decision: ir
    reason: "Paridade com o Pixel Agents na visualização, mas reforça o diferencial ao ligar permissões ao subagente que pediu."
```

## Quality Criteria

- [ ] Problema cita evidência (F-n do discovery, intake ou trecho de código).
- [ ] Métrica norte e guardas com alvo, prazo e fonte de medição viável sem telemetria obrigatória.
- [ ] RICE com a conta explícita e premissas de cada fator.
- [ ] Classificação de diferenciação justificada.
- [ ] Recomendação clara (ir, ajustar ou não ir) com o motivo principal.

## Veto Conditions

Rejeitar e refazer se QUALQUER condição for verdadeira:
1. Métrica que depende de telemetria não consentida ou de dado que o produto não coleta.
2. Problema sem evidência citada.
3. RICE sem a conta ou com fator sem premissa.
4. Persona genérica ("todos os devs") em vez de uma persona do dossier.
