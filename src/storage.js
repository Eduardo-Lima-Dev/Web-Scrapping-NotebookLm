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
  const filePath = path.join(outputDir, `quiz-${stamp}.json`);

  const data = {
    capturedAt: new Date().toISOString(),
    source: 'notebooklm',
    url: '',
    totalQuestions: 0,
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

  return { filePath, data, addQuestion, flush, setUrl, setLevel };
}
