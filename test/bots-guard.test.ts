import { describe, expect, it } from 'vitest'
import { guardReason, sensitiveKind, sensitiveKinds } from '../src/shared/bots-guard'
import type { SensitiveKind } from '../src/shared/types/bots'

const bash = (command: string) => ['Bash', { command }] as const

/** Calls that must wait for a yes, with the kind each one is. */
const ASKS: [string, Record<string, unknown>, SensitiveKind][] = [
  // git remoto
  [...bash('git push'), 'push'],
  [...bash('git push origin main'), 'push'],
  [...bash('git push --force origin feature'), 'push'],
  [...bash('git push -f'), 'push'],
  [...bash('git -C ../repo push'), 'push'],
  [...bash('git -c user.name=x push origin HEAD'), 'push'],
  [...bash('npm test && git push'), 'push'],
  [...bash('git add . ; git commit -m "fix" ; git push'), 'push'],
  [...bash('git commit -am wip || git push'), 'push'],
  [...bash('echo ok | git push --set-upstream origin x'), 'push'],
  [...bash('(cd app && git push)'), 'push'],
  [...bash('bash -c "git push origin main"'), 'push'],
  [...bash("sh -c 'cd app; git push'"), 'push'],
  [...bash('zsh -lc "git push"'), 'push'],
  [...bash('echo "$(git push 2>&1)"'), 'push'],
  [...bash('echo `git push`'), 'push'],
  [...bash('eval git push'), 'push'],
  [...bash('sudo -u deploy git push'), 'push'],
  [...bash('env GIT_TRACE=1 git push'), 'push'],
  [...bash('GIT_SSH_COMMAND="ssh -i k" git push'), 'push'],
  [...bash('/usr/bin/git push'), 'push'],
  [...bash('timeout 30 git push'), 'push'],
  [...bash('git status\ngit push'), 'push'],
  [...bash('gh pr create --fill'), 'push'],
  [...bash('gh pr merge 12 --squash'), 'push'],
  [...bash('gh -R owner/repo pr merge 3'), 'push'],
  // publicar
  [...bash('npm publish'), 'publish'],
  [...bash('npm publish --access public'), 'publish'],
  [...bash('pnpm publish -r'), 'publish'],
  [...bash('yarn npm publish'), 'publish'],
  [...bash('bun publish'), 'publish'],
  [...bash('npm run deploy'), 'publish'],
  [...bash('npm run release:prod'), 'publish'],
  [...bash('gh release create v1.0.0 dist/*'), 'publish'],
  [...bash('vercel deploy --prod'), 'publish'],
  [...bash('vercel --prod'), 'publish'],
  [...bash('vercel'), 'publish'],
  [...bash('npx vercel deploy'), 'publish'],
  [...bash('netlify deploy --prod'), 'publish'],
  [...bash('fly deploy'), 'publish'],
  [...bash('flyctl deploy --remote-only'), 'publish'],
  [...bash('firebase deploy --only hosting'), 'publish'],
  [...bash('wrangler deploy'), 'publish'],
  [...bash('docker push ghcr.io/me/app:latest'), 'publish'],
  [...bash('cargo publish'), 'publish'],
  [...bash('twine upload dist/*'), 'publish'],
  [...bash('kubectl apply -f deploy.yaml'), 'publish'],
  [...bash('terraform apply -auto-approve'), 'publish'],
  // apagar
  [...bash('rm -rf dist'), 'delete'],
  [...bash('rm -r build'), 'delete'],
  [...bash('rm -fr /tmp/x'), 'delete'],
  [...bash('rm -R node_modules'), 'delete'],
  [...bash('rm --recursive old'), 'delete'],
  [...bash('rm -f -r cache'), 'delete'],
  [...bash('npm run build && rm -rf .next'), 'delete'],
  [...bash('git clean -fdx'), 'delete'],
  [...bash('git clean -f'), 'delete'],
  [...bash('git reset --hard origin/main'), 'delete'],
  [...bash('git branch -D feature/x'), 'delete'],
  [...bash('psql -c "DROP TABLE users;"'), 'delete'],
  [...bash('sqlite3 app.db "truncate table logs"'), 'delete'],
  [...bash('mysql -e "DELETE FROM orders"'), 'delete'],
  [...bash('find . -name "*.log" -delete'), 'delete'],
  [...bash('find . -type f -exec rm {} \\;'), 'delete'],
  [...bash('dropdb app_prod'), 'delete'],
  [...bash('redis-cli FLUSHALL'), 'delete'],
  [...bash('terraform destroy'), 'delete'],
  [...bash('kubectl delete pod web-1'), 'delete'],
  [...bash('aws s3 rm s3://bucket/x --recursive'), 'delete'],
  [...bash('cat > clean.sh <<EOF\nrm -rf build\nEOF'), 'delete'],
  // enviar
  [...bash('curl -X POST https://api.example.com/hook -d "{}"'), 'send'],
  [...bash('curl -XPOST https://hooks.slack.com/services/x'), 'send'],
  [...bash('curl --request PUT https://api.example.com/x'), 'send'],
  [...bash('curl -d "a=1" https://example.com/form'), 'send'],
  [...bash('curl --data-binary @file.json https://api.example.com'), 'send'],
  [...bash('curl -F "file=@a.png" https://upload.example.com'), 'send'],
  [...bash('curl --json \'{"a":1}\' example.com/api'), 'send'],
  [...bash('curl -X DELETE https://api.example.com/items/1'), 'send'],
  [...bash('curl -d x'), 'send'],
  [...bash('wget --post-data "a=1" https://example.com'), 'send'],
  [...bash('http POST api.example.com/x name=a'), 'send'],
  [...bash('sendmail ana@example.com < msg.txt'), 'send'],
  [...bash('echo oi | mail -s Teste ana@example.com'), 'send'],
  [...bash('scp build.zip deploy@server.example.com:/srv'), 'send'],
  [...bash('rsync -av dist/ me@host:/var/www'), 'send'],
  [...bash('gh issue comment 4 --body "feito"'), 'send'],
  [...bash('gh api -X POST repos/o/r/issues -f title=x'), 'send'],
  [...bash('ssh prod.example.com "git push"'), 'push'],
  // MCP
  ['mcp__gmail__send_email', { to: 'a@b.c' }, 'send'],
  ['mcp__gmail__send_draft', { id: '1' }, 'send'],
  ['mcp__slack__chat_postMessage', {}, 'send'],
  ['mcp__slack__post_message', {}, 'send'],
  ['mcp__discord__reply', {}, 'send'],
  ['mcp__outlook__forwardMessage', {}, 'send'],
  ['mcp__x__create_post', {}, 'send'],
  ['mcp__linear__create_comment', {}, 'send'],
  ['mcp__wordpress__publish_post', {}, 'publish'],
  ['mcp__vercel__deploy', {}, 'publish'],
  ['mcp__github__create_release', {}, 'publish'],
  ['mcp__drive__delete_file', {}, 'delete'],
  ['mcp__notion__archive_page', {}, 'delete'],
  ['mcp__supabase__remove_user', {}, 'delete'],
  ['mcp__db__drop_table', {}, 'delete'],
  ['mcp__stripe__create_payment_intent', {}, 'pay'],
  ['mcp__stripe__create_refund', {}, 'pay'],
  ['mcp__stripe__charge', {}, 'pay'],
  ['mcp__stripe__create_invoice', {}, 'pay'],
  ['mcp__stripe__create_payout', {}, 'pay'],
  ['mcp__github__merge_pull_request', {}, 'push'],
  ['mcp__github__create_pull_request', {}, 'push'],
  ['mcp__github__push_files', {}, 'push'],
  // PowerShell (Windows)
  ['PowerShell', { command: 'Remove-Item -Recurse -Force dist' }, 'delete'],
  ['PowerShell', { command: 'git push origin main' }, 'push'],
  ['PowerShell', { command: 'Invoke-RestMethod -Uri https://api.example.com -Method Post -Body $b' }, 'send'],
  ['PowerShell', { command: 'Send-MailMessage -To a@b.c -Subject x' }, 'send'],
  ['Monitor', { command: 'npm publish' }, 'publish'],
]

