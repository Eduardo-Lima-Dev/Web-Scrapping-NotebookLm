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
  const autoPlay = options.autoPlay ?? false;
  const autoCooldownMs = options.autoCooldownMs ?? 700;

  const savedHashes = new Set();
  /** Último snapshot em que já apareceu feedback (por hash da questão). */
  const feedbackCache = new Map();
  /** Quantas vezes seguidas vimos feedback para o hash atual (anti-ruído). */
  const feedbackSeenCount = new Map();
  /** @type {string | null} */
  let lastQuestionHash = null;
  let lastUrl = '';
  let noQuizTicks = 0;
  let lastAutoActionAt = 0;
  let everDetectedQuiz = false;

  const started = Date.now();
  const maxMs = maxMinutes * 60 * 1000;

  let consecutiveComplete = 0;

  async function persistSnapshot(snap) {
    const idx = storage.data.questions.length + 1;
    await storage.addQuestion({
      index: idx,
      question: snap.questionText,
      alternatives: snap.alternatives,
    });
    console.log(`[capturado] questão ${idx}`);
  }

  while (Date.now() - started < maxMs) {
    await delay(pollMs);

    const best = await extractBestSnapshot(page).catch((err) => {
      console.warn('[aviso] falha ao ler página:', err.message);
      return null;
    });
    if (!best) continue;
    const { snap, frame } = best;

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
      everDetectedQuiz = true;
      noQuizTicks = 0;
    }

    // Em modo AUTO, se o quiz já foi detectado e depois desapareceu por alguns ciclos,
    // assumimos fim do fluxo (ex.: clique em "Concluir" levou para tela/estado final).
    if (autoPlay && everDetectedQuiz && !snap.quizDetected && noQuizTicks >= 6) {
      console.log('[fim] Quiz não detectado após etapa final no modo AUTO. Encerrando captura.');
      break;
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

    if (autoPlay && snap.quizDetected) {
      const action = await autoPlayStep(frame, snap, {
        cooldownMs: autoCooldownMs,
        getLastActionAt: () => lastAutoActionAt,
        setLastActionAt: (t) => {
          lastAutoActionAt = t;
        },
      });
      if (action === 'finish') {
        if (lastQuestionHash && !savedHashes.has(lastQuestionHash)) {
          const last = feedbackCache.get(lastQuestionHash);
          if (last?.feedbackVisible) {
            await persistSnapshot(last);
            savedHashes.add(lastQuestionHash);
          }
        }
        console.log('[fim] Concluir/Finalizar detectado no modo AUTO.');
        break;
      }
      if (action) {
        await delay(Math.min(350, pollMs));
      }
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
  /** @type {Array<{ frame: import('puppeteer-core').Frame, snap: any }>} */
  const snaps = [];

  for (const frame of frames) {
    try {
      const s = await extractQuizSnapshot(frame);
      snaps.push({ frame, snap: s });
    } catch {
      // Alguns frames podem falhar por timing/navegação; ignoramos.
    }
  }

  if (snaps.length === 0) {
    return {
      frame: page.mainFrame(),
      snap: await extractQuizSnapshot(page),
    };
  }

  let best = snaps[0];
  let bestScore = scoreSnapshot(best.snap);
  for (let i = 1; i < snaps.length; i++) {
    const candidate = snaps[i];
    const sc = scoreSnapshot(candidate.snap);
    if (sc > bestScore) {
      best = candidate;
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

/**
 * @param {import('puppeteer-core').Frame} frame
 * @param {any} snap
 * @param {{ cooldownMs: number, getLastActionAt: () => number, setLastActionAt: (t: number) => void }} ctx
 * @returns {Promise<'option' | 'next' | 'finish' | false>}
 */
async function autoPlayStep(frame, snap, ctx) {
  const now = Date.now();
  if (now - ctx.getLastActionAt() < ctx.cooldownMs) return false;

  if (!snap.feedbackVisible) {
    const clickedOption = await clickInFrame(frame, () => {
      const candidates = Array.from(
        document.querySelectorAll('.answer-options .answer-btn, .answer-btn')
      ).filter((el) => {
        const btn = /** @type {HTMLButtonElement} */ (el);
        if (btn.disabled) return false;
        const text = (btn.innerText || '').trim();
        return text.length > 0;
      });
      const target = candidates[0];
      if (!target) return false;
      /** @type {HTMLElement} */ (target).click();
      return true;
    });
    if (clickedOption) {
      console.log('[auto] Alternativa clicada.');
      ctx.setLastActionAt(now);
      return 'option';
    }
    return false;
  }

  const clickedNext = await clickInFrame(frame, () => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    for (const b of buttons) {
      const el = /** @type {HTMLElement} */ (b);
      const txt = (el.innerText || el.getAttribute('aria-label') || '')
        .trim()
        .toLowerCase();
      const cls = String(el.className || '');
      if (
        /\bnext-btn\b/.test(cls) ||
        txt === 'próxima' ||
        txt === 'próximo' ||
        txt === 'next' ||
        txt === 'continuar' ||
        txt === 'continue'
      ) {
        if ('disabled' in el && /** @type {HTMLButtonElement} */ (el).disabled) continue;
        el.click();
        return true;
      }
    }
    return false;
  });
  if (clickedNext) {
    console.log('[auto] Botão Próxima/Next clicado.');
    ctx.setLastActionAt(now);
    return 'next';
  }

  const clickedFinish = await clickInFrame(frame, () => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    for (const b of buttons) {
      const el = /** @type {HTMLElement} */ (b);
      const txt = (el.innerText || el.getAttribute('aria-label') || '')
        .trim()
        .toLowerCase();
      if (
        txt.includes('concluir') ||
        txt.includes('finalizar') ||
        txt.includes('encerrar') ||
        txt.includes('finish') ||
        txt.includes('submit')
      ) {
        if ('disabled' in el && /** @type {HTMLButtonElement} */ (el).disabled) continue;
        el.click();
        return true;
      }
    }
    return false;
  });
  if (clickedFinish) {
    console.log('[auto] Botão Concluir/Finalizar clicado.');
    ctx.setLastActionAt(now);
    return 'finish';
  }

  return false;
}

/**
 * @template T
 * @param {import('puppeteer-core').Frame} frame
 * @param {() => T} fn
 * @returns {Promise<T | false>}
 */
async function clickInFrame(frame, fn) {
  try {
    return await frame.evaluate(fn);
  } catch {
    return false;
  }
}
