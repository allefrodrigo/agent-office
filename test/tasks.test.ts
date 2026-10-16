import { describe, it, expect } from 'vitest'
import { parseTasksFile } from '@shared/tasks'

describe('tasks parser', () => {
  it('identidade do codec: arquivo sintético volta igual', () => {
    const content = `---
title: Tarefas
---

## Fazer
- Tarefa 1
- Tarefa 2

## Feito
- Tarefa 3

%% kanban:settings %%
alguma configuração
%% kanban:settings %%

## Próximo
`

    const parsed = parseTasksFile(content)
    expect(parsed.original).toEqual(content)
  })

  it('reconhece seções e tarefas', () => {
    const content = `## Fazer
- Tarefa A
- Tarefa B

## Feito
- Tarefa C
`

    const parsed = parseTasksFile(content)
    expect(parsed.lists).toHaveLength(2)
    expect(parsed.lists[0].name).toBe('Fazer')
    expect(parsed.lists[0].tasks).toHaveLength(2)
    expect(parsed.lists[1].name).toBe('Feito')
    expect(parsed.lists[1].tasks).toHaveLength(1)
  })

  it('pula frontmatter e settings', () => {
    const content = `---
meta: data
---

## Fazer
- Tarefa

%% kanban:settings %%
config
%% kanban:settings %%
`

    const parsed = parseTasksFile(content)
    expect(parsed.lists).toHaveLength(1)
    expect(parsed.lists[0].tasks).toHaveLength(1)
  })

  it('avisa linhas não reconhecidas', () => {
    const content = `## Fazer
- Tarefa boa
Linha sem - ou *
- Outra tarefa
`

    const parsed = parseTasksFile(content)
    expect(parsed.warnings.length).toBeGreaterThan(0)
    expect(parsed.warnings[0]).toContain('não é tarefa')
  })

  it('mostra listas vazias', () => {
    const content = `## Fazer
## Feito
`

    const parsed = parseTasksFile(content)
    expect(parsed.lists).toHaveLength(2)
    expect(parsed.lists[0].tasks).toHaveLength(0)
    expect(parsed.lists[1].tasks).toHaveLength(0)
  })
})
