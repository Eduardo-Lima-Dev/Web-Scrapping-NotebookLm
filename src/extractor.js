import { normalizeStringsDeep } from './math-normalizer.js';

/**
 * Lê o DOM da página do NotebookLM e devolve um snapshot heurístico do estado do quiz.
 * Ajuste os seletores aqui se o layout do NotebookLM mudar.
 */

export async function extractQuizSnapshot(page) {
  const snap = await page.evaluate(() => {
    const subscriptDigits = {
      '0': '₀',
      '1': '₁',
      '2': '₂',
      '3': '₃',
      '4': '₄',
      '5': '₅',
      '6': '₆',
      '7': '₇',
      '8': '₈',
      '9': '₉',
    };

    function formatChemicalLikeTokens(input) {
      let out = input;
      // Ex.: "CO 2" -> "CO2"
      out = out.replace(/\b([A-Z]{1,5})\s+(\d{1,3})\b/g, '$1$2');
      // Ex.: "CO2" -> "CO₂", "CH4" -> "CH₄"
      out = out.replace(/\b([A-Z][A-Za-z0-9]{1,12})\b/g, (token) => {
        if (!/[A-Z]/.test(token) || !/\d/.test(token)) return token;
        return token.replace(/\d/g, (d) => subscriptDigits[d] || d);
      });
      return out;
    }

    function normalize(s) {
      const raw = (s || '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // remove zero-width chars
        .replace(/\s+/g, ' ')
        .trim();
      return formatChemicalLikeTokens(raw);
    }

    function questionHash(str) {
      let h = 0;
      const n = normalize(str).slice(0, 4000);
      for (let i = 0; i < n.length; i++) {
        h = ((h << 5) - h + n.charCodeAt(i)) | 0;
      }
      return String(h);
    }

    /** @type {string[]} */
    const rawHints = [];

    const questionContainer = document.querySelector('.quiz-container .question-container') ||
      document.querySelector('.question-container');
    const quizRoot =
      questionContainer ||
      document.querySelector('.quiz-container') ||
      document.querySelector('main') ||
      document.body;

    const bodyText = quizRoot ? normalize(quizRoot.innerText) : '';

    const feedbackPatterns = [
      /\bcorreto\b/i,
      /\bincorreto\b/i,
      /\bcorrect\b/i,
      /\bincorrect\b/i,
      /resposta\s+correta/i,
      /wrong\s+answer/i,
      /right\s+answer/i,
      /não é bem isso/i,
    ];
    let feedbackVisible = feedbackPatterns.some((re) => re.test(bodyText));

    function guessQuestionText() {
      const root = quizRoot;
      const exact = root.querySelector('h1.question-text');
      if (exact) {
        const t = normalize(exact.innerText);
        if (t.length > 12 && t.length < 8000) return t;
      }
      const headings = Array.from(
        root.querySelectorAll('h1, h2, h3, [role="heading"]')
      );
      for (const h of headings) {
        const t = normalize(h.innerText);
        if (t.length > 12 && t.length < 8000) return t;
      }
      const candidates = Array.from(
        root.querySelectorAll(
          'p, [class*="question"], [data-testid*="question"]'
        )
      );
      let best = '';
      for (const el of candidates) {
        const t = normalize(el.innerText);
        if (t.length > best.length && t.length < 8000) best = t;
      }
      if (best.length > 20) return best;
      return normalize(root.innerText).slice(0, 1500) || null;
    }

    function extractOptionLabelFromElement(el, text, index) {
      const prefixEl = el.querySelector('.answer-prefix');
      if (prefixEl) {
        const p = normalize(prefixEl.innerText).replace(/[\s.)\-:]/g, '');
        if (p) return p.toUpperCase();
      }
      const aria = normalize(el.getAttribute('aria-label') || '');
      const ariaMatch = aria.match(/^([A-Da-d]|\d+)\s*[.):\-]/);
      if (ariaMatch) return String(ariaMatch[1]).toUpperCase();
      const m = normalize(text).match(/^[\s]*([A-Da-d]|\d+)[\s.):\-]/);
      if (m) return String(m[1]).toUpperCase();
      return String.fromCharCode(65 + index);
    }

    function looksCorrect(el) {
      const blob =
        (el.getAttribute('aria-label') || '') +
        ' ' +
        (typeof el.className === 'string' ? el.className : '') +
        ' ' +
        normalize(el.innerText).slice(0, 200);
      if (/correct|correta|✓|check|success/i.test(blob)) return true;
      const icon = el.querySelector('[class*="correct"], [data-icon], svg');
      if (icon && /correct|check/i.test(icon.getAttribute('aria-label') || ''))
        return true;
      return false;
    }

    function looksIncorrectMarked(el) {
      const blob =
        (el.getAttribute('aria-label') || '') +
        ' ' +
        (typeof el.className === 'string' ? el.className : '');
      return /incorrect|incorreta|wrong|error/i.test(blob);
    }

    /** @returns {{ elements: Element[], kind: string }} */
    function findOptionElements() {
      const answerBtns = Array.from(
        quizRoot.querySelectorAll('.answer-options .answer-btn')
      );
      if (answerBtns.length >= 2) {
        rawHints.push(`.answer-btn: ${answerBtns.length}`);
        return { elements: answerBtns, kind: 'answer-btn' };
      }

      const radios = Array.from(quizRoot.querySelectorAll('[role="radio"]'));
      if (radios.length >= 2) {
        rawHints.push(`role=radio: ${radios.length}`);
        return { elements: radios, kind: 'role-radio' };
      }
      const inputs = Array.from(quizRoot.querySelectorAll('input[type="radio"]'));
      if (inputs.length >= 2) {
        rawHints.push(`input[type=radio]: ${inputs.length}`);
        return {
          elements: inputs.map((inp) => inp.closest('label') || inp.parentElement || inp),
          kind: 'input-radio',
        };
      }
      const group =
        quizRoot.querySelector('[role="radiogroup"]') ||
        quizRoot.querySelector('[class*="choice"], [class*="option"]');
      if (group) {
        const buttons = Array.from(
          group.querySelectorAll('button, [role="button"]')
        ).filter((b) => normalize(b.innerText).length > 0);
        if (buttons.length >= 2) {
          rawHints.push(`radiogroup buttons: ${buttons.length}`);
          return { elements: buttons, kind: 'group-buttons' };
        }
      }
      rawHints.push('fallback: candidate buttons');
      const all = Array.from(quizRoot.querySelectorAll('button, [role="button"]'));
      const filtered = all.filter((b) => {
        const t = normalize(b.innerText);
        return t.length > 1 && t.length < 500 && !/^próximo|next|voltar|back$/i.test(t);
      });
      return { elements: filtered.slice(0, 12), kind: 'fallback-buttons' };
    }

    const questionText = guessQuestionText();
    const qHash = questionText ? questionHash(questionText) : 'unknown';

    const { elements: optionEls, kind } = findOptionElements();
    if (!feedbackVisible) {
      feedbackVisible =
        optionEls.some((el) => /\banswered\b/.test(String(el.className || ''))) &&
        optionEls.some((el) => /\bcorrect\b|\bincorrect\b/.test(String(el.className || '')));
    }

    /** @type {{ label: string, text: string, explanation: string | null, selectedByUser: boolean, isCorrect: boolean }[]} */
    const alternatives = [];

    let userAnswer = null;
    let correctAnswer = null;

    optionEls.forEach((el, index) => {
      const textEl = el.querySelector('.answer-text');
      const text = normalize(textEl?.innerText || el.innerText || el.textContent || '');
      const rationaleEl = el.querySelector('.rationale');
      const altExplanation = rationaleEl ? normalize(rationaleEl.innerText) : null;
      const label = extractOptionLabelFromElement(el, text, index);

      let selectedByUser = false;
      if (el.getAttribute('aria-checked') === 'true') selectedByUser = true;
      if (el.getAttribute('aria-pressed') === 'true') selectedByUser = true;
      if (el.matches?.('input:checked')) selectedByUser = true;
      const cls = String(el.className || '');
      if (/selected|active|chosen/i.test(cls)) selectedByUser = true;
      // No layout atual do NotebookLM, a opção clicada costuma carregar "reaction-*".
      if (/\breaction-(correct|incorrect)\b/i.test(el.innerHTML || '')) selectedByUser = true;
      // Fallback antigo: algumas variantes marcam a escolhida como incorrect.
      if (!selectedByUser && /\bincorrect\b/i.test(cls)) selectedByUser = true;

      let isCorrect = false;
      if (feedbackVisible) {
        if (looksCorrect(el)) isCorrect = true;
        else if (looksIncorrectMarked(el) || selectedByUser) {
          if (selectedByUser && !looksCorrect(el)) isCorrect = false;
        }
        if (/\bcorrect\b/.test(String(el.className || ''))) isCorrect = true;
        if (/\bincorrect\b/.test(String(el.className || ''))) isCorrect = false;
        if (looksCorrect(el)) correctAnswer = label;
        if (/\bcorrect\b/.test(String(el.className || ''))) correctAnswer = label;
      }

      if (selectedByUser) userAnswer = label;

      alternatives.push({
        label,
        text: text.slice(0, 2000),
        explanation: altExplanation ? altExplanation.slice(0, 4000) : null,
        selectedByUser,
        isCorrect,
      });
    });

    if (feedbackVisible && correctAnswer == null) {
      const correctLine = bodyText.match(
        /(?:resposta\s+correta|correct\s+answer)\s*[:\s]*([A-D]|\d+)/i
      );
      if (correctLine) correctAnswer = correctLine[1].toUpperCase();
    }

    let explanation = null;
    const rationaleEls = Array.from(quizRoot.querySelectorAll('.answer-btn .rationale'));
    if (rationaleEls.length > 0) {
      explanation = rationaleEls
        .map((el) => normalize(el.innerText))
        .filter(Boolean)
        .join('\n')
        .slice(0, 8000);
    }
    const explBlocks = Array.from(
      document.querySelectorAll(
        '[class*="explanation"], [data-testid*="explanation"], aside, [role="region"]'
      )
    );
    for (const block of explBlocks) {
      const t = normalize(block.innerText);
      if (
        t.length > 30 &&
        (/explica|explain|porque|because|motivo/i.test(t) || explBlocks.length === 1)
      ) {
        explanation = t.slice(0, 8000);
        break;
      }
    }
    if (!explanation && feedbackVisible) {
      const lines = bodyText.split('\n').map(normalize);
      const idx = lines.findIndex((line) =>
        /explicação|explanation|por que|why/i.test(line)
      );
      if (idx >= 0) explanation = lines.slice(idx).join('\n').slice(0, 8000);
    }

    let result = null;
    if (feedbackVisible) {
      const head = bodyText.slice(0, 700);
      if (/\bincorreto\b|\bincorrect\b|\bwrong\b/i.test(head))
        result = 'incorrect';
      else if (/\bcorreto\b|\bcorrect\b|well done/i.test(head)) result = 'correct';
      if (userAnswer && correctAnswer) {
        result = userAnswer === correctAnswer ? 'correct' : 'incorrect';
      }
      if (!result) {
        result = userAnswer == null ? 'not_answered' : 'unknown';
      }
    }

    let hasNextButton = false;
    const buttons = Array.from(quizRoot.querySelectorAll('button, [role="button"]'));
    for (const b of buttons) {
      const lab = normalize(b.innerText || b.getAttribute('aria-label') || '');
      const cls = String(b.className || '');
      if (/^próxima$|^próximo$|^next$|^continuar$|^continue$/i.test(lab) || /\bnext-btn\b/.test(cls)) {
        hasNextButton = true;
        break;
      }
    }

    let quizCompleteGuess = false;
    if (
      /quiz\s+complete|questionário\s+concluído|resultado\s+final|your\s+score/i.test(
        bodyText
      ) &&
      !hasNextButton
    ) {
      quizCompleteGuess = true;
    }

    return {
      url: typeof location !== 'undefined' ? location.href : '',
      quizDetected: Boolean(questionContainer),
      questionText,
      questionHash: qHash,
      alternatives,
      optionDetectionKind: kind,
      userAnswer,
      correctAnswer,
      result,
      explanation,
      feedbackVisible,
      hasNextButton,
      quizCompleteGuess,
      rawHints,
    };
  });
  return normalizeStringsDeep(snap);
}
