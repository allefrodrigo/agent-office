import { existsSync } from 'node:fs'
import { query, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describeTool, toolDetail } from '@shared/describe'
import { MAIN_ACCOUNT } from '@shared/accounts'
import { accountEnv } from '../accounts'
import { claudeNotFoundMessage } from '../claude-messages'
import { findClaude } from '../claude-path'
import { findSquad, memberAgents, orchestratorPrompt, teamGuard, type SquadDefinition } from '../squads'
import { takeSnapshot } from '../git'
import { InputQueue, kTokens, toMs, WRITE_TOOLS, type Agent, type Prompt } from './types'
import { AgentOffice } from './office'

/** Runs on the Claude Agent SDK: starting the query and turning its messages into status, activity and log. */
export abstract class AgentSdk extends AgentOffice {
  /** CLI processes closed on purpose to move to another account: their end is not an error. */
  protected replaced = new WeakSet<Query>()

  protected run(agent: Agent, prompt: Prompt): void {
    const s = agent.summary
    if (this.simulate) return this.simulate(s.id, typeof prompt === 'string' ? prompt : '(mensagem com anexos)')
    const claude = findClaude()
    if (!claude) {
      this.deliver(agent, {
        text: claudeNotFoundMessage(process.platform),
        isError: true,
        costUsd: s.costUsd,
        durationMs: 0,
        turns: 0,
      })
      return
    }
    // Orchestrators read the squad again, so edits to squad.yaml count from the next run.
    const squad = s.role === 'orchestrator' && s.squad ? findSquad(s.cwd, s.squad) : undefined
    if (s.role === 'orchestrator') {
      if (!squad) {
        this.deliver(agent, { text: `Não achei mais o squad \`${s.squad}\` em ${s.cwd}/squads.`, isError: true, costUsd: s.costUsd, durationMs: 0, turns: 0 })
        return
      }
      agent.squad = squad
      // Squad cycles touch real systems: never without approvals, whatever was saved.
      if (s.permissionMode === 'bypassPermissions') s.permissionMode = 'default'
    }
    if (this.overBudget(agent)) return
    const wt = s.worktree
    const workDir = wt?.path ?? s.cwd
    if (wt && !existsSync(workDir)) {
      this.deliver(agent, {
        text: `A cópia isolada (worktree) deste agente não existe mais: \`${wt.root}\`.\n\nDispense o agente e contrate outro; o branch \`${wt.branch}\` continua no repositório se tiver commits.`,
        isError: true,
        costUsd: s.costUsd,
        durationMs: 0,
        turns: 0,
      })
      return
    }
    // A new task (not a failover or a /compact): remember the folder as it is now, so the
    // card can show what this task changed. The CLI only starts once the snapshot is done:
    // anything it writes before that would count as the player's own earlier change.
    if (!agent.task && !agent.compacting && !agent.demo) agent.task = { snapshot: takeSnapshot(workDir).catch(() => null), touched: new Map() }
    const input = new InputQueue()
    input.push(prompt)
    agent.input = input
    const task = agent.task
    if (task && !task.ready) {
      // Messages sent meanwhile go into this same queue (sendMessage checks awaitingSnapshot).
      agent.awaitingSnapshot = true
      this.setStatus(agent, 'starting', s.status === 'starting' ? s.activity : 'Voltando ao trabalho')
      void task.snapshot.then(() => {
        task.ready = true
        if (agent.input !== input) return // fired, cleared or replaced while waiting
        agent.awaitingSnapshot = false
        if (this.agents.get(s.id) === agent) this.startQuery(agent, input, claude, workDir, squad)
      })
      return
    }
    this.startQuery(agent, input, claude, workDir, squad)
  }

