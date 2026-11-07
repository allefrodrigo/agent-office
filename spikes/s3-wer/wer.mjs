#!/usr/bin/env node
// Spike S-3: WER do whisper.cpp em pt-BR. Código descartável.
// Uso: node spikes/s3-wer/wer.mjs <corpus> [--models small,base] [--prompt-file vocab.txt]
//        [--out report.json] [--strip-accents] [--keep-hyp <dir>]
//      node spikes/s3-wer/wer.mjs --selftest
// Privacidade: nada de texto falado vai para stdout/stderr ou para o relatório.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, writeFile, rm, mkdir, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, extname, basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';
const WHISPER = process.env.WHISPER_CLI || '/opt/homebrew/bin/whisper-cli';
const MODELS_DIR = process.env.WHISPER_MODELS_DIR || join(homedir(), '.cache/hyperframes/whisper/models');
const AUDIO_EXT = ['.wav', '.mp3', '.m4a', '.ogg', '.flac'];

// ---------- WER ----------

export function normalize(text, { stripAccents = false } = {}) {
  let t = text.normalize('NFC').toLowerCase();
  if (stripAccents) t = t.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  // Tira pontuação e símbolos; mantém letras (com acento), números e espaços.
  t = t.replace(/[^\p{L}\p{N}\p{M}\s]+/gu, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export function wordErrors(ref, hyp) {
  const r = ref ? ref.split(' ') : [];
  const h = hyp ? hyp.split(' ') : [];
  const n = r.length, m = h.length;
  // dp[i][j] = { cost, s, d, i } mínimo para r[0..i) vs h[0..j)
  let prev = Array.from({ length: m + 1 }, (_, j) => ({ c: j, s: 0, d: 0, i: j }));
  for (let i = 1; i <= n; i++) {
    const cur = [{ c: i, s: 0, d: i, i: 0 }];
    for (let j = 1; j <= m; j++) {
      const same = r[i - 1] === h[j - 1];
      const diag = prev[j - 1], up = prev[j], left = cur[j - 1];
      const opts = [
        { c: diag.c + (same ? 0 : 1), s: diag.s + (same ? 0 : 1), d: diag.d, i: diag.i },
        { c: up.c + 1, s: up.s, d: up.d + 1, i: up.i },
        { c: left.c + 1, s: left.s, d: left.d, i: left.i + 1 },
      ];
      cur.push(opts.reduce((a, b) => (b.c < a.c ? b : a)));
    }
    prev = cur;
  }
  const { s, d, i } = prev[m];
  return { refWords: n, hypWords: m, sub: s, del: d, ins: i, errors: s + d + i, wer: n ? (s + d + i) / n : (m ? 1 : 0) };
}

function selftest() {
  const e1 = wordErrors(normalize('O gato subiu no telhado.'), normalize('o gato subiu no telhado'));
  assert.equal(e1.errors, 0);
  const e2 = wordErrors('a b c d', 'a x c');            // 1 S + 1 D
  assert.deepEqual([e2.sub, e2.del, e2.ins, e2.wer], [1, 1, 0, 0.5]);
  const e3 = wordErrors('a b', 'a b c d');              // 2 I
  assert.deepEqual([e3.sub, e3.del, e3.ins, e3.wer], [0, 0, 2, 1]);
  const e4 = wordErrors('', '');
  assert.equal(e4.wer, 0);
  assert.equal(normalize('Reunião   às 14h, OK?'), 'reunião às 14h ok');
  assert.equal(normalize('Reunião às', { stripAccents: true }), 'reuniao as');
  const e5 = wordErrors(normalize('você está aí'), normalize('voce esta ai'));
  assert.equal(e5.sub, 3);
  console.log('selftest ok (5 casos de WER, 2 de normalização)');
}

// ---------- áudio ----------

async function wavInfo(path) {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, 4096, 0);
    if (bytesRead < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
    let off = 12, fmt = null;
    while (off + 8 <= bytesRead) {
      const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
      if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
      if (id === 'data' && fmt) return { ...fmt, seconds: size / (fmt.rate * fmt.channels * (fmt.bits / 8)) };
      off += 8 + size + (size % 2);
    }
    return null;
  } finally { await fh.close(); }
}

async function toWav16k(src, dst) {
  const info = extname(src).toLowerCase() === '.wav' ? await wavInfo(src) : null;
  if (info && info.format === 1 && info.channels === 1 && info.rate === 16000 && info.bits === 16) return src;
  await run(FFMPEG, ['-nostdin', '-loglevel', 'error', '-y', '-i', src, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', dst]);
  return dst;
}

// ---------- whisper ----------

async function transcribe(model, wav, outBase, prompt) {
  const args = ['-m', model, '-f', wav, '-l', 'pt', '-nt', '-np', '-otxt', '-of', outBase];
  if (prompt) args.push('--prompt', prompt);
  const t0 = process.hrtime.bigint();
  // stdout/stderr descartados: contêm texto falado.
  await run(WHISPER, args, { maxBuffer: 64 * 1024 * 1024 });
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  return { text: await readFile(outBase + '.txt', 'utf8'), secs };
}

// ---------- corpus ----------

async function loadCorpus(dir) {
  const names = await readdir(dir);
  const set = new Set(names);
  const cases = [];
  for (const f of names.sort()) {
    const ext = extname(f).toLowerCase();
    if (!AUDIO_EXT.includes(ext)) continue;
    const name = basename(f, extname(f));
    if (!set.has(name + '.txt')) { console.warn(`aviso: ${f} sem ${name}.txt, ignorado`); continue; }
    const promptPath = join(dir, name + '.prompt.txt');
    cases.push({
      name, audio: join(dir, f), ref: join(dir, name + '.txt'),
      prompt: existsSync(promptPath) ? (await readFile(promptPath, 'utf8')).trim() : null,
    });
  }
  return cases;
}

const pct = (x) => (x * 100).toFixed(1) + '%';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      models: { type: 'string', default: 'small,base' },
      'prompt-file': { type: 'string' },
      out: { type: 'string' },
      'strip-accents': { type: 'boolean', default: false },
      'keep-hyp': { type: 'string' },
      selftest: { type: 'boolean', default: false },
    },
  });
  if (values.selftest) return selftest();

  const corpus = positionals[0] || process.env.AGENT_OFFICE_WER_CORPUS;
  if (!corpus) { console.error('Informe a pasta do corpus (argumento ou AGENT_OFFICE_WER_CORPUS).'); process.exit(2); }
  const dir = resolve(corpus);
  const models = values.models.split(',').map((m) => m.trim()).filter(Boolean).map((m) => {
    const path = m.endsWith('.bin') ? resolve(m) : join(MODELS_DIR, `ggml-${m}.bin`);
    if (!existsSync(path)) { console.error(`Modelo não encontrado: ${path}`); process.exit(2); }
    return { name: m, path };
  });

  let globalPrompt = null;
  if (values['prompt-file']) globalPrompt = (await readFile(resolve(values['prompt-file']), 'utf8')).trim();
  else if (existsSync(join(dir, 'prompt.txt'))) globalPrompt = (await readFile(join(dir, 'prompt.txt'), 'utf8')).trim();

  const cases = await loadCorpus(dir);
  if (!cases.length) { console.error('Nenhum caso válido (<nome>.<áudio> + <nome>.txt) na pasta.'); process.exit(2); }

  const keepHyp = values['keep-hyp'] ? resolve(values['keep-hyp']) : null;
  if (keepHyp) {
    await mkdir(keepHyp, { recursive: true });
    console.warn(`ATENÇÃO: ${keepHyp} vai guardar as transcrições (conteúdo falado). Apague depois.`);
  }

  const norm = { stripAccents: values['strip-accents'] };
  const tmp = await mkdtemp(join(tmpdir(), 's3-wer-'));
  const results = [];
  const cleanup = () => rm(tmp, { recursive: true, force: true });
  process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

  try {
    for (const c of cases) {
      const wav = await toWav16k(c.audio, join(tmp, c.name + '.wav'));
      const info = await wavInfo(wav);
      const ref = normalize(await readFile(c.ref, 'utf8'), norm);
      const prompt = c.prompt ?? globalPrompt;
      const conditions = [{ id: 'sem-prompt', prompt: null }];
      if (prompt) conditions.push({ id: c.prompt ? 'prompt-arquivo' : 'prompt-global', prompt });

      for (const m of models) {
        for (const cond of conditions) {
          const outBase = join(tmp, `${c.name}.${m.name}.${cond.id}`);
          const { text, secs } = await transcribe(m.path, wav, outBase, cond.prompt);
          if (keepHyp) await writeFile(join(keepHyp, `${c.name}.${m.name}.${cond.id}.txt`), text);
          const e = wordErrors(ref, normalize(text, norm));
          const r = { file: c.name, model: m.name, condition: cond.id, audioSec: +info.seconds.toFixed(2), transcribeSec: +secs.toFixed(2), rtf: +(secs / info.seconds).toFixed(3), ...e, wer: +e.wer.toFixed(4) };
          results.push(r);
          console.log(`${r.file}  ${r.model}  ${r.condition}  WER ${pct(r.wer)}  (S${r.sub} D${r.del} I${r.ins} / ${r.refWords})  RTF ${r.rtf}`);
        }
      }
    }
  } finally {
    await cleanup();
  }

  // Agregado: "com prompt" junta prompt-arquivo e prompt-global.
  const groups = new Map();
  for (const r of results) {
    const key = `${r.model}|${r.condition === 'sem-prompt' ? 'sem-prompt' : 'com-prompt'}`;
    const g = groups.get(key) || { model: r.model, prompt: key.split('|')[1], files: 0, refWords: 0, sub: 0, del: 0, ins: 0, errors: 0, audioSec: 0, transcribeSec: 0 };
    g.files++; for (const k of ['refWords', 'sub', 'del', 'ins', 'errors', 'audioSec', 'transcribeSec']) g[k] += r[k];
    groups.set(key, g);
  }
  const aggregate = [...groups.values()].map((g) => ({
    ...g, audioSec: +g.audioSec.toFixed(2), transcribeSec: +g.transcribeSec.toFixed(2),
    wer: +(g.errors / g.refWords).toFixed(4), rtf: +(g.transcribeSec / g.audioSec).toFixed(3),
    meetsTarget: g.errors / g.refWords <= 0.15,
  }));

  console.log('\nAgregado (soma dos erros / soma das palavras de referência)');
  console.table(aggregate.map((a) => ({ modelo: a.model, prompt: a.prompt, arquivos: a.files, palavras: a.refWords, S: a.sub, D: a.del, I: a.ins, WER: pct(a.wer), RTF: a.rtf, 'meta ≤15%': a.meetsTarget ? 'sim' : 'não' })));

  if (values.out) {
    const report = {
      generatedAt: new Date().toISOString(), corpus: basename(dir), whisper: WHISPER,
      normalization: { lowercase: true, nfc: true, stripPunctuation: true, stripAccents: norm.stripAccents },
      target: { model: 'small', maxWer: 0.15 }, perFile: results, aggregate,
    };
    await writeFile(resolve(values.out), JSON.stringify(report, null, 2) + '\n');
    console.log(`Relatório: ${resolve(values.out)}`);
  }
}

main().catch((err) => {
  // Mensagem curta: o stderr do whisper pode ter texto falado.
  console.error('Erro:', err.code ?? '', err.message?.split('\n')[0]);
  process.exit(1);
});
