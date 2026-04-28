# Scraper NotebookLM (quiz)

Script em Node.js que se conecta ao **Google Chrome já aberto** (remote debugging), observa o quiz do **NotebookLM** enquanto você responde manualmente e grava **enunciado, alternativas, resposta marcada, gabarito e explicação** em um arquivo JSON.

## Pré-requisitos

- Node.js 18+
- Google Chrome

## 1. Abrir o Chrome em modo debug

No macOS:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-notebooklm-debug"
```

No Linux (ajuste o caminho do Chrome):

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-notebooklm-debug"
```

Faça login na sua conta Google nesse Chrome, abra o [NotebookLM](https://notebooklm.google.com/), entre no notebook desejado e **inicie o quiz** até a primeira questão ficar visível.

No Windows (Prompt ou PowerShell), exemplo:

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\.chrome-notebooklm-debug"
```

## 2. Instalar dependências

```bash
cd scraper-notebook
npm install
```

## 3. Rodar o capturador

```bash
npm start
```

Ou:

```bash
node src/index.js
```

Quando aparecer o prompt, pressione **ENTER** para começar a registrar. **Responda cada questão no Chrome**; quando o feedback (correto/incorreta + explicação) aparecer, o script atualiza o cache e **salva a questão ao mudar para a próxima** ou ao detectar a tela de fim.

O arquivo é gravado em `output/quiz-<timestamp>.json` de forma **incremental** após cada questão capturada.
Após o ENTER, o script solicita o nível do quiz (`facil`, `medio` ou `dificil`) e grava esse valor no campo `level` do JSON.

### Validação automática pós-execução

Ao finalizar (normalmente ou com `Ctrl+C`), o script executa validações de consistência no JSON e imprime um relatório no terminal, por exemplo:

- divergência entre `totalQuestions` e `questions.length`
- labels duplicados em alternativas
- conflito entre `selectedByUser` e `userAnswer`
- conflito entre `isCorrect` e `correctAnswer`
- conflito entre `result` e (`userAnswer`, `correctAnswer`)

Se aparecerem avisos/erros, revise o JSON antes de enviar para o NotebookLM.

### Opções

| Variável / flag | Descrição |
| --------------- | --------- |
| `CHROME_DEBUG_URL` / `--url` | URL do debugging (padrão: `http://localhost:9222`) |
| `OUTPUT_DIR` / `--output` | Pasta de saída (padrão: `./output`) |
| `MAX_MINUTES` / `--max-minutes` | Tempo máximo de execução (padrão: 120) |
| `POLL_MS` / `--poll-ms` | Intervalo de leitura do DOM em ms (padrão: 500) |

Exemplo:

```bash
OUTPUT_DIR=./meus-quizzes node src/index.js --max-minutes 60
```

### Encerrar com Ctrl+C

O script tenta **gravar o JSON parcial** antes de sair.

## Ajustando seletores

O NotebookLM pode mudar o HTML. Edite [`src/extractor.js`](src/extractor.js) para refinar como o enunciado, alternativas e explicação são detectados (comentários indicam a área heurística).

## Formato do JSON

Ver estrutura em `output/quiz-*.json`: `capturedAt`, `url`, `totalQuestions`, `level`, `questions[]` com `question`, `alternatives`, `userAnswer`, `correctAnswer`, `result`, `explanation`.

Valores de `result`:

- `correct`: resposta do usuário bate com a correta
- `incorrect`: resposta do usuário difere da correta
- `not_answered`: feedback/correta detectados, mas sem resposta do usuário detectada
- `unknown`: estado ambíguo/insuficiente para classificar com segurança

## Licença

MIT