  /** Starts the CLI process for `run`, reading `input`. */
  protected startQuery(agent: Agent, input: InputQueue, claude: string, workDir: string, squad: SquadDefinition | undefined): void {
    const s = agent.summary
    const wt = s.worktree
    // Each run starts a new CLI process, so it can move to another account between turns.
    const before = s.account
    const account = this.accounts?.pick(s, agent.borrowed)
    if (account) s.account = account.id
    const resumed = agent.started
    if (s.sessionId) {
      this.book?.begin(s.sessionId, resumed, s.costUsd)
      this.book?.switched(s, s.sessionId, s.account ?? MAIN_ACCOUNT, before, 'start')
    }
    const limits = this.store.settings
    const budget = limits.agentBudgetUsd > 0 ? limits.agentBudgetUsd - (s.spentUsd ?? 0) : undefined
    this.setStatus(agent, 'starting', s.status === 'starting' ? s.activity : 'Voltando ao trabalho')

    const q = query({
      prompt: input,
      options: {
        cwd: workDir,
        model: s.model,
        effort: s.effort,
        pathToClaudeCodeExecutable: claude,
        permissionMode: s.permissionMode,
        // Subagent text comes too (not only tools), for the helper's own log (AO-46).
        forwardSubagentText: true,
        allowDangerouslySkipPermissions: s.permissionMode === 'bypassPermissions',
        // Counts only what this query spends, so it gets what is left of the agent's cap.
        ...(budget !== undefined ? { maxBudgetUsd: budget } : {}),
        ...(agent.started ? { resume: s.sessionId } : { sessionId: s.sessionId }),
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append:
            `Your name in this office is ${s.name}. Your final message for each task is handed to the user in person as a report: ` +
            'open with the outcome in one or two sentences, then list the key details. Reply in the language the user wrote in. ' +
            'The office has a kanban board of tickets (keys like AO-12); use the mcp__office__ tools to read, open, comment on and move tickets when asked or when you are working on one.' +
            (wt
              ? `\n\nYou work in your own git worktree at ${wt.root} on branch ${wt.branch}, so other agents never touch your files. ` +
                `Make every change here; do not edit the main checkout at ${wt.repo}. The user reviews, commits and opens the pull request from the office.`
              : '') +
            (squad ? `\n\n${orchestratorPrompt(squad)}` : ''),
        },
        ...(squad ? { agents: memberAgents(squad), hooks: { PreToolUse: teamGuard(squad) } } : {}),
        ...(this.officeTools ? { mcpServers: { office: this.officeTools(s) } } : {}),
        // Lets the terminal bridge ignore hook events coming from office-managed sessions.
        env: {
          ...accountEnv(account),
          AGENT_OFFICE_MANAGED: '1',
          // The cap the CLI enforces on subagents running at once (its default is 20).
          ...(limits.maxSubagents > 0 ? { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: String(limits.maxSubagents) } : {}),
        },
        canUseTool: (tool, toolInput, opts) => this.askPlayer(agent, tool, toolInput, opts),
        stderr: (data) => {
          if (/error/i.test(data)) this.addLog(agent, 'error', data.trim().slice(0, 500))
        },
      },
    })
    agent.query = q
    agent.started = true
    // A resumed session the book never saw starts from the total its transcript saved:
    // read it now so that part is not booked as today's spend. Experimental API, best effort;
    // without it the first result only sets the mark.
    const sid = s.sessionId
    if (resumed && sid && this.book && !this.book.isMarked(sid)) {
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
        .then((u) => this.book?.markResumed(sid, u.session.total_cost_usd, u.session.model_usage ?? {}))
        .catch(() => undefined)
    }
    this.consume(agent, q)
  }

  protected async consume(agent: Agent, q: Query): Promise<void> {
    try {
      for await (const msg of q) this.handle(agent, msg)
    } catch (err) {
      // Closed on purpose to move to another account: the new process carries on.
      if (this.replaced.has(q) || (agent.query && agent.query !== q)) return
      const text = err instanceof Error ? err.message : String(err)
      this.addLog(agent, 'error', text)
      // Nothing was ever saved under this id (cleared, then closed before the first message):
      // the next message starts it instead of resuming it again.
      if (/No conversation found with session ID/i.test(text)) {
        agent.started = false
        this.addLog(agent, 'system', 'Essa conversa nunca chegou a começar. Mande a mensagem de novo para começar uma nova.')
      }
      if (this.agents.has(agent.summary.id)) {
        this.deliver(agent, { text: `Tive um problema e parei:\n\n${text}`, isError: true, costUsd: agent.summary.costUsd, durationMs: 0, turns: 0 })
      }
    } finally {
      if (agent.query === q) {
        agent.query = undefined
        agent.input = undefined
        // Subagents live inside the CLI process, so they ended with it.
        this.clearSubagents(agent)
        if (agent.summary.status === 'working' || agent.summary.status === 'starting') this.setStatus(agent, 'idle', 'Aguardando instruções')
      }
    }
  }

  protected handle(agent: Agent, msg: SDKMessage): void {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          agent.summary.model = msg.model
          if (agent.summary.status === 'starting') this.setStatus(agent, 'working', 'Lendo a tarefa')
        } else if (msg.subtype === 'status' && msg.status === 'compacting') {
          this.setStatus(agent, agent.summary.status, 'Organizando a memória')
        } else if (msg.subtype === 'compact_boundary') {
          const { trigger, pre_tokens, post_tokens } = msg.compact_metadata
          const freed = post_tokens !== undefined ? ` de ${kTokens(pre_tokens)} para ${kTokens(post_tokens)}` : ''
          this.addLog(agent, 'system', `${trigger === 'auto' ? 'O contexto encheu e foi compactado sozinho' : 'Conversa compactada'}${freed}.`)
          if (post_tokens !== undefined && agent.summary.context) this.setContext(agent, post_tokens, agent.summary.context.max)
        } else {
          this.trackSubagents(agent, msg)
        }
        return
      case 'rate_limit_event': {
        const info = msg.rate_limit_info
        if (info.status === 'rejected') agent.limitHit = { resetsAt: toMs(info.resetsAt) }
        return
      }
      case 'assistant': {
        // Subagents share the process and its account, so their limit is ours too.
        if (msg.error === 'rate_limit') agent.limitHit ??= {}
        // A subagent's message goes to its own log, never to the parent's.
        if (msg.parent_tool_use_id) return this.subagentMessage(agent, msg.parent_tool_use_id, 'assistant', msg.message.content)
        // Live estimate between the exact readings taken after each turn.
        const u = msg.message.usage
        if (u && agent.summary.context) {
          this.setContext(agent, u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + u.output_tokens, agent.summary.context.max)
        }
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            this.addLog(agent, 'assistant', block.text)
          } else if (block.type === 'thinking') {
            this.setActivity(agent, 'Pensando…')
          } else if (block.type === 'tool_use') {
            const input = (block.input ?? {}) as Record<string, unknown>
            const line = describeTool(block.name, input)
            const file = input.file_path ?? input.notebook_path
            if (agent.task && WRITE_TOOLS.has(block.name) && typeof file === 'string' && file.length < 4096) agent.task.touched.set(file, block.name)
            this.addLog(agent, 'tool', toolDetail(block.name, input) || line, block.name)
            this.setActivity(agent, line)
          }
        }
        if (agent.summary.status !== 'waiting') this.setStatus(agent, 'working', agent.summary.activity)
        return
      }
      case 'user': {
        if (msg.parent_tool_use_id) return this.subagentMessage(agent, msg.parent_tool_use_id, 'user', msg.message.content)
        const content = msg.message.content
        if (!Array.isArray(content)) return
        for (const block of content) {
          if (block.type !== 'tool_result') continue
          const text = typeof block.content === 'string' ? block.content : (block.content ?? []).map((c) => ('text' in c ? c.text : '')).join('\n')
          if (text.trim()) this.addLog(agent, 'tool_result', text.slice(0, 1200), undefined, block.is_error === true)
        }
        return
      }
      case 'result': {
        const hit = agent.limitHit
        agent.limitHit = undefined
        const isError = msg.subtype !== 'success' || msg.is_error
        if (agent.summary.sessionId && this.book) {
          const spent = this.book.record(agent.summary, agent.summary.sessionId, agent.summary.account, msg)
          if (spent > 0) agent.summary.spentUsd = (agent.summary.spentUsd ?? 0) + spent
        }
        const text =
          msg.subtype === 'success'
            ? msg.result
            : msg.subtype === 'error_max_budget_usd'
              ? this.budgetText(agent)
              : msg.errors.join('\n') || `Parei: ${msg.subtype}`
        agent.summary.costUsd = msg.total_cost_usd
        this.readContext(agent)
        // The turn is over, so no foreground subagent can still be running (covers an interrupt that lost its notification).
        for (const sub of agent.summary.subagents ?? []) if (!sub.background) this.retire(agent, sub, 'completed')
        if (agent.compacting) {
          agent.compacting = false
          if (isError) this.addLog(agent, 'error', `Não consegui compactar: ${text}`)
          this.setStatus(agent, 'idle', isError ? 'Não conseguiu compactar' : 'Memória organizada, esperando instruções')
          return
        }
        if (hit && this.failover(agent, hit)) return
        const limit = hit ? { accountId: agent.summary.account, resetsAt: hit.resetsAt } : undefined
        this.deliver(agent, { text, isError, costUsd: msg.total_cost_usd, durationMs: msg.duration_ms, turns: msg.num_turns, limit })
        return
      }
      default:
        return
    }
  }
}
