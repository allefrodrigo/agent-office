export interface Task {
  text: string
  line: number
}

export interface TaskList {
  name: string
  tasks: Task[]
}

export interface ParsedBoard {
  lists: TaskList[]
  warnings: string[]
}

export function parseTasksFile(content: string): ParsedBoard & { original: string } {
  const lines = content.split('\n')
  const lists: TaskList[] = []
  const warnings: string[] = []
  let currentList: TaskList | null = null
  let inFrontmatter = false
  let inSettings = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (i === 0 && trimmed === '---') {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter && trimmed === '---') {
      inFrontmatter = false
      continue
    }
    if (inFrontmatter) continue

    if (trimmed.includes('%% kanban:settings %%')) {
      inSettings = !inSettings
      continue
    }
    if (inSettings) continue

    if (trimmed.startsWith('## ')) {
      currentList = { name: trimmed.slice(3).trim(), tasks: [] }
      lists.push(currentList)
      continue
    }

    if (currentList && trimmed) {
      if (!trimmed.startsWith('-') && !trimmed.startsWith('*')) {
        warnings.push(`Linha ${i + 1}: "${trimmed}" não é tarefa (use - ou *)`)
      }
      const task = trimmed.replace(/^[-*]\s*/, '').trim()
      if (task) {
        currentList.tasks.push({ text: task, line: i + 1 })
      }
    }
  }

  return { lists, warnings, original: content }
}
