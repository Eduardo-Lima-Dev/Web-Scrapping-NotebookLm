#!/usr/bin/env node
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

import { connectToNotebookLM } from './connect.js';
import { runCaptureLoop } from './capture-loop.js';
import { createStorage, defaultOutputDir } from './storage.js';
import { validateQuizData } from './validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {
    browserURL: process.env.CHROME_DEBUG_URL || 'http://localhost:9222',
    outputDir: process.env.OUTPUT_DIR || defaultOutputDir(),
    maxMinutes: Number(process.env.MAX_MINUTES || '120') || 120,
    pollMs: Number(process.env.POLL_MS || '500') || 500,
    autoPlay: String(process.env.AUTO_PLAY || '').trim() === '1',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && argv[i + 1]) {
      out.browserURL = argv[++i];
    } else if (a === '--output' && argv[i + 1]) {
      out.outputDir = path.resolve(argv[++i]);
    } else if (a === '--max-minutes' && argv[i + 1]) {
      out.maxMinutes = Number(argv[++i]) || 120;
    } else if (a === '--poll-ms' && argv[i + 1]) {
      out.pollMs = Number(argv[++i]) || 500;
    } else if (a === '--auto') {
      out.autoPlay = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function printHelp() {
  console.log(`
Uso: node src/index.js [opções]

Variáveis de ambiente:
  CHROME_DEBUG_URL   URL do Chrome com debugging (default: http://localhost:9222)
  OUTPUT_DIR         Pasta para JSON (default: ./output)
  MAX_MINUTES        Tempo máximo de captura (default: 120)
  POLL_MS            Intervalo de polling em ms (default: 500)

Opções:
  --url <url>        Mesmo que CHROME_DEBUG_URL
  --output <dir>     Pasta de saída
  --max-minutes <n>  Tempo máximo em minutos
  --poll-ms <n>      Intervalo de polling
  --auto             Clica automaticamente em alternativa, Próxima e Concluir
  -h, --help         Esta ajuda

Antes: inicie o Chrome com --remote-debugging-port=9222, abra o NotebookLM,
inicie o quiz e rode este script. Pressione ENTER quando estiver na primeira
questão (ou na questão atual). Responda manualmente; o script grava cada
questão após o feedback aparecer.
`);
}

async function waitEnter(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve(undefined);
    });
  });
}

async function askQuizName() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const name = await new Promise((resolve) => {
    const ask = () => {
      rl.question('\nDigite o nome do quiz (será usado no nome do arquivo JSON): ', (answer) => {
        const normalized = String(answer || '').trim();
        if (!normalized) {
          console.log('[aviso] Nome inválido. Tente novamente.');
          ask();
          return;
        }
        resolve(normalized);
      });
    };
    ask();
  });

  rl.close();
  return name;
}

async function askLevel() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const map = {
    '1': 'facil',
    '2': 'medio',
    '3': 'dificil',
    facil: 'facil',
    medio: 'medio',
    difícil: 'dificil',
    dificil: 'dificil',
  };

  const prompt =
    '\nSelecione o nível do quiz:\n' +
    '  1) facil\n' +
    '  2) medio\n' +
    '  3) dificil\n' +
    'Digite o número ou nome do nível: ';

  const level = await new Promise((resolve) => {
    const ask = () => {
      rl.question(prompt, (answer) => {
        const normalized = String(answer || '')
          .trim()
          .toLowerCase();
        const parsed = map[normalized];
        if (!parsed) {
          console.log('[aviso] Opção inválida. Tente novamente.');
          ask();
          return;
        }
        resolve(parsed);
      });
    };
    ask();
  });

  rl.close();
  return level;
}

