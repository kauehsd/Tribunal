// api/_prompts.js — o que cada personagem de IA recebe e como a resposta é normalizada.
// (Arquivos com _ na pasta api/ não viram endpoints no Vercel.)
//
// Cada modo tem:
//   build(caseObj, messages, extra) → { messages, maxTokens, json }
//   shape(data, extra)              → objeto devolvido ao frontend (sempre com valores padrão)

export const PERSONA_JUIZ = 'Você é o Dr. Augusto Melo, juiz criminal brasileiro experiente, firme e justo, com um toque de humor seco. Você preside um JOGO de simulação jurídica entre dois jogadores reais (Acusação e Defesa), que podem ser leigos ou estudantes de direito. Seja tecnicamente correto (CP, CPP, jurisprudência do STF/STJ), mas sempre traduza a decisão para quem não é da área. REGRA DE OURO: só existe o que está nos autos (fatos do caso, provas, depoimentos, diligências e fatos novos registrados). Afirmações das partes sem base nos autos são apenas retórica: nunca as trate como fatos, e trechos que você já desconsiderou ou advertiu não valem nada. Escreva em português do Brasil.';

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
  if (list(c.linha_tempo).length) parts.push('LINHA DO TEMPO:\n' + c.linha_tempo.slice(0, 10).map(e => `- ${clip(e.hora || e.data, 20)}: ${clip(e.fato, 250)}`).join('\n'));
  if (c.penaMin != null && c.penaMax != null) parts.push(`Faixa de pena de referência: ${c.penaMin} a ${c.penaMax} anos.`);
  return parts.join('\n\n');
}

