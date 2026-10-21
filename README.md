# Tribunal do Casal ⚖️

Jogo de debate jurídico para duas pessoas: uma faz a **Acusação**, a outra a **Defesa**, e um **Juiz IA** intervém no debate, faz perguntas, dá o placar e o veredito.

No ar em: https://tribunal-eta.vercel.app

## Como funciona

- `index.html`: telas, estilos e os 8 casos (`CASES`)
- `main.js`: salas no Firebase (tempo real), chat, juiz, veredito/recurso, cronômetro, notas
- `ai-bridge.js`: ponto único de acesso à IA. Tenta o servidor e, se falhar, usa o juiz local.
- `modules/ai_client.js`: chama `/api/judge` (no próprio site)
- `api/judge.js`: função serverless do Vercel com a **fila de IAs gratuitas**
- `judge_local.js`: juiz offline por regras. Funciona sempre, mesmo sem internet para IA.
- `dev-server.js`: servidor para rodar no seu computador

### A fila de IAs (tudo gratuito)

O servidor tenta, nesta ordem: **Groq → Gemini → Cerebras → OpenRouter**. Se uma estiver sem chave, fora do ar, lenta ou com limite estourado, passa para a próxima. Se todas falharem, o jogo usa o juiz local. Na mensagem do juiz aparece qual delas respondeu (⚡ groq, ⚡ gemini, ⚡ local…).

Basta **uma** chave para funcionar. Quanto mais chaves, mais difícil o juiz cair.

## Pegando as chaves gratuitas

Nenhuma pede cartão de crédito.

| Variável | Onde criar |
|---|---|
| `GROQ_KEY` | https://console.groq.com/keys → *Create API Key* |
| `GEMINI_KEY` | https://aistudio.google.com/app/apikey → *Create API key* |
| `CEREBRAS_KEY` | https://cloud.cerebras.ai → *API Keys* |
| `OPENROUTER_KEY` | https://openrouter.ai/settings/keys → *Create Key* |

### Colocando no Vercel

1. Abra o projeto no https://vercel.com → **Settings → Environment Variables**
2. Adicione cada chave com o nome exato da tabela (ex.: `GROQ_KEY`)
3. Vá em **Deployments** → no último deploy, **⋯ → Redeploy** (as variáveis só valem para deploys novos)
4. Teste abrindo `https://tribunal-eta.vercel.app/api/judge`: deve mostrar quais IAs estão ligadas, por exemplo `{"ok":true,"providers":{"groq":true,"gemini":true,...}}`

> Nunca coloque chave no código nem no GitHub. Elas ficam só no Vercel (e no seu `.env.local`, que o git ignora).

Opcional: para trocar o modelo de alguma IA sem mexer no código, use `GROQ_MODEL`, `GEMINI_MODEL`, `CEREBRAS_MODEL` ou `OPENROUTER_MODEL`.

## Rodando no computador

Precisa do Node.js 20 ou mais novo.

```bash
cp .env.example .env.local   # e preencha as chaves que tiver
npm run dev                  # abre em http://localhost:3000
```

Sem chaves, o jogo funciona do mesmo jeito, só que com o juiz local.

## Regras da partida

1. Quem cria a sala escolhe o caso e o papel, e manda o código (ou o botão **Copiar convite**) para a outra pessoa
2. Quem entra fica com o papel que sobrou
3. No **Debate**, o juiz entra sozinho a cada 4 mensagens, quando alguém escreve "juiz" ou pelo botão ⚖️. Toque na pergunta dele para responder.
4. Em **Pedido**, cada lado informa a pena que quer
5. Em **Veredito**, peçam a decisão. Cada lado pode recorrer uma vez (ou aceitar), e aí sai o veredito final.
6. **Próximo caso** limpa a sala e começa o caso seguinte para os dois

Se a página recarregar ou o celular bloquear, o jogo volta sozinho para a sala.
