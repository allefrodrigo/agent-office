import type { AskQuestion, PermissionRequest } from '@shared/types'
import { describePermission } from '@shared/describe'

// A tool call from the SDK or a hook, as the permission card shows it.

export function permissionFromTool(
  tool: string,
  input: Record<string, unknown>,
  reason?: string,
  canAlwaysAllow = false,
): Omit<PermissionRequest, 'id' | 'agentId' | 'createdAt'> {
  if (tool === 'AskUserQuestion') {
    const questions = (Array.isArray(input.questions) ? input.questions : []) as AskQuestion[]
    return { kind: 'question', toolName: tool, title: 'Tenho uma pergunta', detail: '', input, questions, canAlwaysAllow: false }
  }
  if (tool === 'ExitPlanMode') {
    return { kind: 'plan', toolName: tool, title: 'Posso seguir com este plano?', detail: '', input, plan: String(input.plan ?? ''), canAlwaysAllow: false }
  }
  const d = describePermission(tool, input)
  return { kind: 'tool', toolName: tool, title: d.title, detail: d.detail, input, reason, canAlwaysAllow }
}