/** Calls that go through without the guard. */
const PASSES: [string, Record<string, unknown>, GuardOpts?][] = [
  [...bash('git status')],
  [...bash('git diff --stat')],
  [...bash('git log --oneline -5')],
  [...bash('git add -A && git commit -m "fix: corrige o teste"')],
  [...bash('git fetch origin')],
  [...bash('git pull --rebase')],
  [...bash('git checkout -b feature/x')],
  [...bash('git stash')],
  [...bash('git branch -d merged-branch')],
  [...bash('git reset HEAD~1')],
  [...bash('git -C ../repo status')],
  [...bash('npm test')],
  [...bash('npm run build')],
  [...bash('npm run lint -- --fix')],
  [...bash('npm install')],
  [...bash('pnpm install --frozen-lockfile')],
  [...bash('npm outdated; npm audit')],
  [...bash('npx vitest run')],
  [...bash('ls -la')],
  [...bash('cat package.json | head -20')],
  [...bash('rm file.txt')],
  [...bash('rm -f a.log b.log')],
  [...bash('rmdir empty')],
  [...bash('mkdir -p src/x && touch src/x/a.ts')],
  [...bash('find . -name "*.ts" | wc -l')],
  [...bash('grep -rn "TODO" src')],
  [...bash('curl https://example.com')],
  [...bash('curl -s -o out.html https://example.com/page')],
  [...bash('curl -I https://example.com')],
  [...bash('curl -X POST http://localhost:3000/api -d "{}"')],
  [...bash('curl -d a=1 http://127.0.0.1:8080/x')],
  [...bash('wget https://example.com/file.zip')],
  [...bash('gh pr list')],
  [...bash('gh pr view 12 --comments')],
  [...bash('gh issue list --label bug')],
  [...bash('gh api repos/o/r/pulls')],
  [...bash('docker build -t app .')],
  [...bash('vercel env ls')],
  [...bash('kubectl get pods')],
  [...bash('terraform plan')],
  [...bash('psql -c "SELECT count(*) FROM users"')],
  [...bash('echo hello > out.txt')],
  ['Read', { file_path: 'src/app.ts' }],
  ['Edit', { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' }],
  ['Write', { file_path: 'docs/x.md', content: 'rm -rf / is bad' }],
  ['WebFetch', { url: 'https://example.com', prompt: 'resuma' }],
  ['WebSearch', { query: 'npm publish' }],
  ['Grep', { pattern: 'git push' }],
  ['mcp__office__tickets_list', {}],
  ['mcp__office__ticket_update', { key: 'AO-1', status: 'doing' }],
  ['mcp__office__memory_write', { text: 'x' }, { mcpSource: 'sdk' }],
  ['mcp__gmail__create_draft', {}],
  ['mcp__gmail__search_emails', {}],
  ['mcp__gmail__get_message', {}],
  ['mcp__github__list_releases', {}],
  ['mcp__github__get_pull_request', {}],
  ['mcp__stripe__list_invoices', {}],
  ['mcp__linear__update_issue', {}],
  ['mcp__notion__search', {}],
  ['mcp__drive__read_file', {}],
  ['PowerShell', { command: 'Get-ChildItem -Recurse src' }],
]
type GuardOpts = { mcpSource?: string }

describe('sensitiveKind: corpus', () => {
  it('has more than 100 cases, 60+ that ask and 40+ that pass', () => {
    expect(ASKS.length + PASSES.length).toBeGreaterThanOrEqual(100)
    expect(ASKS.length).toBeGreaterThanOrEqual(60)
    expect(PASSES.length).toBeGreaterThanOrEqual(40)
  })

  for (const [tool, input, kind] of ASKS) {
    it(`pede: ${tool} ${String(input.command ?? '').slice(0, 60)} → ${kind}`, () => {
      expect(sensitiveKinds(tool, input)).toContain(kind)
    })
  }

  for (const [tool, input, opts] of PASSES) {
    it(`passa: ${tool} ${String(input.command ?? '').slice(0, 60)}`, () => {
      expect(sensitiveKind(tool, input, opts)).toBeNull()
    })
  }
})

describe('sensitiveKind: details', () => {
  it('the office server is exempt only when it is the app\'s own (sdk) or the CLI does not say', () => {
    expect(sensitiveKind('mcp__office__ticket_comment', {})).toBeNull()
    expect(sensitiveKind('mcp__office__delete_ticket', {}, { mcpSource: 'sdk' })).toBeNull()
    expect(sensitiveKind('mcp__office__delete_ticket', {}, { mcpSource: 'user' })).toBe('delete')
  })

  it('orders kinds by cost: pay before delete', () => {
    expect(sensitiveKinds('mcp__stripe__delete_payment_method', {})).toEqual(['pay', 'delete'])
    expect(sensitiveKind('mcp__stripe__delete_payment_method', {})).toBe('pay')
  })

  it('a chained command collects every kind', () => {
    expect(sensitiveKinds('Bash', { command: 'rm -rf dist && npm publish && git push' })).toEqual(['push', 'publish', 'delete'])
  })

  it('erra para o lado de pedir: a command too long or nested too deep asks for everything', () => {
    expect(sensitiveKinds('Bash', { command: 'x'.repeat(20_001) })).toHaveLength(5)
    const deep = 'bash -c "bash -c \\"bash -c \\\\\\"bash -c \\\\\\\\\\\\\\"bash -c ls\\\\\\\\\\\\\\"\\\\\\"\\""'
    expect(sensitiveKinds('Bash', { command: deep }).length).toBeGreaterThan(0)
    // An encoded PowerShell command cannot be read: it asks.
    expect(sensitiveKinds('Bash', { command: 'powershell -EncodedCommand ZQBjAGgAbwA=' })).toHaveLength(5)
    // curl writing with no host it can read
    expect(sensitiveKind('Bash', { command: 'curl -X POST "$URL"' })).toBe('send')
  })

  it('bad input never throws', () => {
    expect(sensitiveKind('Bash', null)).toBeNull()
    expect(sensitiveKind('Bash', { command: 42 })).toBeNull()
    expect(sensitiveKind('mcp__', {})).toBeNull()
    expect(sensitiveKind('mcp__srv', {})).toBeNull()
    expect(sensitiveKind('Bash', { command: 'echo "unterminated' })).toBeNull()
    expect(sensitiveKind('Bash', { command: 'echo $(git push' })).toBe('push')
  })

  it('guardReason names the kind and what was asked', () => {
    expect(guardReason('publish', 'Bash', { command: 'npm publish\n  --access public' })).toBe('Publicar: npm publish --access public')
    expect(guardReason('send', 'mcp__gmail__send_email', {})).toBe('Enviar: gmail › send_email')
    expect(guardReason('delete', 'Bash', { command: 'rm -rf ' + 'x'.repeat(300) }).length).toBeLessThan(140)
  })
})