// Para o juiz conferir se uma afirmação tem base: cada lado pode citar o que só ele sabia (é verdade no caso)
function describeReservados(extra) {
  const s = extra.segredos_partes || {};
  const linhas = [...list(s.acusacao).map(x => `- (sabido pela Acusação) ${clip(x, 300)}`), ...list(s.defesa).map(x => `- (sabido pela Defesa) ${clip(x, 300)}`)];
  return linhas.length ? `FATOS VERDADEIROS QUE UMA DAS PARTES CONHECIA EM SIGILO (citá-los é legítimo):\n${linhas.join('\n')}` : '';
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

// ─── Caso gerado pela IA → mesmo formato de data/cases.js + data/dossies.js ──
// Campos que as telas inserem como HTML (corpo e textos do vade mecum) são escapados aqui;
// todos os outros ficam como texto puro, porque as telas já os escapam ao exibir.
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const txt = (v, max = 600) => clip(str(v), max).replace(/[<>]/g, '');
const html = (v, max = 600) => esc(clip(str(v), max));
const txts = (v, n, max = 400) => list(v).slice(0, n).map(x => txt(x, max)).filter(Boolean);
// primeiro emoji inteiro (emojis compostos, como 👩‍⚕️, têm vários caracteres)
const firstEmoji = v => {
  const s = str(v, '🧑');
  try { return [...new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(s)][0]?.segment || '🧑'; } catch { return [...s][0] || '🧑'; }
};
const slugId = (s, i) => (String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'pessoa') + '_' + i;

export function normalizeCase(d) {
  const penaMin = Math.max(0, Number(d.penaMin) || 1);
  const penaMax = Math.max(penaMin + 1, Number(d.penaMax) || penaMin + 4);
  const tagColors = ['tr', 'tb', 'tg'];
  let testemunhas = list(d.testemunhas).slice(0, 5).map((t, i) => ({
    id: slugId(t?.id || t?.nome, i),
    nome: txt(t?.nome, 60) || `Depoente ${i + 1}`,
    emoji: firstEmoji(t?.emoji),
    papel: ['vitima', 'testemunha', 'policial', 'perito', 'reu'].includes(t?.papel) ? t.papel : 'testemunha',
    papel_txt: txt(t?.papel_txt, 60) || 'testemunha',
    arrolada_por: ['acusacao', 'defesa', 'juizo'].includes(t?.arrolada_por) ? t.arrolada_por : 'acusacao',
    perfil: txt(t?.perfil, 300),
    depoimento: txt(t?.depoimento, 500),
    segredos: txts(t?.segredos, 2, 300),
    contradicao: txt(t?.contradicao, 300)
  }));
  // garante exatamente um réu, e por último (o interrogatório encerra a instrução)
  let reu = testemunhas.find(t => t.papel === 'reu');
  if (!reu) { reu = testemunhas[testemunhas.length - 1]; reu.papel = 'reu'; reu.papel_txt = 'réu'; }
  testemunhas = [...testemunhas.filter(t => t !== reu && t.papel !== 'reu'), { ...reu, arrolada_por: 'juizo' }];
  const reviravoltas = list(d.reviravoltas).slice(0, 2).map(r => ({ titulo: txt(r?.titulo, 80) || 'Fato novo', texto: txt(r?.texto, 500) }));
  const corpo = html(d.corpo, 1200);
  return {
    id: 'ia-' + Math.random().toString(36).slice(2, 8),
    gerado: true,
    nome: txt(d.nome, 40) || txt(d.titulo, 40),
    titulo: txt(d.titulo, 90),
    tags: txts(d.tags, 3, 40).map((t, i) => ({ t: t.toUpperCase(), c: tagColors[i % 3] })),
    corpo,
    hot: txts(d.hot, 4, 200),
    perguntas_acu: txts(d.pontos_acu || d.perguntas_acu, 4, 220),
    perguntas_def: txts(d.pontos_def || d.perguntas_def, 4, 220),
    penaMin, penaMax, penaBase: penaMin,
    agravantes: list(d.agravantes).slice(0, 3).map(a => ({ t: txt(a?.t, 80), ef: txt(a?.ef, 30) || '+1/6', tipo: 'agg' })),
    majorantes: list(d.majorantes).slice(0, 3).map(a => ({ t: txt(a?.t, 80), ef: txt(a?.ef, 30) || '-1/6', tipo: /^-/.test(str(a?.ef)) ? 'ate' : 'agg' })),
    vade: list(d.vade).slice(0, 3).map(v => ({ num: txt(v?.num, 40), nome: txt(v?.nome, 60), pena: txt(v?.pena, 80), texto: html(v?.texto, 400), exp: html(v?.exp, 400), simple: html(v?.simple, 300), use_acu: html(v?.use_acu, 300), use_def: html(v?.use_def, 300), juris: txt(v?.juris, 200), ref: txt(v?.ref, 80) })),
    arts_rapidos: txts(d.arts_rapidos, 4, 40),
    context_juiz: txt(d.corpo, 1200),
    antecedentes: txt(d.antecedentes, 300),
    antecedentes_criminais: txt(d.antecedentes_criminais, 300),
    contexto_social: txt(d.contexto_social, 300),
    provas: txts(d.provas, 10, 300),
    linha_tempo: list(d.linha_tempo).slice(0, 8).map(e => ({ hora: txt(e?.hora || e?.data, 20), fato: txt(e?.fato, 250) })),
    dossie: {
      rito: d.rito === 'juri' ? 'juri' : 'comum',
      acordo: d.acordo === true && d.rito !== 'juri',
      testemunhas,
      segredo_acu: txts(d.segredo_acu, 2, 300),
      segredo_def: txts(d.segredo_def, 2, 300),
      fatos_ocultos: txts(d.fatos_ocultos, 3, 300),
      reviravoltas,
      reviravolta: reviravoltas[0],
      dicas_acu: txts(d.dicas_acu, 2, 200),
      dicas_def: txts(d.dicas_def, 2, 200)
    }
  };
}

// Palavras relevantes de um texto (sem acento; 4+ letras, ou qualquer coisa com número, como "2h05")
const STOP = new Set(['para', 'pela', 'pelo', 'como', 'mais', 'mas', 'que', 'isso', 'esse', 'essa', 'este', 'esta', 'entao', 'quando', 'onde', 'porque', 'sobre', 'muito', 'tinha', 'estava', 'disse', 'diz', 'falou', 'ele', 'ela', 'eles', 'elas', 'uma', 'umas', 'uns', 'dos', 'das', 'nos', 'nas', 'com', 'sem', 'foi', 'era', 'ser', 'ter', 'tem']);
function palavras(t) {
  const norm = String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return new Set((norm.match(/[a-z0-9]+/g) || []).filter(w => !STOP.has(w) && (w.length >= 4 || /\d/.test(w))));
}

// O trecho citado pela IA existe mesmo no texto? (pelo menos 70% das palavras relevantes, e no mínimo 2)
function trechoNoTexto(trecho, texto) {
  const t = palavras(trecho), base = palavras(texto);
  if (t.size < 2) return false;
  return [...t].filter(w => base.has(w)).length >= Math.max(2, Math.ceil(t.size * 0.7));
}

// A testemunha só recebe a SUA versão (a parte antes do "— mas"), nunca a prova que a desmente.
// "Ele diz que o alarme tocou às 2h05 — mas a câmera…" → "o alarme tocou às 2h05"
function versaoErrada(t) {
  const c = str(t?.contradicao);
  if (!c) return '';
  return c.split(/\s+[—–-]\s+mas\b|\s+—\s+/i)[0].replace(/^\s*(ele|ela)\s+(diz|afirma|garante|jura|calcula|sustenta)\s+(que\s+)?/i, '').trim();
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
          { role: 'user', content: `${describeCase(c)}\n\nSUA FICHA:\nPerfil: ${clip(t.perfil, 600)}\nO que você conta espontaneamente: ${clip(t.depoimento, 900)}\nSegredos (só revele um se a pergunta tocar DIRETAMENTE nele; se perguntarem de forma vaga, desconverse; se a pergunta for muito precisa, você não pode mentir sob compromisso e deve admitir): ${list(t.segredos).map((s, i) => `(${i + 1}) ${clip(s, 300)}`).join(' ') || 'nenhum'}\n${versaoErrada(t) ? `Um detalhe da sua lembrança (você tem CERTEZA dele): ${versaoErrada(t)}.\nSempre que contar o que aconteceu (perguntas abertas como "o que você viu?", "conte como foi") ou quando a pergunta tocar nesse assunto, afirme esse detalhe com naturalidade e com o dado concreto, como fato. Se alguém disser que uma prova mostra outra coisa, fique surpreso(a) e mantenha a sua lembrança, talvez com um pouco de hesitação.\n` : ''}Sua postura: você foi chamado(a) por ${t.arrolada_por === 'defesa' ? 'a defesa' : t.arrolada_por === 'acusacao' ? 'a acusação' : 'o juízo'}; ${t.papel === 'reu' ? 'você é o réu: pode se defender, minimizar, mas não confessa o que não está nos segredos.' : 'você presta compromisso de dizer a verdade, mas é humano e tem lado.'}\n\n${anteriores ? `PERGUNTAS JÁ FEITAS A VOCÊ:\n${anteriores}\n\n` : ''}AGORA ${quem.toUpperCase()} PERGUNTA:\n"${clip(extra.pergunta, 600)}"\n\nResponda em no máximo 3 frases, só sobre o que foi perguntado, sem inventar fatos que contradigam a ficha ou as provas. Se a pergunta afirmar como fato algo que você não sabe e que não está na sua ficha nem nas provas (uma premissa falsa, como "você viu a arma, não viu?" quando não havia arma), NÃO confirme: corrija ou diga que não sabe disso. "revelou_segredo" é true SOMENTE se nesta resposta você contou um segredo da ficha que ainda NÃO apareceu em nenhuma resposta anterior (repetir algo já dito é false). Formato json:\n{"resposta": "sua fala", "revelou_segredo": true|false, "tom": "uma palavra: calmo, nervoso, emocionado, hostil, evasivo, técnico ou firme"}` }
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
      `FASE: audiência de instrução. Durante a inquirição de ${clip(extra.testemunha_nome, 80)}, ${extra.por === 'acusacao' ? 'a Acusação' : 'a Defesa'} fez a pergunta:\n"${clip(extra.pergunta, 600)}"\n${extra.contra === 'acusacao' ? 'A Acusação' : 'A Defesa'} protestou. Motivo alegado: ${clip(extra.motivo, 120)}.\nDecida como juiz (Art. 212 CPP: o juiz não admite perguntas que induzam a resposta, não tenham relação com a causa ou importem repetição de outra já respondida; também não se admite pergunta ofensiva, que peça especulação/opinião da testemunha, ou que parta de premissa falsa — afirmar como fato algo que não consta dos autos). Seja justo: protesto sem fundamento deve ser rejeitado.\nATENÇÃO ao campo "protesto_aceito": true = você CONCORDA com quem protestou e a pergunta fica VETADA (não será respondida); false = você DISCORDA do protesto e a testemunha RESPONDE. O fundamento deve ser coerente com essa escolha.\nFormato:\n{"protesto_aceito": true | false, "fundamento": "1 frase curta e firme, como dita em audiência, começando por 'Deferido.' se aceito ou 'Indeferido.' se rejeitado", ${RESUMO}}`, 300),
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

  // Fiscal dos autos: o juiz confere cada peça das partes (fatos inventados, calúnia, ofensa, fora do caso)
  fiscal: {
    build: (c, m, extra) => {
      const p = extra.peca || {};
      const quem = p.por === 'acusacao' ? 'Acusação' : 'Defesa';
      const r = judgePrompt(c, extra,
        `${describeReservados(extra)}\n\nTAREFA: conferir a peça abaixo, apresentada agora pela ${quem}, ANTES que ela produza efeitos.\nPEÇA (${clip(p.tipo, 40)}):\n"""${clip(p.texto, 3000)}"""\n\nAponte SOMENTE violações claras:\n- "fato_inventado": afirma como FATO algo concreto (algo que aconteceu, foi dito, encontrado ou confessado) que NÃO consta do caso, dos autos nem dos fatos sigilosos verdadeiros acima, e que é relevante para o julgamento.\n- "calunia": acusa de crime ou de conduta desonesta o advogado/promotor adversário, o juiz, uma testemunha ou qualquer pessoa, sem nenhuma base nos autos (ex.: "o promotor forjou o laudo", "a defesa subornou a testemunha"). Dizer que a testemunha se contradisse ou se enganou, apontando o motivo, NÃO é calúnia.\n- "ofensa": insulto pessoal ao adversário (não aos argumentos dele).\n- "fora_do_caso": conteúdo sem relação com o processo.\nNÃO são violações: argumentos, interpretações, teses jurídicas, citação de leis e jurisprudência, hipóteses apresentadas como hipóteses ("é possível que…", "não se descarta…"), conclusões razoáveis tiradas das provas, apelos emocionais, exageros retóricos e qualquer fato que esteja no caso ou nos autos (mesmo com outras palavras). Na dúvida, NÃO aponte: punir um jogador honesto é pior do que deixar passar.\nPara cada violação, copie LITERALMENTE o trecho da peça (3 a 25 palavras).\nFormato:\n{"violacoes": [{"tipo": "fato_inventado" | "calunia" | "ofensa" | "fora_do_caso", "trecho": "cópia literal", "explicacao": "1 frase: por que não tem base nos autos"}], "advertencia": "se houver violação, sua fala ao advertir a parte (2 frases, firme, em tom de audiência); senão vazio", ${RESUMO}}`, 700);
      return { ...r, temperature: 0.2 };
    },
    shape: (d, extra) => {
      const texto = str(extra.peca?.texto);
      const tipos = ['fato_inventado', 'calunia', 'ofensa', 'fora_do_caso'];
      // só vale o que foi copiado de verdade da peça (a IA não pode punir por algo que a parte não escreveu)
      const violacoes = list(d?.violacoes)
        .filter(v => tipos.includes(v?.tipo) && trechoNoTexto(v?.trecho, texto))
        .slice(0, 3)
        .map(v => ({ tipo: v.tipo, trecho: clip(str(v.trecho), 200), explicacao: clip(str(v.explicacao), 300) }));
      return {
        violacoes,
        text: violacoes.length ? str(d?.advertencia, 'Advirto a parte: o que não está nos autos não existe para este juízo.') : '',
        em_resumo: violacoes.length ? str(d?.em_resumo, 'O juiz desconsiderou um trecho sem base nas provas e puniu quem escreveu.') : ''
      };
    }
  },

  // "Questão de ordem, Excelência!" — uma parte impugna algo que a outra afirmou sem base nos autos
  impugnacao: {
    build: (c, m, extra) => {
      const p = extra.peca || {};
      const r = judgePrompt(c, extra,
        `${describeReservados(extra)}\n\nQUESTÃO DE ORDEM: ${extra.por === 'acusacao' ? 'a Acusação' : 'a Defesa'} afirma que a peça abaixo, da ${p.por === 'acusacao' ? 'Acusação' : 'Defesa'}, alegou algo sem base nos autos.\nPEÇA IMPUGNADA (${clip(p.tipo, 40)}):\n"""${clip(p.texto, 3000)}"""\n\nIMPUGNAÇÃO: "${clip(extra.alegacao, 600)}"\n\nDecida SOMENTE sobre o que foi impugnado. PROCEDE se: (1) a peça realmente afirma aquilo; e (2) é afirmado como fato (ou é uma acusação de crime/ofensa) sem base no caso, nos autos ou nos fatos sigilosos verdadeiros acima. NÃO PROCEDE se o fato está nos autos (mesmo com outras palavras), se é argumento/interpretação/hipótese, ou se a peça não diz aquilo. Copie LITERALMENTE o trecho da peça que foi impugnado.\nFormato:\n{"trecho": "cópia literal de 3 a 25 palavras da peça, ou vazio", "procede": true | false, "fundamento": "2 frases em tom de audiência", ${RESUMO}}`, 450);
      return { ...r, temperature: 0.2 };
    },
    shape: (d, extra) => {
      const texto = str(extra.peca?.texto);
      const trecho = str(d?.trecho);
      const mesmoAssunto = [...palavras(trecho)].filter(w => palavras(extra.alegacao).has(w)).length >= 1;
      const procede = d?.procede === true && trechoNoTexto(trecho, texto) && mesmoAssunto;
      return {
        procede,
        trecho: procede ? clip(trecho, 200) : '',
        text: procede ? str(d?.fundamento) : (d?.procede === true ? 'Não procede. O que foi impugnado não corresponde ao que a parte escreveu.' : str(d?.fundamento, 'Não procede: o que foi dito tem base nos autos.')),
        em_resumo: procede ? str(d?.em_resumo) : 'O juiz considerou que a parte não inventou nada nesse ponto.'
      };
    }
  },

  // "Excelência, há uma contradição!" — o juiz verifica se o jogador pegou a testemunha
  contradicao: {
    build: (c, m, extra) => {
      const t = extra.testemunha || {};
      const depo = list(extra.depoimentos).map(d => `- Pergunta: "${clip(d.pergunta, 300)}" → Resposta: "${clip(d.resposta, 400)}"`).join('\n') || '(nenhum depoimento ainda)';
      const p = judgePrompt(c, extra,
        `FASE: audiência de instrução. ${extra.por === 'acusacao' ? 'A Acusação' : 'A Defesa'} aponta uma CONTRADIÇÃO no depoimento de ${clip(t.nome, 80)}:\n"${clip(extra.alegacao, 600)}"\n\nO QUE ${String(t.nome || '').toUpperCase()} DISSE EM JUÍZO:\n${depo}\n\nAvalie SOMENTE a alegação do jogador, entre aspas acima. Ela PROCEDE apenas se: (1) a testemunha realmente disse, no depoimento acima, aquilo que o jogador atribui a ela; e (2) isso conflita com uma prova dos autos (lista de PROVAS do caso) ou com outro depoimento. Não procure outras contradições por conta própria: se a alegação for vaga ("ela está mentindo"), atribuir algo que a testemunha não disse, ou não apontar conflito concreto, NÃO PROCEDE.\nPara decidir, copie LITERALMENTE o trecho do depoimento que o jogador está contestando e a prova que o contradiz. Se não houver trecho, deixe vazio.\nFormato:\n{"trecho_do_depoimento": "cópia literal de 3 a 15 palavras do depoimento, ou vazio", "prova_que_contradiz": "a prova ou o depoimento que conflita, ou vazio", "procede": true | false, "fundamento": "2 frases, em tom de audiência, sobre a alegação do jogador", ${RESUMO}}`, 500);
      return { ...p, reasoning: 'medium' };
    },
    shape: (d, extra) => {
      // Conferência que não depende da IA: o trecho citado precisa existir no depoimento
      // e precisa ser sobre o mesmo assunto que o jogador alegou.
      const depoimento = list(extra.depoimentos).map(x => x.resposta).join(' ');
      const trecho = str(d?.trecho_do_depoimento);
      const doDepo = palavras(depoimento), doTrecho = palavras(trecho), daAlegacao = palavras(extra.alegacao);
      const trechoExiste = doTrecho.size > 0 && [...doTrecho].filter(w => doDepo.has(w)).length >= Math.max(2, Math.ceil(doTrecho.size * 0.6));
      const mesmoAssunto = [...doTrecho].filter(w => daAlegacao.has(w)).length >= 2;
      const procede = d?.procede === true && trechoExiste && mesmoAssunto && Boolean(str(d?.prova_que_contradiz));
      return {
        procede,
        text: procede ? str(d?.fundamento) : (d?.procede === true ? 'Não procede. O que foi apontado não corresponde ao que a testemunha declarou em juízo.' : str(d?.fundamento, 'Não vislumbro contradição relevante.')),
        em_resumo: procede ? str(d?.em_resumo) : 'O juiz não viu contradição no que foi apontado.'
      };
    }
  },

  // Gera um caso inédito completo (com dossiê): crimes variados, contradições e duas reviravoltas
  gerar_caso: {
    build: (c, m, extra) => ({
      json: true,
      maxTokens: 5200,
      temperature: 0.9,
      timeoutMs: 50000,
      reasoning: 'medium',
      messages: [
        { role: 'system', content: 'Você é roteirista de um jogo de simulação de processo penal brasileiro. Cria casos criminais GRAVES e complexos (homicídios, latrocínios, roubos de grande porte, sequestros, crimes de organização criminosa), realistas, juridicamente corretos (Código Penal, CPP, leis especiais, STF/STJ), cheios de detalhes, ambiguidades e inconsistências que obrigam os jogadores a prestar atenção. Evite crimes sexuais e violência contra crianças. Nomes de pessoas fictícios. Português do Brasil. Responda somente com json válido.' },
        { role: 'user', content: `Crie um caso INÉDITO sobre o tema: ${clip(extra.tema || 'crime patrimonial urbano', 200)}.\nNão repita estes casos já jogados: ${list(extra.evitar).map(x => clip(x, 60)).join('; ') || 'nenhum'}.\n\nRegras do roteiro:\n- Contexto 100% brasileiro: PM, Polícia Civil, delegacia, B.O., IML, 190, SAMU 192, valores em reais, cidades brasileiras.\n- O "nome" e o "titulo" devem combinar exatamente com o crime do caso.\n- O caso deve ser GRAVE (pena máxima de pelo menos 8 anos) e ROBUSTO: várias questões jurídicas em disputa (autoria, dolo x culpa, qualificadoras, excludentes, participação de cada envolvido, validade de provas, dosimetria).\n- O caso deve ser EQUILIBRADO: cada lado precisa de pelo menos 4 pontos fortes reais nas provas ("pontos_acu" e "pontos_def"), para os dois terem boas chances de vencer.\n- Plante inconsistências objetivas: cada depoente tem um campo "contradicao" no formato "Ele(a) diz que X — mas a prova Y mostra Z", onde Z é um DADO concreto (horário, valor, distância, placa, cor, quantidade) que aparece literalmente em uma das "provas". Exemplo de boa contradição: "Ele diz que o alarme tocou às 2h05 — mas a câmera registra o arrombamento às 2h14."\n- Duas reviravoltas que MUDAM a análise jurídica (afastam ou reforçam dolo, autoria, legítima defesa, qualificadora, prova ilícita...): a primeira favorece um lado, a segunda favorece o outro. Fatos novos, surpreendentes e coerentes com tudo o que veio antes.\n- Segredos: cada depoente tem 1 ou 2 segredos que só revela se perguntarem diretamente.\n- Exatamente 5 depoentes (vítima ou familiar, testemunha de cada lado, um perito ou policial e, por último, o réu com papel "reu" e arrolada_por "juizo").\n- rito "juri" SOMENTE se for crime doloso contra a vida; acordo true SOMENTE se for crime sem violência ou grave ameaça com pena mínima menor que 4 anos.\n- Textos curtos e concretos (1-2 frases por item), sem HTML.\n\nFormato json:\n{"nome": "nome curto e chamativo do caso, 2 a 4 palavras", "titulo": "título do caso", "tags": ["CRIME", "ARTIGO PRINCIPAL", "TEMA"], "corpo": "resumo em 3-4 frases: quem, o quê, quando, onde e o que cada lado alega", "antecedentes": "perfil social do réu", "antecedentes_criminais": "...", "contexto_social": "...", "provas": ["8 provas concretas, com números, horários e nomes, algumas favorecendo cada lado"], "linha_tempo": [{"hora": "...", "fato": "..."}] (7 itens), "penaMin": número em anos, "penaMax": número em anos, "agravantes": [{"t": "...", "ef": "+1/6"}] (2), "majorantes": [{"t": "...", "ef": "-1/3 ou +1/3"}] (3), "vade": [{"num": "Art. X CP", "nome": "...", "pena": "...", "texto": "texto legal resumido", "exp": "o que significa na prática no caso", "simple": "explicação para leigos", "use_acu": "como a acusação usa", "use_def": "como a defesa usa", "juris": "entendimento de tribunal", "ref": "STJ/STF ..."}] (3), "arts_rapidos": ["4 referências curtas"], "hot": ["4 pontos polêmicos em forma de pergunta"], "pontos_acu": ["4 pontos fortes da acusação nas provas"], "pontos_def": ["4 pontos fortes da defesa nas provas"], "rito": "comum" | "juri", "acordo": true | false, "testemunhas": [{"id": "slug-curto", "nome": "...", "emoji": "um emoji de pessoa", "papel": "vitima|testemunha|policial|perito|reu", "papel_txt": "ex.: vítima, dona da loja", "arrolada_por": "acusacao|defesa|juizo", "perfil": "idade, profissão, personalidade e jeito de falar", "depoimento": "o que conta espontaneamente", "segredos": ["1 ou 2"], "contradicao": "Ele(a) diz que X — mas a prova Y mostra Z."}], "segredo_acu": ["1 informação que só a acusação sabe"], "segredo_def": ["1 informação que só a defesa sabe"], "fatos_ocultos": ["3 fatos que uma diligência pode descobrir"], "reviravoltas": [{"titulo": "...", "texto": "..."}, {"titulo": "...", "texto": "..."}], "dicas_acu": ["2 dicas para iniciantes"], "dicas_def": ["2 dicas para iniciantes"]}` }
      ]
    }),
    validate: d => Boolean(d?.titulo && d?.corpo && list(d.provas).length >= 6 && list(d.testemunhas).length >= 4 && list(d.reviravoltas).length >= 2 && Number(d.penaMax) >= 8),
    shape: d => ({ text: 'ok', caso: normalizeCase(d) })
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
      const acu = extra.papel === 'acusacao';
      const lado = acu ? 'PROMOTOR(A) DE JUSTIÇA (Acusação)' : 'DEFENSOR(A) (Defesa)';
      const objetivo = acu
        ? 'Seu objetivo é a CONDENAÇÃO do réu. Mesmo que as provas favoreçam a defesa, você minimiza essas provas, explora as contradições e pede a condenação (no máximo, uma pena menor). Você NUNCA pede absolvição e NUNCA defende excludentes do réu.'
        : 'Seu objetivo é a ABSOLVIÇÃO do réu (ou, se impossível, a menor pena). Você explora as dúvidas e as falhas da acusação. Você NUNCA pede condenação.';
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
          { role: 'system', content: `Você é ${lado} num jogo de simulação jurídica, jogando contra uma pessoa real. ${objetivo} Jogue para vencer, de forma técnica mas acessível. Use somente fatos que estão no caso e nos autos (inventar fatos ou acusar o adversário de crimes é punido pelo juiz). Defenda SEMPRE o seu lado: nunca mencione as teses do adversário como se fossem suas (um promotor não alega excludentes do réu; um defensor não pede condenação). Não seja perfeito demais: às vezes deixe de explorar algum ponto, como um advogado real. Nível do adversário: ${NIVEL_TXT[extra.nivel_humano] || NIVEL_TXT.advogado} — ajuste sua força a ele. Português do Brasil.` },
          { role: 'user', content: `${describeCase(c)}\n\n${extra.segredos?.length ? `Informações que só o seu lado conhece: ${extra.segredos.map(s => clip(s, 300)).join(' | ')}\n\n` : ''}${describeAutos(extra)}\n\nTAREFA: ${tarefas[extra.tarefa] || tarefas.replica}\n\nLEMBRE: você é a ${acu ? 'ACUSAÇÃO e quer a CONDENAÇÃO' : 'DEFESA e quer a ABSOLVIÇÃO'}. Responda APENAS com um objeto json válido: {"texto": "...", "pedido": "...", "testemunha_id": "...", "aceita": true|false} (preencha só os campos que a tarefa pede).` }
        ]
      };
    },
    shape: (d, extra) => {
      let pedido = str(d?.pedido);
      // trava de segurança: o rival não pode pedir o resultado do adversário
      if (extra.papel === 'acusacao' && /absolv/i.test(pedido)) pedido = 'condenação';
      if (extra.papel === 'defesa' && /^\s*condena/i.test(pedido)) pedido = 'absolvição';
      return { text: str(d?.texto, '...'), pedido, testemunha_id: str(d?.testemunha_id), aceita: d?.aceita === true };
    }
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