async function askSubject() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const options = [
    'ciencias',
    'matematica',
    'portugues',
    'historia',
    'geografia',
    'biologia',
    'fisica',
    'quimica',
    'ingles',
  ];
  const map = Object.fromEntries(options.map((opt, i) => [String(i + 1), opt]));
  for (const opt of options) map[opt] = opt;

  const prompt =
    '\nSelecione a matéria do quiz:\n' +
    options.map((opt, i) => `  ${i + 1}) ${opt}`).join('\n') +
    '\nDigite o número ou nome da matéria: ';

  const subject = await new Promise((resolve) => {
    const ask = () => {
      rl.question(prompt, (answer) => {
        const normalized = String(answer || '')
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        const parsed = map[normalized];
        if (!parsed) {
          console.log('[aviso] Matéria inválida. Tente novamente.');
          ask();
          return;
        }
        resolve(parsed);
      });
    };
    ask();
  });

  rl.close();
  return subject;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const storage = createStorage(args.outputDir);
  console.log(`[info] Arquivo de saída: ${storage.filePath}`);

  let browser;
  let shuttingDown = false;

  function printValidationReport() {
    const report = validateQuizData(storage.data);
    if (report.ok && report.warningCount === 0) {
      console.log('[validação] OK: nenhuma inconsistência detectada.');
      return;
    }
    console.log(
      `[validação] ${report.errorCount} erro(s), ${report.warningCount} aviso(s).`
    );
    for (const issue of report.issues.slice(0, 20)) {
      const q = issue.questionIndex ? `Q${issue.questionIndex} ` : '';
      const tag = issue.severity === 'error' ? 'ERRO' : 'AVISO';
      console.log(`[validação] ${tag} ${q}${issue.code}: ${issue.message}`);
    }
    if (report.issues.length > 20) {
      console.log(
        `[validação] ... e mais ${report.issues.length - 20} inconsistência(s).`
      );
    }
  }

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[info] ${signal}: gravando JSON parcial…`);
    try {
      await storage.flush();
      console.log(`[info] Salvo em: ${storage.filePath}`);
      printValidationReport();
    } catch (e) {
      console.error('[erro] Falha ao salvar:', e.message);
    }
    try {
      if (browser && typeof browser.disconnect === 'function') {
        await browser.disconnect();
      }
    } catch {
      /* ignore */
    }
    process.exit(signal === 'SIGINT' ? 130 : 1);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  console.log('[info] Conectando ao Chrome…');
  const connected = await connectToNotebookLM({
    browserURL: args.browserURL,
  });
  browser = connected.browser;
  const { page } = connected;

  await waitEnter(
    '\n>>> Pressione ENTER quando o quiz estiver visível e você estiver pronto para começar a responder.\n'
  );

  const quizName = await askQuizName();
  storage.setQuizName(quizName);
  console.log(`[info] Arquivo de saída definido: ${storage.filePath}`);

  const subject = await askSubject();
  storage.setSubject(subject);
  console.log(`[info] Matéria selecionada: ${subject}`);

  const level = await askLevel();
  storage.setLevel(level);
  await storage.flush();
  console.log(`[info] Nível selecionado: ${level}`);

  if (args.autoPlay) {
    console.log(
      '[info] Captura iniciada em modo AUTO. O script irá clicar em alternativas e avançar automaticamente.\n'
    );
  } else {
    console.log(
      '[info] Captura iniciada. Responda as questões no Chrome; Ctrl+C encerra e salva.\n'
    );
  }

  try {
    await runCaptureLoop(page, storage, {
      pollMs: args.pollMs,
      maxMinutes: args.maxMinutes,
      autoPlay: args.autoPlay,
    });
  } finally {
    await storage.flush();
    printValidationReport();
    console.log(`\n[info] Concluído. Total: ${storage.data.totalQuestions} questão(ões).`);
    console.log(`[info] Arquivo: ${storage.filePath}`);
    if (browser && typeof browser.disconnect === 'function') {
      await browser.disconnect();
    }
  }
}

main().catch((err) => {
  console.error('[erro]', err.message || err);
  process.exit(1);
});
