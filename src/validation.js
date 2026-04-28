/**
 * Regras automáticas de validação do JSON de quiz.
 * Retorna inconsistências que merecem revisão antes de uso no NotebookLM.
 */

/**
 * @typedef {{ severity: 'error' | 'warning', code: string, message: string, questionIndex?: number }} ValidationIssue
 */

/**
 * @param {any} data
 * @returns {{ ok: boolean, errorCount: number, warningCount: number, issues: ValidationIssue[] }}
 */
export function validateQuizData(data) {
  /** @type {ValidationIssue[]} */
  const issues = [];

  if (!data || typeof data !== 'object') {
    issues.push({
      severity: 'error',
      code: 'invalid_root',
      message: 'JSON raiz inválido ou vazio.',
    });
    return summarize(issues);
  }

  const questions = Array.isArray(data.questions) ? data.questions : [];
  if (!Array.isArray(data.questions)) {
    issues.push({
      severity: 'error',
      code: 'questions_not_array',
      message: 'Campo questions não é array.',
    });
  }

  if (typeof data.totalQuestions === 'number' && data.totalQuestions !== questions.length) {
    issues.push({
      severity: 'warning',
      code: 'total_mismatch',
      message: `totalQuestions (${data.totalQuestions}) difere de questions.length (${questions.length}).`,
    });
  }

  for (const q of questions) {
    const idx = Number(q?.index) || undefined;
    const alts = Array.isArray(q?.alternatives) ? q.alternatives : [];

    if (!Array.isArray(q?.alternatives) || alts.length < 2) {
      issues.push({
        severity: 'error',
        code: 'alternatives_invalid',
        questionIndex: idx,
        message: 'Alternativas ausentes ou insuficientes.',
      });
      continue;
    }

    const labels = alts.map((a) => String(a?.label ?? '').trim()).filter(Boolean);
    const duplicateLabels = findDuplicates(labels);
    if (duplicateLabels.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'duplicate_labels',
        questionIndex: idx,
        message: `Labels repetidos: ${duplicateLabels.join(', ')}.`,
      });
    }

    const selected = alts.filter((a) => a?.selectedByUser === true);
    const correct = alts.filter((a) => a?.isCorrect === true);
    const selectedLabels = selected.map((a) => String(a?.label ?? '').trim()).filter(Boolean);
    const correctLabels = correct.map((a) => String(a?.label ?? '').trim()).filter(Boolean);

    if (selected.length > 1) {
      issues.push({
        severity: 'warning',
        code: 'multi_selected',
        questionIndex: idx,
        message: `Mais de uma alternativa marcada (${selected.length}).`,
      });
    }

    if (correct.length > 1) {
      issues.push({
        severity: 'warning',
        code: 'multi_correct',
        questionIndex: idx,
        message: `Mais de uma alternativa marcada como correta (${correct.length}).`,
      });
    }

    const userAnswer = q?.userAnswer == null ? null : String(q.userAnswer).trim();
    const correctAnswer = q?.correctAnswer == null ? null : String(q.correctAnswer).trim();
    const result = q?.result == null ? null : String(q.result).trim().toLowerCase();

    if (userAnswer && selectedLabels.length > 0 && !selectedLabels.includes(userAnswer)) {
      issues.push({
        severity: 'warning',
        code: 'user_answer_mismatch',
        questionIndex: idx,
        message: `userAnswer (${userAnswer}) não bate com alternativa marcada (${selectedLabels.join(', ')}).`,
      });
    }

    if (correctAnswer && correctLabels.length > 0 && !correctLabels.includes(correctAnswer)) {
      issues.push({
        severity: 'warning',
        code: 'correct_answer_mismatch',
        questionIndex: idx,
        message: `correctAnswer (${correctAnswer}) não bate com alternativa correta (${correctLabels.join(', ')}).`,
      });
    }

    if (result === 'correct' && userAnswer && correctAnswer && userAnswer !== correctAnswer) {
      issues.push({
        severity: 'error',
        code: 'result_conflict_correct',
        questionIndex: idx,
        message: 'result=correct mas userAnswer é diferente de correctAnswer.',
      });
    }

    if (result === 'incorrect' && userAnswer && correctAnswer && userAnswer === correctAnswer) {
      issues.push({
        severity: 'error',
        code: 'result_conflict_incorrect',
        questionIndex: idx,
        message: 'result=incorrect mas userAnswer é igual a correctAnswer.',
      });
    }

    if (result === 'unknown' && userAnswer && correctAnswer) {
      issues.push({
        severity: 'warning',
        code: 'result_unknown_with_answers',
        questionIndex: idx,
        message: 'result=unknown apesar de userAnswer e correctAnswer estarem preenchidos.',
      });
    }
  }

  return summarize(issues);
}

/**
 * @param {ValidationIssue[]} issues
 */
function summarize(issues) {
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    issues,
  };
}

/**
 * @param {string[]} arr
 */
function findDuplicates(arr) {
  const seen = new Set();
  const dup = new Set();
  for (const v of arr) {
    if (seen.has(v)) dup.add(v);
    else seen.add(v);
  }
  return [...dup];
}
