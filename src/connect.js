import puppeteer from 'puppeteer-core';

/**
 * Verifica se o Chrome está expondo o endpoint de debugging.
 * @param {string} browserURL - ex.: http://localhost:9222
 */
export async function pingBrowser(browserURL) {
  const u = browserURL.replace(/\/$/, '');
  const res = await fetch(`${u}/json/version`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(
      `Chrome não acessível em ${u}. Inicie o Chrome com --remote-debugging-port=9222 e tente de novo.`
    );
  }
  return res.json();
}

/**
 * Conecta ao Chrome existente e retorna a primeira página cujo URL contém notebooklm.google.com.
 * @param {object} opts
 * @param {string} [opts.browserURL]
 * @param {string} [opts.urlIncludes] - substring para identificar a aba (default: notebooklm.google.com)
 */
export async function connectToNotebookLM(opts = {}) {
  const browserURL = opts.browserURL || process.env.CHROME_DEBUG_URL || 'http://localhost:9222';
  const urlIncludes = opts.urlIncludes || 'notebooklm.google.com';

  await pingBrowser(browserURL);

  const browser = await puppeteer.connect({
    browserURL: browserURL.replace(/\/$/, ''),
    defaultViewport: null,
  });

  const pages = await browser.pages();
  let targetPage = pages.find((p) => {
    try {
      return p.url().includes(urlIncludes);
    } catch {
      return false;
    }
  });

  if (!targetPage) {
    await browser.disconnect();
    throw new Error(
      `Nenhuma aba encontrada com URL contendo "${urlIncludes}". ` +
        'Abra o NotebookLM nesse Chrome e tente novamente.'
    );
  }

  return { browser, page: targetPage, browserURL };
}
