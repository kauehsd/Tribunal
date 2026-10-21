// api/_prompts.js — o que cada personagem de IA recebe e como a resposta é normalizada.
// (Arquivos com _ na pasta api/ não viram endpoints no Vercel.)
//
// Cada modo tem:
//   build(caseObj, messages, extra) → { messages, maxTokens, json }
//   shape(data, extra)              → objeto devolvido ao frontend (sempre com valores padrão)

export const PERSONA_JUIZ = 'Você é o Dr. Augusto Melo, juiz criminal brasileiro experiente, firme e justo, com um toque de humor seco. Você preside um JOGO de simulação jurídica entre dois jogadores reais (Acusação e Defesa), que podem ser leigos ou estudantes de direito. Seja tecnicamente correto (CP, CPP, jurisprudência do STF/STJ), mas sempre traduza a decisão para quem não é da área. Escreva em português do Brasil.';

const RESUMO = '"em_resumo": uma frase curta em linguagem do dia a dia, para quem nunca estudou direito, explicando o que você decidiu e por quê';

// ─── Utilitários ───────────────────────────────────────────────────────────

function clip(value, max) {
  const s = String(value ?? '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}
function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, ''); }
function str(v, fallback = '') { return typeof v === 'string' && v.trim() ? v.trim() : fallback; }
function int(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function pontos(p, max) {
  return { acusacao: int(p?.acusacao, 0, max, 0), defesa: int(p?.defesa, 0, max, 0) };
}
function list(v) { return Array.isArray(v) ? v : []; }

function describeCase(c = {}) {
  const parts = [`CASO: ${clip(c.titulo || 'Caso sem título', 120)}`];
  if (c.corpo) parts.push(clip(stripHtml(c.corpo), 1500));
  if (c.context_juiz) parts.push(clip(c.context_juiz, 1200));
  if (c.antecedentes_criminais) parts.push(`Antecedentes: ${clip(c.antecedentes_criminais, 400)}`);
  if (c.contexto_social) parts.push(`Contexto social: ${clip(c.contexto_social, 400)}`);
  if (list(c.provas).length) parts.push('PROVAS DOS AUTOS:\n' + c.provas.slice(0, 12).map(p => `- ${clip(p, 300)}`).join('\n'));
  if (c.penaMin != null && c.penaMax != null) parts.push(`Faixa de pena de referência: ${c.penaMin} a ${c.penaMax} anos.`);
  return parts.join('\n\n');
}

// "Autos": o histórico do processo, já resumido pelo frontend em linhas de texto.
function describeAutos(extra) {
  const lines = list(extra.autos).slice(-60).map(l => clip(l, 700));
  return lines.length ? 'AUTOS DO PROCESSO ATÉ AGORA:\n' + lines.join('\n') : 'AUTOS: (processo no início)';
}

const NIVEL_TXT = {
  estagiario: 'Estagiário (leigo/iniciante: seja didático e valorize acertos básicos)',
  advogado: 'Advogado (nível intermediário)',
  jurista: 'Jurista (experiente: seja exigente e cobre fundamento legal preciso)'
};
function niveis(extra) {
  const n = extra.niveis || {};
  return `Nível declarado dos jogadores — Acusação: ${NIVEL_TXT[n.acusacao] || NIVEL_TXT.advogado}; Defesa: ${NIVEL_TXT[n.defesa] || NIVEL_TXT.advogado}. Avalie cada um proporcionalmente ao seu nível.`;
}

function judgePrompt(caseObj, extra, task, maxTokens = 900) {
  return {
    json: true,
    maxTokens,
    messages: [
      { role: 'system', content: PERSONA_JUIZ },
      { role: 'user', content: `${describeCase(caseObj)}\n\n${describeAutos(extra)}\n\n${niveis(extra)}\n\n${task}\n\nResponda APENAS com um objeto json válido, sem texto fora dele.` }
    ]
  };
}

function shapeDosimetria(d) {
  if (!d || typeof d !== 'object') return null;
  return {
    fase1: str(d.fase1), fase2: str(d.fase2), fase3: str(d.fase3),
    pena_final: str(d.pena_final), regime: str(d.regime)
  };
}

// ─── Modos ─────────────────────────────────────────────────────────────────

export const MODES = {

  // Juiz recebe a denúncia e decide as preliminares da resposta à acusação
  recebimento: {
    build: (c, m, extra) => judgePrompt(c, extra,
      `FASE: recebimento da denúncia (Arts. 395-397 CPP).\nDENÚNCIA DA ACUSAÇÃO:\n${clip(extra.denuncia, 2500)}\n\nRESPOSTA À ACUSAÇÃO DA DEFESA:\n${clip(extra.resposta, 2500)}\n\nDecida: receba a denúncia (o jogo continua para a instrução — não rejeite nem absolva sumariamente, a menos que a denúncia esteja vazia) e analise brevemente as teses preliminares da defesa, dizendo o que fica para depois. Avalie a qualidade técnica de cada peça de 0 a 5.\nFormato:\n{"decisao": "sua decisão em 3 a 5 frases, em tom de juiz", ${RESUMO}, "pontos": {"acusacao": 0-5, "defesa": 0-5}, "comentario_acusacao": "1 frase de feedback para a acusação", "comentario_defesa": "1 frase de feedback para a defesa"}`),
    shape: d => ({
      text: str(d?.decisao, 'Recebo a denúncia. Prossiga-se à instrução.'),
      em_resumo: str(d?.em_resumo),
      pontos: pontos(d?.pontos, 5),
      comentario_acusacao: str(d?.comentario_acusacao),
      comentario_defesa: str(d?.comentario_defesa)
    })
  },

  // Uma testemunha (ou vítima, perito, réu) responde a uma pergunta, em personagem
  testemunha: {
    build: (c, m, extra) => {
      const t = extra.testemunha || {};
      const anteriores = list(extra.historico).slice(-8).map(h => `${h.por === 'acusacao' ? 'Acusação' : h.por === 'defesa' ? 'Defesa' : 'Juiz'} perguntou: ${clip(h.pergunta, 300)}\n${t.nome} respondeu: ${clip(h.resposta, 400)}`).join('\n');
      const quem = extra.por === 'acusacao' ? 'a ACUSAÇÃO (promotoria)' : 'a DEFESA';
      return {
        json: true,
        maxTokens: 450,
        temperature: 0.8,
        messages: [
          { role: 'system', content: `Você é um ATOR interpretando ${t.nome}, ${t.papel_txt || 'testemunha'} num processo criminal brasileiro, durante a audiência de instrução de um jogo de simulação. Fique 100% no personagem: fale em primeira pessoa, como uma pessoa real falaria em juízo (nervosa, defensiva, emocionada ou técnica, conforme o perfil). Nunca saia do personagem, nunca fale de "jogo" ou de "IA". Português do Brasil.` },
          { role: 'user', content: `${describeCase(c)}\n\nSUA FICHA:\nPerfil: ${clip(t.perfil, 600)}\nO que você conta espontaneamente: ${clip(t.depoimento, 900)}\nSegredos (só revele um se a pergunta tocar DIRETAMENTE nele; se perguntarem de forma vaga, desconverse; se a pergunta for muito precisa, você não pode mentir sob compromisso e deve admitir): ${list(t.segredos).map((s, i) => `(${i + 1}) ${clip(s, 300)}`).join(' ') || 'nenhum'}\nSua postura: você foi chamado(a) por ${t.arrolada_por === 'defesa' ? 'a defesa' : t.arrolada_por === 'acusacao' ? 'a acusação' : 'o juízo'}; ${t.papel === 'reu' ? 'você é o réu: pode se defender, minimizar, mas não confessa o que não está nos segredos.' : 'você presta compromisso de dizer a verdade, mas é humano e tem lado.'}\n\n${anteriores ? `PERGUNTAS JÁ FEITAS A VOCÊ:\n${anteriores}\n\n` : ''}AGORA ${quem.toUpperCase()} PERGUNTA:\n"${clip(extra.pergunta, 600)}"\n\nResponda em no máximo 3 frases, só sobre o que foi perguntado, sem inventar fatos que contradigam a ficha ou as provas. "revelou_segredo" é true SOMENTE se nesta resposta você contou um segredo da ficha que ainda NÃO apareceu em nenhuma resposta anterior (repetir algo já dito é false). Formato json:\n{"resposta": "sua fala", "revelou_segredo": true|false, "tom": "uma palavra: calmo, nervoso, emocionado, hostil, evasivo, técnico ou firme"}` }
        ]
      };
    },
    shape: d => ({
      text: str(d?.resposta, 'Não me lembro bem, doutor(a).'),
      revelou_segredo: d?.revelou_segredo === true,
      tom: str(d?.tom, 'calmo')
    })
  },

  // "Protesto, Excelência!" — o juiz decide se a pergunta pode ser feita
  protesto: {
    build: (c, m, extra) => judgePrompt(c, extra,
      `FASE: audiência de instrução. Durante a inquirição de ${clip(extra.testemunha_nome, 80)}, ${extra.por === 'acusacao' ? 'a Acusação' : 'a Defesa'} fez a pergunta:\n"${clip(extra.pergunta, 600)}"\n${extra.contra === 'acusacao' ? 'A Acusação' : 'A Defesa'} protestou. Motivo alegado: ${clip(extra.motivo, 120)}.\nDecida como juiz (Art. 212 CPP: o juiz não admite perguntas que induzam a resposta, não tenham relação com a causa ou importem repetição de outra já respondida; também não se admite pergunta ofensiva ou que peça especulação/opinião da testemunha). Seja justo: protesto sem fundamento deve ser rejeitado.\nATENÇÃO ao campo "protesto_aceito": true = você CONCORDA com quem protestou e a pergunta fica VETADA (não será respondida); false = você DISCORDA do protesto e a testemunha RESPONDE. O fundamento deve ser coerente com essa escolha.\nFormato:\n{"protesto_aceito": true | false, "fundamento": "1 frase curta e firme, como dita em audiência, começando por 'Deferido.' se aceito ou 'Indeferido.' se rejeitado", ${RESUMO}}`, 300),
    shape: d => {
      const text = str(d?.fundamento, 'Indeferido. Prossiga.');
      // a frase dita em audiência manda: decisão e fundamento nunca podem se contradizer na tela
      const decisao = /^\W*indeferid/i.test(text) ? 'indeferido'
        : /^\W*deferid/i.test(text) ? 'deferido'
        : (d?.protesto_aceito === true || d?.decisao === 'deferido') ? 'deferido' : 'indeferido';
      return { decisao, text, em_resumo: str(d?.em_resumo) };
    }
  },

  // Pedido de diligência (carta): o juiz defere ou não, e o resultado revela um fato novo
  diligencia: {
    build: (c, m, extra) => judgePrompt(c, extra,
      `${extra.por === 'acusacao' ? 'A Acusação' : 'A Defesa'} requereu a seguinte diligência: "${clip(extra.pedido, 500)}".\nFATOS AINDA OCULTOS que uma investigação poderia descobrir (use o mais relacionado ao pedido; se nenhum tiver relação, defira e produza um resultado neutro e coerente com o caso, sem inventar reviravoltas): ${list(extra.fatos_ocultos).map((f, i) => `(${i}) ${clip(f, 300)}`).join(' ') || 'nenhum'}\nO resultado da diligência entra nos autos e vale para os DOIS lados (pode até prejudicar quem pediu).\nFormato:\n{"deferida": true, "resultado": "o que a diligência revelou, como um laudo/relatório curto (2-3 frases)", "fato_usado": índice do fato oculto usado ou -1, ${RESUMO}}`, 500),
    shape: d => ({
      deferida: d?.deferida !== false,
      text: str(d?.resultado, 'A diligência foi realizada, mas não trouxe elementos novos relevantes.'),
      fato_usado: int(d?.fato_usado, -1, 50, -1),
      em_resumo: str(d?.em_resumo)
    })
  },

  // Fim da instrução nos crimes dolosos contra a vida: vai a júri ou não?
  pronuncia: {
    build: (c, m, extra) => judgePrompt(c, extra,
      `FASE: decisão de pronúncia (Arts. 413-419 CPP), ao fim da primeira fase do rito do Júri. Decida entre:\n- "pronuncia": há prova da materialidade e indícios suficientes de autoria de crime doloso contra a vida → o réu vai a Júri Popular (diga por qual crime e qualificadoras admitidas).\n- "desclassificacao": o crime não é doloso contra a vida (ex.: homicídio culposo de trânsito) → o processo vai para o juiz singular.\nBaseie-se no que as partes efetivamente provaram na instrução. Lembre que na pronúncia vale o "in dubio pro societate" para indícios de autoria.\nFormato:\n{"decisao": "pronuncia" | "desclassificacao", "fundamento": "3 a 4 frases", "crime": "crime pelo qual o réu será julgado", ${RESUMO}, "pontos": {"acusacao": 0-5, "defesa": 0-5}}`),
    shape: d => ({
      decisao: d?.decisao === 'desclassificacao' ? 'desclassificacao' : 'pronuncia',
      text: str(d?.fundamento, 'Presentes materialidade e indícios de autoria, pronuncio o réu.'),
      crime: str(d?.crime),
      em_resumo: str(d?.em_resumo),
      pontos: pontos(d?.pontos, 5)
    })
  },

  // Sentença do juiz singular, com dosimetria
  sentenca: {
    build: (c, m, extra) => judgePrompt(c, extra,
      `FASE: SENTENÇA. Os debates terminaram. Pedido final da Acusação: ${clip(extra.pedidos?.acusacao || 'não informado', 200)}. Pedido final da Defesa: ${clip(extra.pedidos?.defesa || 'não informado', 200)}.\nJulgue com base nas provas e, principalmente, na QUALIDADE dos argumentos, perguntas e provas que cada jogador produziu nos autos. Se condenar, faça a dosimetria trifásica (Art. 68 CP) usando a faixa de pena do caso e fixe o regime (Art. 33 CP). Avalie o desempenho de cada lado de 0 a 10.\nFormato:\n{"decisao": "CONDENAÇÃO" | "ABSOLVIÇÃO" | "CONDENAÇÃO PARCIAL" | "DESCLASSIFICAÇÃO", "fundamentacao": "4 a 6 frases citando o que cada lado fez de melhor e de pior", "dosimetria": {"fase1": "pena-base e por quê", "fase2": "agravantes/atenuantes", "fase3": "causas de aumento/diminuição", "pena_final": "ex.: 2 anos e 4 meses de reclusão", "regime": "aberto | semiaberto | fechado, e se substitui por restritiva de direitos"} ou null se absolver, ${RESUMO}, "pontos": {"acusacao": 0-10, "defesa": 0-10}, "melhor_momento_acusacao": "o melhor argumento ou pergunta da acusação, em 1 frase", "melhor_momento_defesa": "idem para a defesa"}`, 1300),
    shape: d => ({
      decisao: str(d?.decisao, 'DECISÃO').toUpperCase(),
      text: str(d?.fundamentacao, 'Sentença proferida.'),
      dosimetria: shapeDosimetria(d?.dosimetria),
      em_resumo: str(d?.em_resumo),
      pontos: pontos(d?.pontos, 10),
      melhor_momento_acusacao: str(d?.melhor_momento_acusacao),
      melhor_momento_defesa: str(d?.melhor_momento_defesa)
    })
  },

  // Tribunal do Júri: 7 jurados votam e o juiz-presidente dosa a pena
  juri: {
    build: (c, m, extra) => {
      const jurados = list(extra.jurados).map((j, i) => `${i + 1}. ${j.nome} — ${j.perfil}`).join('\n');
      return judgePrompt(c, extra,
        `FASE: JULGAMENTO EM PLENÁRIO DO JÚRI. O réu foi pronunciado por: ${clip(extra.crime || 'crime doloso contra a vida', 200)}. Os debates em plenário terminaram.\nOs 7 jurados são pessoas comuns, sem formação jurídica, e decidem por íntima convicção (sem precisar fundamentar), influenciados pela emoção, pela clareza e pela credibilidade de cada lado — não por citações de artigos. Interprete CADA jurado de acordo com o perfil dele:\n${jurados}\nQuesitos (Art. 483 CPP): materialidade, autoria e "o jurado absolve o acusado?". Depois, como juiz-presidente, se houver condenação faça a dosimetria.\nFormato:\n{"votos": [{"nome": "nome do jurado", "voto": "condena" | "absolve", "pensamento": "o que passou pela cabeça dele, 1 frase em primeira pessoa, coloquial"}] (exatamente 7, na mesma ordem), "resultado": "condenacao" | "absolvicao", "fundamentacao": "o juiz-presidente anuncia o resultado e comenta o desempenho das partes, 3-4 frases", "dosimetria": {...igual à sentença...} ou null, ${RESUMO}, "pontos": {"acusacao": 0-10, "defesa": 0-10}, "melhor_momento_acusacao": "...", "melhor_momento_defesa": "..."}`, 1600);
    },
    shape: (d, extra) => {
      const jurados = list(extra.jurados);
      const votos = list(d?.votos).slice(0, 7).map((v, i) => ({
        nome: str(v?.nome, jurados[i]?.nome || `Jurado ${i + 1}`),
        voto: v?.voto === 'absolve' ? 'absolve' : 'condena',
        pensamento: str(v?.pensamento)
      }));
      const condena = votos.filter(v => v.voto === 'condena').length;
      // o resultado sai da contagem dos votos, para nunca contradizer o que aparece na tela
      const resultado = votos.length === 7 ? (condena >= 4 ? 'condenacao' : 'absolvicao') : (d?.resultado === 'absolvicao' ? 'absolvicao' : 'condenacao');
      return {
        votos,
        resultado,
        decisao: resultado === 'condenacao' ? 'CONDENAÇÃO' : 'ABSOLVIÇÃO',
        text: str(d?.fundamentacao, 'O Conselho de Sentença decidiu.'),
        dosimetria: resultado === 'condenacao' ? shapeDosimetria(d?.dosimetria) : null,
        em_resumo: str(d?.em_resumo),
        pontos: pontos(d?.pontos, 10),
        melhor_momento_acusacao: str(d?.melhor_momento_acusacao),
        melhor_momento_defesa: str(d?.melhor_momento_defesa)
      };
    }
  },

  // Apelação: 3 desembargadores, cada um com sua personalidade, votam
  acordao: {
    build: (c, m, extra) => {
      const des = list(extra.desembargadores).map(d => `- ${d.nome} (${d.papel}): ${d.perfil}`).join('\n');
      const apelante = extra.apelante === 'acusacao' ? 'Acusação' : 'Defesa';
      return {
        json: true,
        maxTokens: 1300,
        messages: [
          { role: 'system', content: 'Você narra uma sessão de julgamento de uma Câmara Criminal de Tribunal de Justiça brasileiro, num jogo de simulação jurídica. Cada desembargador tem personalidade própria e vota de forma independente — podem divergir. Seja tecnicamente correto e traduza para leigos. Português do Brasil.' },
          { role: 'user', content: `${describeCase(c)}\n\n${describeAutos(extra)}\n\nSENTENÇA RECORRIDA: ${clip(extra.sentenca, 1500)}\n\nAPELAÇÃO (${apelante}) — razões:\n${clip(extra.razoes, 2500)}\n\nCONTRARRAZÕES (${extra.apelante === 'acusacao' ? 'Defesa' : 'Acusação'}):\n${clip(extra.contrarrazoes || '(não apresentadas)', 2500)}\n\nCÂMARA JULGADORA:\n${des}\n\n${niveis(extra)}\n\nCada desembargador vota: "provido" (dá razão ao apelante), "parcialmente provido" ou "desprovido" (mantém a sentença). O resultado é pela maioria. Avalie a qualidade das razões e contrarrazões de 0 a 10.\nResponda APENAS com um objeto json válido:\n{"votos": [{"nome": "...", "papel": "relator|revisor|vogal", "voto": "provido|parcialmente provido|desprovido", "fundamento": "2 frases no estilo do desembargador"}] (exatamente 3, na ordem dada), "resultado": "provido|parcialmente provido|desprovido", "decisao_final": "como fica a situação do réu após o acórdão (ex.: absolvido; pena reduzida para X; condenação mantida)", ${RESUMO}, "pontos": {"acusacao": 0-10, "defesa": 0-10}}` }
        ]
      };
    },
    shape: (d, extra) => {
      const des = list(extra.desembargadores);
      const norm = v => /parcial/i.test(v) ? 'parcialmente provido' : /desprovid|nega|improvid/i.test(v) ? 'desprovido' : 'provido';
      const votos = list(d?.votos).slice(0, 3).map((v, i) => ({
        nome: str(v?.nome, des[i]?.nome || `Desembargador ${i + 1}`),
        papel: str(v?.papel, des[i]?.papel || ''),
        voto: norm(String(v?.voto || '')),
        fundamento: str(v?.fundamento)
      }));
      // resultado pela maioria dos votos mostrados (empate 1-1-1 → parcial)
      const count = k => votos.filter(v => v.voto === k).length;
      let resultado = norm(String(d?.resultado || ''));
      if (votos.length === 3) {
        resultado = count('provido') >= 2 ? 'provido' : count('desprovido') >= 2 ? 'desprovido' : 'parcialmente provido';
      }
      return {
        votos, resultado,
        text: str(d?.decisao_final, resultado === 'desprovido' ? 'Sentença mantida.' : 'Sentença reformada.'),
        em_resumo: str(d?.em_resumo),
        pontos: pontos(d?.pontos, 10)
      };
    }
  },

  // Acordo de não persecução penal (Art. 28-A CPP): o juiz homologa ou não
  acordo: {
    build: (c, m, extra) => judgePrompt(c, extra,
      `A Acusação propôs um ACORDO DE NÃO PERSECUÇÃO PENAL (Art. 28-A CPP) e a Defesa ACEITOU. Termos: "${clip(extra.termos, 800)}".\nComo juiz, verifique a legalidade (crime sem violência ou grave ameaça, pena mínima inferior a 4 anos, confissão, condições proporcionais) e se as condições são adequadas. Avalie quem negociou melhor (0 a 10 cada: a acusação ganha pontos por condições firmes e proporcionais; a defesa por ter conseguido condições brandas e evitado o processo).\nFormato:\n{"homologado": true | false, "fundamento": "3 frases", ${RESUMO}, "pontos": {"acusacao": 0-10, "defesa": 0-10}}`, 600),
    shape: d => ({
      homologado: d?.homologado !== false,
      text: str(d?.fundamento, 'Homologo o acordo.'),
      em_resumo: str(d?.em_resumo),
      pontos: pontos(d?.pontos, 10)
    })
  },

  // Modo treino: a IA joga como o adversário
  oponente: {
    build: (c, m, extra) => {
      const lado = extra.papel === 'acusacao' ? 'PROMOTOR(A) DE JUSTIÇA (Acusação)' : 'DEFENSOR(A) (Defesa)';
      const tarefas = {
        denuncia: 'Escreva a DENÚNCIA: narre o fato, tipifique o crime com artigos e peça a condenação. Máx. 5 frases.',
        resposta: 'Escreva a RESPOSTA À ACUSAÇÃO: apresente as teses da defesa (preliminares, excludentes, falta de prova). Máx. 5 frases.',
        pergunta: `Você está na audiência de instrução. Escolha UMA testemunha da lista e faça UMA pergunta curta e estratégica a ela. Testemunhas: ${list(extra.testemunhas).map(t => `${t.id} = ${t.nome} (${t.papel_txt})`).join('; ')}. Coloque o id escolhido em "testemunha_id".`,
        alegacao: 'Escreva suas ALEGAÇÕES FINAIS: retome as provas e o que as testemunhas disseram e faça o pedido final. Máx. 6 frases. Coloque o pedido curto (ex.: "condenação a 4 anos" ou "absolvição") em "pedido".',
        replica: 'Escreva uma RÉPLICA/TRÉPLICA curta rebatendo o último argumento do adversário. Máx. 4 frases.',
        apelacao: 'Você perdeu na sentença. Escreva as RAZÕES DE APELAÇÃO atacando os pontos fracos da sentença. Máx. 5 frases.',
        contrarrazoes: 'O adversário apelou. Escreva CONTRARRAZÕES defendendo a sentença. Máx. 4 frases.',
        acordo_proposta: 'Decida se oferece um acordo de não persecução penal. Se sim, coloque "aceita": true e as condições em "texto" (ex.: prestação de serviços, reparação do dano). Se não, "aceita": false.',
        acordo_resposta: `A acusação ofereceu um acordo com os termos: "${clip(extra.termos, 500)}". Decida como defesa se aceita (true) ou recusa (false), e explique em "texto" em 1 frase.`
      };
      return {
        json: true,
        maxTokens: 600,
        temperature: 0.85,
        messages: [
          { role: 'system', content: `Você é ${lado} num jogo de simulação jurídica, jogando contra uma pessoa real. Jogue para vencer, de forma técnica mas acessível. Defenda SEMPRE o seu lado: nunca mencione as teses do adversário como se fossem suas (um promotor não alega excludentes do réu; um defensor não pede condenação). Não seja perfeito demais: às vezes deixe de explorar algum ponto, como um advogado real. Nível do adversário: ${NIVEL_TXT[extra.nivel_humano] || NIVEL_TXT.advogado} — ajuste sua força a ele. Português do Brasil.` },
          { role: 'user', content: `${describeCase(c)}\n\n${extra.segredos?.length ? `Informações que só o seu lado conhece: ${extra.segredos.map(s => clip(s, 300)).join(' | ')}\n\n` : ''}${describeAutos(extra)}\n\nTAREFA: ${tarefas[extra.tarefa] || tarefas.replica}\n\nResponda APENAS com um objeto json válido: {"texto": "...", "pedido": "...", "testemunha_id": "...", "aceita": true|false} (preencha só os campos que a tarefa pede).` }
        ]
      };
    },
    shape: d => ({
      text: str(d?.texto, '...'),
      pedido: str(d?.pedido),
      testemunha_id: str(d?.testemunha_id),
      aceita: d?.aceita === true
    })
  },

  // Assistente privado de estratégia (texto livre)
  assist: {
    build: (c, m, extra) => {
      const papel = extra.role === 'defesa' ? 'Defesa' : 'Acusação';
      const history = list(extra.history).slice(-8)
        .map(h => ({ role: h.type === 'ai' ? 'assistant' : 'user', content: clip(h.text, 1200) }));
      return {
        json: false,
        maxTokens: 600,
        messages: [
          { role: 'system', content: `Você é um assistente jurídico estratégico e PRIVADO do jogador que joga como ${papel} num jogo de simulação de processo penal. Fase atual do processo: ${clip(extra.fase || 'debate', 60)}. Nível do jogador: ${NIVEL_TXT[extra.nivel] || NIVEL_TXT.advogado}. Ajude o jogador a PENSAR: aponte artigos, jurisprudência, fraquezas do adversário, perguntas boas para as testemunhas e próximos passos, mas não escreva a peça pronta. Use linguagem simples, explicando termos técnicos. No máximo 3 parágrafos curtos. Português do Brasil.\n\n${describeCase(c)}\n\n${extra.segredos?.length ? `Informação reservada do seu lado: ${extra.segredos.join(' | ')}\n\n` : ''}${describeAutos(extra)}` },
          ...history,
          { role: 'user', content: clip(extra.question || '', 1500) }
        ]
      };
    },
    shape: d => ({ text: str(d, 'Não consegui pensar em nada agora. Tente reformular.') })
  },

  // ── Compatibilidade com a versão anterior do site (pode ser removido depois) ──
  judge: {
    build: (c, m, extra) => judgePrompt(c, { ...extra, autos: list(m).slice(-40).map(x => `[${x.role}] ${x.sender}: ${x.text}`) },
      'Intervenha no debate: comente o ponto mais forte e o mais fraco e faça UMA pergunta curta a cada lado; dê nota parcial de 0 a 10 a cada lado.\nFormato: {"fala": "máx. 4 frases", "pergunta_acusacao": "...", "pergunta_defesa": "...", "placar": {"acusacao": 0-10, "defesa": 0-10}}', 600),
    shape: d => ({
      text: str(d?.fala, '...'),
      perguntas_acu: d?.pergunta_acusacao ? [String(d.pergunta_acusacao)] : [],
      perguntas_def: d?.pergunta_defesa ? [String(d.pergunta_defesa)] : [],
      placar: d?.placar ? pontos(d.placar, 10) : null
    })
  },
  verdict: {
    build: (c, m, extra) => judgePrompt(c, { ...extra, autos: list(m).slice(-40).map(x => `[${x.role}] ${x.sender}: ${x.text}`) },
      `Dê o veredito. Formato: {"decisao": "CONDENAÇÃO|ABSOLVIÇÃO|CONDENAÇÃO PARCIAL", "fundamentacao": "3-5 frases", "pena": "...", "placar": {"acusacao": 0-10, "defesa": 0-10}}`),
    shape: d => ({
      text: [str(d?.decisao, 'DECISÃO').toUpperCase(), '', str(d?.fundamentacao), d?.pena ? `\nPena: ${d.pena}` : ''].join('\n').trim(),
      decisao: str(d?.decisao).toUpperCase(),
      placar: d?.placar ? pontos(d.placar, 10) : null
    })
  }
};
