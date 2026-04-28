import { extractQuizSnapshot } from './extractor.js';

/**
 * Loop principal: polling no DOM até capturar feedback de cada questão e detectar fim do quiz.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {ReturnType<import('./storage.js').createStorage>} storage
 * @param {object} [options]
 * @param {number} [options.pollMs]
 * @param {number} [options.maxMinutes] - segurança contra loop infinito
 */
export async function runCaptureLoop(page, storage, options = {}) {
  const pollMs = options.pollMs ?? 500;
  const maxMinutes = options.maxMinutes ?? 120;

  const savedHashes = new Set();
  /** Último snapshot em que já apareceu feedback (por hash da questão). */
  const feedbackCache = new Map();
  /** Quantas vezes seguidas vimos feedback para o hash atual (anti-ruído). */
  const feedbackSeenCount = new Map();
  /** @type {string | null} */
  let lastQuestionHash = null;
  let lastUrl = '';
  let noQuizTicks = 0;

  const started = Date.now();
  const maxMs = maxMinutes * 60 * 1000;

  let consecutiveComplete = 0;

  async function persistSnapshot(snap) {
    const idx = storage.data.questions.length + 1;
    await storage.addQuestion({
      index: idx,
      question: snap.questionText,
      alternatives: snap.alternatives,
      userAnswer: snap.userAnswer,
      correctAnswer: snap.correctAnswer,
      result: snap.result,
      explanation: snap.explanation,
    });
    console.log(`[capturado] questão ${idx}`);
  }

  while (Date.now() - started < maxMs) {
    await delay(pollMs);

    const snap = await extractBestSnapshot(page).catch((err) => {
      console.warn('[aviso] falha ao ler página:', err.message);
      return null;
    });
    if (!snap) continue;

    if (snap.url && snap.url !== lastUrl) {
      storage.setUrl(snap.url);
      lastUrl = snap.url;
    }

    if (!snap.quizDetected) {
      noQuizTicks++;
      if (noQuizTicks % 10 === 0) {
        console.log(
          '[aguardando] Quiz não detectado nesta aba do NotebookLM. Abra a janela do quiz nesta mesma instância do Chrome (remote debugging).'
        );
      }
    } else {
      noQuizTicks = 0;
    }

    if (snap.feedbackVisible && snap.questionHash && snap.questionText) {
      feedbackCache.set(snap.questionHash, snap);
      feedbackSeenCount.set(
        snap.questionHash,
        (feedbackSeenCount.get(snap.questionHash) || 0) + 1
      );
    } else if (snap.questionHash) {
      feedbackSeenCount.set(snap.questionHash, 0);
    }

    const currentHash = snap.questionHash || null;

    if (
      lastQuestionHash !== null &&
      currentHash !== null &&
      currentHash !== lastQuestionHash
    ) {
      const prevSnap = feedbackCache.get(lastQuestionHash);
      if (prevSnap && !savedHashes.has(lastQuestionHash)) {
        await persistSnapshot(prevSnap);
        savedHashes.add(lastQuestionHash);
      }
    }

    if (currentHash !== null) {
      lastQuestionHash = currentHash;
    }

    // Salva imediatamente quando feedback da questão atual já está visível e estável.
    if (
      currentHash &&
      !savedHashes.has(currentHash) &&
      (feedbackSeenCount.get(currentHash) || 0) >= 2
    ) {
      const currentSnap = feedbackCache.get(currentHash);
      if (currentSnap?.feedbackVisible) {
        await persistSnapshot(currentSnap);
        savedHashes.add(currentHash);
      }
    }

    if (snap.quizCompleteGuess) {
      consecutiveComplete++;
      if (consecutiveComplete >= 3) {
        if (lastQuestionHash && !savedHashes.has(lastQuestionHash)) {
          const last = feedbackCache.get(lastQuestionHash);
          if (last?.feedbackVisible) {
            await persistSnapshot(last);
            savedHashes.add(lastQuestionHash);
          }
        }
        console.log('[fim] Tela de conclusão / resultado detectada.');
        break;
      }
    } else {
      consecutiveComplete = 0;
    }
  }

  if (Date.now() - started >= maxMs) {
    console.warn(
      `[aviso] Tempo máximo (${maxMinutes} min) atingido. Salvando o que foi capturado.`
    );
  }

  if (lastQuestionHash && !savedHashes.has(lastQuestionHash)) {
    const last = feedbackCache.get(lastQuestionHash);
    if (last?.feedbackVisible) {
      await persistSnapshot(last);
      savedHashes.add(lastQuestionHash);
    }
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function extractBestSnapshot(page) {
  const frames = page.frames();
  /** @type {Array<any>} */
  const snaps = [];

  for (const frame of frames) {
    try {
      const s = await extractQuizSnapshot(frame);
      snaps.push(s);
    } catch {
      // Alguns frames podem falhar por timing/navegação; ignoramos.
    }
  }

  if (snaps.length === 0) {
    return extractQuizSnapshot(page);
  }

  let best = snaps[0];
  let bestScore = scoreSnapshot(best);
  for (let i = 1; i < snaps.length; i++) {
    const s = snaps[i];
    const sc = scoreSnapshot(s);
    if (sc > bestScore) {
      best = s;
      bestScore = sc;
    }
  }
  return best;
}

function scoreSnapshot(s) {
  let score = 0;
  if (s.quizDetected) score += 100;
  score += Math.min((s.alternatives?.length || 0) * 10, 80);
  if (s.feedbackVisible) score += 40;
  if (s.hasNextButton) score += 20;
  if ((s.questionText || '').length > 20) score += 20;
  if (/blob:/i.test(s.url || '')) score += 5;
  if (/question|quiz|teste|resposta|correta|incorreta/i.test(s.questionText || ''))
    score += 15;
  return score;
}
