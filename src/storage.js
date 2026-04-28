import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function defaultOutputDir() {
  return path.join(__dirname, '..', 'output');
}

/**
 * @param {string} outputDir
 */
export function createStorage(outputDir = defaultOutputDir()) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let filePath = path.join(outputDir, `quiz-${stamp}.json`);

  const data = {
    capturedAt: new Date().toISOString(),
    source: 'notebooklm',
    url: '',
    totalQuestions: 0,
    subject: null,
    level: null,
    questions: [],
  };

  async function flush() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * @param {object} q - registro da questão
   */
  async function addQuestion(q) {
    data.questions.push(q);
    data.totalQuestions = data.questions.length;
    await flush();
  }

  /** @param {string} url */
  function setUrl(url) {
    if (url && !data.url) data.url = url;
  }

  /** @param {'facil' | 'medio' | 'dificil'} level */
  function setLevel(level) {
    data.level = level;
  }

  /** @param {string} subject */
  function setSubject(subject) {
    data.subject = subject;
  }

  /** @param {string} quizName */
  function setQuizName(quizName) {
    const normalized = String(quizName || '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    const base = normalized || `quiz-${stamp}`;
    const file = base.endsWith('.json') ? base : `${base}.json`;
    filePath = path.join(outputDir, file);
  }

  return {
    get filePath() {
      return filePath;
    },
    data,
    addQuestion,
    flush,
    setUrl,
    setSubject,
    setLevel,
    setQuizName,
  };
}
