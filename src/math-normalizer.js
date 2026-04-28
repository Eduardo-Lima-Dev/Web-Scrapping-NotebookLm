const SUBSCRIPT_DIGITS = {
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

const SUPERSCRIPT_DIGITS = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

/**
 * Normaliza texto técnico (química, matemática e física) para formato legível no JSON.
 * É heurístico: cobre os casos mais comuns sem depender de LaTeX/MathML.
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizeScientificText(input) {
  let out = String(input || '');

  // Remove caracteres invisíveis comuns no DOM.
  out = out.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // Normaliza espaços.
  out = out.replace(/\s+/g, ' ').trim();

  // Operadores e símbolos comuns.
  out = out
    .replace(/<=/g, '≤')
    .replace(/>=/g, '≥')
    .replace(/\+\-/g, '±')
    .replace(/\b(delta|Delta)\s*T\b/g, 'ΔT')
    .replace(/\bohm\b/gi, 'Ω');

  // Junta fórmulas quebradas por espaço: "CO 2" -> "CO2", "H 2 O" -> "H2O".
  out = out.replace(/\b([A-Z][a-z]?)\s+(\d)\b/g, '$1$2');
  out = out.replace(/\b([A-Z][a-z]?)\s+([A-Z][a-z]?)\b/g, '$1$2');

  // Converte índices químicos: CO2 -> CO₂, H2SO4 -> H₂SO₄
  out = out.replace(/\b([A-Z][A-Za-z0-9]{1,20})\b/g, (token) => {
    if (!/[A-Z]/.test(token) || !/\d/.test(token)) return token;
    return token.replace(/\d/g, (d) => SUBSCRIPT_DIGITS[d] || d);
  });

  // Converte expoentes simples: x^2 -> x², m^2 -> m², 10^3 -> 10³.
  out = out.replace(/\^([0-9]+)/g, (_, digits) =>
    String(digits)
      .split('')
      .map((d) => SUPERSCRIPT_DIGITS[d] || d)
      .join('')
  );

  return out;
}

/**
 * Aplica normalização em todas as strings de um objeto/array recursivamente.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function normalizeStringsDeep(value) {
  if (typeof value === 'string') {
    return /** @type {T} */ (normalizeScientificText(value));
  }
  if (Array.isArray(value)) {
    return /** @type {T} */ (value.map((v) => normalizeStringsDeep(v)));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalizeStringsDeep(v);
    }
    return /** @type {T} */ (out);
  }
  return value;
}
