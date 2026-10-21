# Tribunal do Casal ⚖️

Simulador de processo penal para duas pessoas: uma faz a **Acusação**, a outra a **Defesa**. A IA dá vida a todo o resto: juiz, testemunhas, perito, réu, jurados e desembargadores.

No ar em: https://tribunal-eta.vercel.app

## Como é uma partida

O processo segue o rito real, em fases:

| Fase | O que acontece |
|---|---|
| 🤝 **Acordo** | Nos crimes sem violência com pena mínima menor que 4 anos, a Acusação pode oferecer um ANPP. Se a Defesa aceitar e o juiz homologar, o caso acaba ali. |
| 📜 **Denúncia** | A Acusação escreve a denúncia, a Defesa responde, e o juiz recebe (ou não) e dá nota às peças. |
| 🎙️ **Instrução** | Vocês interrogam testemunhas, vítima, perito e réu, interpretados pela IA. Cada um tem personalidade e **segredos**: uma pergunta certeira arranca o segredo (+2 pontos). O adversário pode gritar **"Protesto!"** em até 9 segundos, e o juiz decide. A Defesa pode mandar o réu ficar em silêncio. No meio da instrução acontece uma **reviravolta**. |
| 🔨 **Pronúncia** | Nos crimes contra a vida, o juiz decide se o caso vai ao Júri ou se desclassifica. |
| 🗣️ **Debates** | Alegações finais com cronômetro, depois réplica e tréplica. Quando o tempo acaba, o que estiver escrito é enviado. |
| ⚖️ **Julgamento** | Sentença com dosimetria. No Júri, **7 jurados** com perfis diferentes votam, cada um com o que pensou. |
| 🏛️ **Recurso** | Quem perdeu pode apelar. Três desembargadores votam: uma garantista, um linha-dura e um técnico. |
| 🏁 **Fim** | Placar, conquistas, XP e carreira. O próximo caso começa com os **papéis trocados**. |

Outras mecânicas:
- **Informação secreta**: cada lado vê algo que o outro não sabe (aba CASO).
- **Cartas** (uma de cada por caso): 🔍 Diligência (investigação extra, cujo resultado vale para os dois), ➕ Perguntas extras, ⏱ Mais tempo.
- **Níveis**: 🎒 Estagiário (dicas e assistente à vontade), 💼 Advogado (assistente limitado), 🎓 Jurista (sem assistente, XP em dobro). O juiz avalia cada um conforme o nível declarado.
- **Glossário**: termos jurídicos sublinhados mostram a tradução ao tocar. Toda decisão vem com um "📢 Em resumo" em linguagem simples.
- **Treinar contra a IA**: na sala de espera, a IA assume o outro papel.
- **Caso 00 (tutorial)**: "A Última Fatia" é leve e engraçado, ótimo para aprender as fases.

## Arquivos

- `index.html` / `styles.css`: telas e visual
- `main.js`: lobby, sessão, abas, notas e assistente
- `modules/game.js`: **motor do processo** (fases, ações, piloto automático da IA, telas da audiência)
- `modules/case_view.js`: abas CASO, VADE e PENA
- `modules/career.js`: XP, patentes e conquistas
- `data/cases.js`: os casos (fatos, provas, vade mecum, calculadora)
- `data/dossies.js`: testemunhas, segredos, reviravoltas, jurados e desembargadores
- `data/glossario.js`: termos e explicações
- `ai-bridge.js`: chama a IA e, se ela falhar, usa um plano B local para cada personagem
- `api/judge.js` + `api/_prompts.js`: função do Vercel com a fila de IAs e o roteiro de cada personagem

Para criar um caso novo: adicione-o em `data/cases.js` e o dossiê com o mesmo `id` em `data/dossies.js`.

## IAs gratuitas

O servidor tenta, nesta ordem: **Groq → Gemini → Cerebras → OpenRouter**. Se uma estiver sem chave, fora do ar, lenta ou com limite estourado, passa para a próxima. Se todas falharem, o jogo continua com o plano B local.

| Variável no Vercel | Onde criar |
|---|---|
| `GROQ_KEY` | https://console.groq.com/keys |
| `GEMINI_KEY` | https://aistudio.google.com/app/apikey |
| `CEREBRAS_KEY` | https://cloud.cerebras.ai |
| `OPENROUTER_KEY` | https://openrouter.ai/settings/keys |

No Vercel: **Settings → Environment Variables**, tipo *Segredo*, com o nome exato da tabela. Depois, faça **Redeploy**.

**Diagnóstico:** abra `https://tribunal-eta.vercel.app/api/judge?diag=1` para testar cada IA de verdade e ver qual responde. Se um modelo for desativado pelo provedor, troque-o sem mexer no código com `GROQ_MODEL`, `GEMINI_MODEL`, `CEREBRAS_MODEL` ou `OPENROUTER_MODEL`.

> Nunca coloque chave no código nem no GitHub.

## Rodando no computador

Precisa do Node.js 20 ou mais novo.

```bash
npm run dev
```

Abre em http://localhost:3000. Para usar a IA (e as chaves) do site publicado, crie um `.env.local` com `JUDGE_PROXY=https://tribunal-eta.vercel.app`. Ou coloque as próprias chaves nele (veja `.env.example`). Sem nada, funciona com o plano B local.
