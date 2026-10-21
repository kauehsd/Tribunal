// modules/game.js — o processo em fases: acordo → denúncia → instrução → (pronúncia) → debates → julgamento → recurso → fim
//
// Tudo o que acontece fica na sala do Firebase (rooms/{código}). Cada aparelho:
//   1. escuta a sala inteira e redesenha a tela (render)
//   2. roda o "piloto automático" (autopilot): quando chega a hora de um personagem de IA
//      falar (juiz, testemunha, jurados, desembargadores ou o rival do modo treino), um dos
//      aparelhos pega a trava `judge_busy` e faz a chamada — nunca os dois ao mesmo tempo.
import { ask } from '../ai-bridge.js';
import { DOSSIES, JURADOS, DESEMBARGADORES } from '../data/dossies.js';
import { applyGlossary } from '../data/glossario.js';
import { $, escapeHtml, nl2br, toast, playSound, ROLE_LABEL, ROLE_ICON, otherRole, fmtClock, saveDraft, loadDraft, clearDraft, autoGrow, moderate } from './util.js';
import { renderNewEvidence } from './case_view.js';
import { computeResult, saveCareer, careerCardHtml } from './career.js';

export const G = { db:null, roomRef:null, code:'', room:null, me:{ name:'', role:'' }, cases:[], serverOffset:0 };

const PROTEST_WINDOW_MS = 9000;     // tempo que o adversário tem para gritar "Protesto!"
const LOCK_MS = 80000;              // trava da IA expira sozinha se um aparelho cair no meio
const STALE_MS = 30000;             // se quem deveria agir sumiu, o outro aparelho assume
const MAX_PROTESTOS = 3;
const LIMITE_PERGUNTAS = { estagiario:5, advogado:4, jurista:4 };
const AI_PERGUNTAS = 2;             // perguntas do rival no modo treino
const ASSIST_LIMITE = { estagiario:Infinity, advogado:5, jurista:0 };

export const TURNOS = [
  { role:'acusacao', tipo:'alegacao', seg:180, titulo:'Alegações finais da Acusação' },
  { role:'defesa', tipo:'alegacao', seg:180, titulo:'Alegações finais da Defesa' },
  { role:'acusacao', tipo:'replica', seg:90, titulo:'Réplica da Acusação' },
  { role:'defesa', tipo:'treplica', seg:90, titulo:'Tréplica da Defesa' }
];

export const FASES = {
  acordo: { nome:'Acordo', icon:'🤝', o_que:'Antes de o processo começar, a Acusação pode oferecer um acordo (ANPP) em crimes sem violência com pena mínima menor que 4 anos: o réu confessa, cumpre condições e o processo nem começa.', acusacao:'Decida se oferece um acordo e com quais condições. Condições firmes e justas valem pontos.', defesa:'Se vier uma proposta, decida: aceitar e encerrar o caso, ou arriscar o julgamento.' },
  denuncia: { nome:'Denúncia', icon:'📜', o_que:'A Acusação apresenta a denúncia: conta o que aconteceu, diz qual é o crime e pede a condenação. A Defesa responde apontando falhas e teses. O juiz decide se o processo segue.', acusacao:'Narre o fato, diga qual é o crime (com o artigo) e peça a condenação.', defesa:'Leia a denúncia e responda: aponte provas fracas, nulidades e a sua tese.' },
  instrucao: { nome:'Instrução', icon:'🎙️', o_que:'A audiência: testemunhas, vítima, perito e, por último, o réu são ouvidos. Vocês perguntam diretamente (Art. 212 CPP), e o adversário pode gritar "Protesto!" contra perguntas indevidas.', acusacao:'Arranque das testemunhas o que prova a culpa. Uma pergunta certeira pode revelar um segredo (+2 pontos).', defesa:'Mostre contradições e dúvidas. Proteste contra perguntas que induzem a resposta.' },
  pronuncia: { nome:'Pronúncia', icon:'🔨', o_que:'Nos crimes contra a vida, o juiz decide se o caso vai ao Júri Popular (7 cidadãos comuns) ou se o crime é outro, julgado por ele mesmo.' },
  debates: { nome:'Debates', icon:'🗣️', o_que:'As alegações finais: cada lado tem um tempo para resumir as provas e convencer quem vai julgar. Depois vêm a réplica e a tréplica.', acusacao:'Junte tudo o que foi provado e faça o seu pedido de pena.', defesa:'Mostre as dúvidas e peça a absolvição (ou a pena mínima).' },
  julgamento: { nome:'Julgamento', icon:'⚖️', o_que:'O juiz dá a sentença — ou, no Júri, os 7 jurados votam e o juiz calcula a pena.' },
  recurso: { nome:'Recurso', icon:'🏛️', o_que:'Quem perdeu pode apelar ao Tribunal de Justiça. Três desembargadores, cada um com seu jeito de pensar, revisam a sentença e votam.' },
  fim: { nome:'Fim', icon:'🏁', o_que:'O processo terminou. Veja o placar, as conquistas e a sua carreira.' }
};

const MOTIVOS_PROTESTO = [
  { id:'indutiva', label:'Pergunta indutiva', desc:'já sugere a resposta' },
  { id:'impertinente', label:'Sem relação com o caso', desc:'não tem a ver com os fatos' },
  { id:'repetida', label:'Já respondida', desc:'repete outra pergunta' },
  { id:'especulativa', label:'Pede opinião', desc:'testemunha não pode especular' },
  { id:'ofensiva', label:'Ofensiva', desc:'constrange a testemunha' }
];

// ══════════════════════════════════════════════════════
// Acesso ao estado
// ══════════════════════════════════════════════════════
const now = () => Date.now() + G.serverOffset;
const TS = () => firebase.database.ServerValue.TIMESTAMP;
const me = () => G.me.role;
const caseOf = room => G.cases[room.caseIdx] || G.cases[0];
const dossieOf = room => DOSSIES[caseOf(room).id];
const aiRole = room => room.solo ? otherRole(me()) : null;
const isAI = (room, role) => Boolean(room.solo) && role === aiRole(room);
const nameOf = (room, role) => isAI(room, role) ? `IA (${ROLE_LABEL[role]})` : (room.players?.[role]?.name || ROLE_LABEL[role]);
const nivelOf = (room, role) => room.players?.[role]?.nivel || 'advogado';
const witnessOf = (room, id) => dossieOf(room).testemunhas.find(t => t.id === id);
const autosList = room => Object.entries(room.autos || {}).map(([k, v]) => ({ key:k, ...v }));

export function initialRoomState(caseIdx, cases){
  const c = cases[caseIdx];
  const d = DOSSIES[c.id];
  const phase = d.acordo ? 'acordo' : 'denuncia';
  return {
    caseIdx, rito: d.rito, phase,
    acordo: d.acordo ? { status:'proposta' } : null,
    score: { acusacao:0, defesa:0 },
    cartas: { acusacao:{ diligencia:1, pergunta:1, tempo:1 }, defesa:{ diligencia:1, pergunta:1, tempo:1 } },
    // chave que ordena antes de qualquer push do Firebase: a faixa da primeira fase abre os autos
    autos: { '-0000inicio': { tipo:'fase', fase: phase, por:'sistema', texto:`${FASES[phase].icon} ${FASES[phase].nome.toUpperCase()}`, ts:0 } },
    pecas: null, recebimento: null, instrucao: null, pronuncia: null,
    debates: null, julgamento: null, recurso: null, final: null, judge_busy: null,
    fatosRevelados: null, assistUses: null, ia_chat_acusacao: null, ia_chat_defesa: null
  };
}

// ══════════════════════════════════════════════════════
// Escrita no Firebase
// ══════════════════════════════════════════════════════
function pushAuto(entry){ return G.roomRef.child('autos').push({ ...entry, ts: TS() }); }

async function addScore(points){
  if(!points) return;
  await G.roomRef.child('score').transaction(s => {
    s = s || { acusacao:0, defesa:0 };
    s.acusacao = (s.acusacao || 0) + (points.acusacao || 0);
    s.defesa = (s.defesa || 0) + (points.defesa || 0);
    return s;
  });
}

// Muda de fase só se ainda estivermos na fase esperada (os dois aparelhos podem tentar ao mesmo tempo)
async function setPhase(from, to, updates = {}){
  const tx = await G.roomRef.child('phase').transaction(p => p === from ? to : undefined);
  if(!tx.committed) return false;
  if(Object.keys(updates).length) await G.roomRef.update(updates);
  const f = FASES[to];
  await pushAuto({ tipo:'fase', fase:to, por:'sistema', texto:`${f.icon} ${f.nome.toUpperCase()}` });
  return true;
}

let localBusy = false;
// Executa uma ação de IA com a trava da sala. fn recebe o estado mais recente da sala.
async function withLock(label, fn){
  if(localBusy) return false;
  localBusy = true;
  const ref = G.roomRef.child('judge_busy');
  try{
    const tx = await ref.transaction(v => (v && now() - (v.ts || 0) < LOCK_MS) ? undefined : { ts: now(), label, by: me() });
    if(!tx.committed) return false;
    try{
      const room = (await G.roomRef.once('value')).val();
      await fn(room);
    }finally{
      await ref.remove();
    }
    return true;
  }catch(e){
    console.error('[withLock]', label, e);
    toast('Algo deu errado: ' + (e.message || e));
    return false;
  }finally{
    localBusy = false;
  }
}

// ══════════════════════════════════════════════════════
// Contexto para a IA
// ══════════════════════════════════════════════════════
const PECA_NOME = { denuncia:'DENÚNCIA', resposta:'RESPOSTA À ACUSAÇÃO', alegacao:'ALEGAÇÕES FINAIS', replica:'RÉPLICA', treplica:'TRÉPLICA', apelacao:'APELAÇÃO', contrarrazoes:'CONTRARRAZÕES', acordo_proposta:'PROPOSTA DE ACORDO', acordo_resposta:'RESPOSTA AO ACORDO' };

function autoLine(a){
  const quem = ROLE_LABEL[a.por] || a.por;
  switch(a.tipo){
    case 'fase': return `— fase: ${a.fase} —`;
    case 'depoimento': return `[DEPOIMENTO de ${a.nome}] ${ROLE_LABEL[a.por]} perguntou: "${a.pergunta}" — Resposta: "${a.resposta}"${a.revelou ? ' (revelou fato novo)' : ''}`;
    case 'protesto': return `[PROTESTO da ${ROLE_LABEL[a.protestoPor]} contra pergunta da ${ROLE_LABEL[a.por]} a ${a.nome}: "${a.pergunta}"] Motivo: ${a.motivo}. Decisão: ${a.decisao} — ${a.texto}`;
    case 'diligencia': return `[DILIGÊNCIA pedida pela ${quem}: "${a.pedido}"] Resultado: ${a.texto}`;
    case 'reviravolta': return `[FATO NOVO NOS AUTOS — ${a.titulo}] ${a.texto}`;
    case 'alegacao': return `[${PECA_NOME[a.subtipo] || 'ALEGAÇÕES'} — ${quem}] ${a.texto}${a.pedido ? ` (Pedido: ${a.pedido})` : ''}`;
    case 'sentenca': case 'juri': return `[${a.tipo === 'juri' ? 'VEREDITO DO JÚRI' : 'SENTENÇA'}] ${a.decisao}: ${a.texto}${a.dosimetria?.pena_final ? ` Pena: ${a.dosimetria.pena_final}, regime ${a.dosimetria.regime}` : ''}`;
    case 'acordao': return `[ACÓRDÃO] ${a.resultado}: ${a.texto}`;
    case 'nota': return `[${a.texto}]`;
    default:
      if(PECA_NOME[a.tipo]) return `[${PECA_NOME[a.tipo]} — ${quem}] ${a.texto}`;
      return `[${a.titulo || 'JUIZ'}] ${a.texto || ''}`;
  }
}

function aiContext(room){
  const autos = autosList(room).filter(a => a.tipo !== 'fase');
  return {
    autos: autos.map(autoLine),
    niveis: { acusacao: nivelOf(room, 'acusacao'), defesa: nivelOf(room, 'defesa') },
    // falas das partes, para o motor local pontuar quando a IA estiver fora
    localMsgs: autos.filter(a => a.por === 'acusacao' || a.por === 'defesa')
      .map(a => ({ role:a.por, text: a.tipo === 'depoimento' ? a.pergunta : (a.texto || '') }))
  };
}

// ══════════════════════════════════════════════════════
// AÇÕES DOS JOGADORES
// ══════════════════════════════════════════════════════
function checkText(text, min = 10){
  if(!text || text.trim().length < min){ toast(`Escreva um pouco mais (mínimo ${min} caracteres).`); return false; }
  const m = moderate(text);
  if(m.blocked){ toast(`⚠️ Linguagem imprópria para o tribunal: "${m.word}"`); return false; }
  return true;
}

const actions = {
  // ── Acordo ──
  async proporAcordo(termos){
    if(!checkText(termos)) return;
    // sempre: primeiro a peça entra nos autos, depois o estado avança (senão o outro lado pode responder antes de ela aparecer)
    await pushAuto({ tipo:'acordo_proposta', por:'acusacao', texto:termos });
    await G.roomRef.child('acordo').update({ status:'resposta', termos });
    clearDraft('acordo');
  },
  async semAcordo(){
    await pushAuto({ tipo:'nota', por:'sistema', texto:'A Acusação decidiu não oferecer acordo. O processo segue.' });
    await setPhase('acordo', 'denuncia');
  },
  async responderAcordo(aceita){
    await pushAuto({ tipo:'acordo_resposta', por:'defesa', texto: aceita ? 'A Defesa ACEITA o acordo.' : 'A Defesa RECUSA o acordo e vai a julgamento.' });
    if(aceita) await G.roomRef.child('acordo/status').set('homologando');
    else await setPhase('acordo', 'denuncia');
  },

  // ── Denúncia ──
  async enviarPeca(tipo, texto){
    if(!checkText(texto, 30)) return;
    await pushAuto({ tipo, por: tipo === 'denuncia' ? 'acusacao' : 'defesa', texto });
    await G.roomRef.child(`pecas/${tipo}`).set(texto);
    clearDraft(tipo);
  },

  // ── Instrução ──
  async perguntar(testemunhaId, pergunta){
    if(!testemunhaId){ toast('Escolha quem vai responder.'); return; }
    if(!checkText(pergunta, 8)) return;
    const role = me();
    const room = G.room;
    if((room.instrucao.perguntas?.[role] || 0) >= room.instrucao.limite[role]){ toast('Você já usou todas as suas perguntas.'); return; }
    const ok = await createPending(role, testemunhaId, pergunta);
    if(!ok){ toast('Aguarde: ainda há uma pergunta sendo respondida.'); return; }
    clearDraft('pergunta');
  },
  async protestar(motivo){
    const role = me();
    const tx = await G.roomRef.child('instrucao').transaction(ins => {
      if(!ins?.pending || ins.pending.por === role || ins.pending.protesto) return undefined;
      if(now() > ins.pending.ts + PROTEST_WINDOW_MS) return undefined;
      ins.protestos = ins.protestos || {};
      if((ins.protestos[role] || 0) >= MAX_PROTESTOS) return undefined;
      ins.protestos[role] = (ins.protestos[role] || 0) + 1;
      ins.pending.protesto = { por: role, motivo };
      return ins;
    });
    if(tx.committed) playSound('protest');
    else toast('Tarde demais para protestar!');
  },
  async encerrarPerguntas(){ await G.roomRef.child(`instrucao/pronto/${me()}`).set(true); },
  async toggleSilencio(v){
    await G.roomRef.child('instrucao/silencio').set(v);
    await pushAuto({ tipo:'nota', por:'sistema', texto: v ? 'A Defesa orientou o réu a exercer o direito ao silêncio diante das perguntas da Acusação (Art. 5º, LXIII, CF).' : 'O réu vai responder a todas as perguntas.' });
  },

  // ── Cartas ──
  async cartaPergunta(){
    if(!await useCard('pergunta')) return;
    await G.roomRef.child(`instrucao/limite/${me()}`).transaction(v => (v || 0) + 2);
    await pushAuto({ tipo:'nota', por:'sistema', texto:`🃏 ${ROLE_LABEL[me()]} usou a carta "Perguntas extras" (+2 perguntas).` });
  },
  async cartaTempo(){
    if(!await useCard('tempo')) return;
    await G.roomRef.child('debates/extra').transaction(v => (v || 0) + 90);
    await pushAuto({ tipo:'nota', por:'sistema', texto:`🃏 ${ROLE_LABEL[me()]} usou a carta "Mais tempo" (+90 segundos).` });
  },
  async cartaDiligencia(pedido){
    if(!checkText(pedido, 10)) return;
    const role = me();
    if(!(G.room.cartas?.[role]?.diligencia > 0)){ toast('Você não tem mais essa carta.'); return; }
    const ok = await withLock('O juiz analisa o pedido de diligência…', async room => {
      if(!await useCard('diligencia')) return;
      await runDiligencia(room, role, pedido);
    });
    if(!ok) toast('O tribunal está ocupado. Tente de novo em instantes.');
    else clearDraft('diligencia');
  },

  // ── Debates ──
  async enviarAlegacao(texto, pedido, auto = false){
    const room = G.room;
    const t = room.debates.turno;
    const turno = TURNOS[t];
    if(!auto && !checkText(texto, 20)) return;
    if(t === 0 || t === 1){ if(!auto && !pedido?.trim()){ toast('Diga o que você pede ao juiz (ex.: "absolvição" ou "4 anos").'); return; } }
    await submitTurn(t, turno.role, texto || '(o tempo acabou sem manifestação)', pedido);
    clearDraft('alegacao_' + t); clearDraft('pedido');
  },
  async dispensarReplica(){
    const tx = await G.roomRef.child('debates/turno').transaction(t => t === 2 ? 4 : undefined);
    if(tx.committed) await pushAuto({ tipo:'nota', por:'sistema', texto:'A Acusação dispensou a réplica — por isso não há tréplica (Art. 476 CPP).' });
  },

  // ── Recurso ──
  async apelar(){
    const role = me();
    const tx = await G.roomRef.child('recurso').transaction(r => {
      if(!r || r.status !== 'decidir') return undefined;
      r.status = 'razoes'; r.apelante = role;
      return r;
    });
    if(tx.committed) await pushAuto({ tipo:'nota', por:'sistema', texto:`${ROLE_ICON[role]} ${ROLE_LABEL[role]} interpôs APELAÇÃO ao Tribunal de Justiça.` });
  },
  async aceitarDecisao(){
    const role = me();
    await G.roomRef.child(`recurso/aceitou/${role}`).set(true);
    await pushAuto({ tipo:'nota', por:'sistema', texto:`${ROLE_ICON[role]} ${ROLE_LABEL[role]} aceitou a decisão.` });
  },
  async enviarRazoes(texto){
    if(!checkText(texto, 30)) return;
    await pushAuto({ tipo:'apelacao', por: me(), texto });
    await G.roomRef.child('recurso').update({ razoes:texto, status:'contrarrazoes' });
    clearDraft('razoes');
  },
  async enviarContrarrazoes(texto, dispensar = false){
    if(!dispensar && !checkText(texto, 20)) return;
    await pushAuto(dispensar ? { tipo:'nota', por:'sistema', texto:`${ROLE_LABEL[me()]} não apresentou contrarrazões.` } : { tipo:'contrarrazoes', por: me(), texto });
    await G.roomRef.child('recurso').update({ contrarrazoes: dispensar ? '' : texto, status:'julgando' });
    clearDraft('contrarrazoes');
  },

  // ── Fim ──
  async novoCaso(idx){
    const room = G.room;
    const players = { acusacao: room.players.defesa || null, defesa: room.players.acusacao || null };
    await G.roomRef.update({ ...initialRoomState(idx, G.cases), players, round:(room.round || 0) + 1 });
    // o listener de 'round' (main.js) recarrega os dois aparelhos
  }
};
export { actions };

async function useCard(card){
  const tx = await G.roomRef.child(`cartas/${me()}/${card}`).transaction(v => (v || 0) > 0 ? v - 1 : undefined);
  if(!tx.committed) toast('Você não tem mais essa carta.');
  return tx.committed;
}

async function createPending(role, testemunhaId, pergunta){
  const tx = await G.roomRef.child('instrucao').transaction(ins => {
    if(!ins || ins.pending) return undefined;
    ins.perguntas = ins.perguntas || {};
    if((ins.perguntas[role] || 0) >= ins.limite[role]) return undefined;
    ins.perguntas[role] = (ins.perguntas[role] || 0) + 1;
    ins.pending = { id: Math.random().toString(36).slice(2, 9), testemunhaId, por: role, pergunta, ts: now(), protesto: null };
    return ins;
  });
  return tx.committed;
}

async function submitTurn(t, role, texto, pedido){
  const tx = await G.roomRef.child('debates').transaction(d => {
    if(!d || d.turno !== t) return undefined;
    d.turno = t + 1; d.inicio = now(); d.extra = 0;
    if(pedido) { d.pedidos = d.pedidos || {}; d.pedidos[role] = pedido; }
    return d;
  });
  if(tx.committed) await pushAuto({ tipo:'alegacao', subtipo: TURNOS[t].tipo, por: role, texto, pedido: pedido || null });
}

async function runDiligencia(room, role, pedido){
  const d = dossieOf(room);
  const revelados = room.fatosRevelados || [];
  const ocultos = d.fatos_ocultos.map((f, i) => ({ f, i })).filter(x => !revelados.includes(x.i));
  const r = await ask('diligencia', caseOf(room), { ...aiContext(room), por: role, pedido, fatos_ocultos: ocultos.map(x => x.f) });
  const usado = r.fato_usado >= 0 && ocultos[r.fato_usado] ? ocultos[r.fato_usado].i : null;
  if(usado !== null) await G.roomRef.child('fatosRevelados').set([...revelados, usado]);
  await pushAuto({ tipo:'diligencia', por: role, pedido, texto: r.text, em_resumo: r.em_resumo, provider: r.provider });
}

// ══════════════════════════════════════════════════════
// PILOTO AUTOMÁTICO — o que os personagens de IA fazem, e quando
// ══════════════════════════════════════════════════════
let autopilotRunning = false;
export async function autopilot(){
  const room = G.room;
  if(!room || autopilotRunning || localBusy) return;
  if(room.judge_busy && now() - (room.judge_busy.ts || 0) < LOCK_MS) return;
  autopilotRunning = true;
  try{ await step(room); }
  catch(e){ console.error('[autopilot]', e); }
  finally{ autopilotRunning = false; }
}

async function step(room){
  const c = caseOf(room);
  const ai = aiRole(room);

  switch(room.phase){
    case 'acordo': {
      const a = room.acordo || {};
      if(a.status === 'homologando') return withLock('O juiz analisa o acordo…', homologarAcordo);
      if(ai === 'acusacao' && a.status === 'proposta') return withLock('A Acusação (IA) está pensando…', async r => {
        const o = await ask('oponente', c, { ...aiContext(r), papel:'acusacao', tarefa:'acordo_proposta', segredos: dossieOf(r).segredo_acu, nivel_humano: nivelOf(r, me()) });
        if(o.aceita && o.text){ await pushAuto({ tipo:'acordo_proposta', por:'acusacao', texto:o.text }); await G.roomRef.child('acordo').update({ status:'resposta', termos:o.text }); }
        else { await pushAuto({ tipo:'nota', por:'sistema', texto:'A Acusação decidiu não oferecer acordo.' }); await setPhase('acordo', 'denuncia'); }
      });
      if(ai === 'defesa' && a.status === 'resposta') return withLock('A Defesa (IA) avalia a proposta…', async r => {
        const o = await ask('oponente', c, { ...aiContext(r), papel:'defesa', tarefa:'acordo_resposta', termos: r.acordo.termos, nivel_humano: nivelOf(r, me()) });
        await pushAuto({ tipo:'acordo_resposta', por:'defesa', texto: (o.aceita ? 'A Defesa ACEITA o acordo. ' : 'A Defesa RECUSA o acordo. ') + (o.text || '') });
        if(o.aceita) await G.roomRef.child('acordo/status').set('homologando');
        else await setPhase('acordo', 'denuncia');
      });
      return;
    }

    case 'denuncia': {
      const p = room.pecas || {};
      if(p.denuncia && p.resposta && !room.recebimento) return withLock('O juiz analisa a denúncia e a resposta…', receberDenuncia);
      if(ai === 'acusacao' && !p.denuncia) return withLock('A Acusação (IA) redige a denúncia…', r => aiPeca(r, 'acusacao', 'denuncia'));
      if(ai === 'defesa' && p.denuncia && !p.resposta) return withLock('A Defesa (IA) redige a resposta…', r => aiPeca(r, 'defesa', 'resposta'));
      return;
    }

    case 'instrucao': {
      const ins = room.instrucao || {};
      const pend = ins.pending;
      if(pend){
        const windowClosed = pend.protesto || now() > pend.ts + PROTEST_WINDOW_MS;
        const mineToRun = pend.por === me() || isAI(room, pend.por) || now() > pend.ts + STALE_MS;
        if(windowClosed && mineToRun) return withLock(pend.protesto ? 'O juiz decide o protesto…' : `${witnessOf(room, pend.testemunhaId)?.nome || 'A testemunha'} está respondendo…`, processPending);
        return;
      }
      if(instrucaoDone(room)) return withLock(room.rito === 'juri' && !room.pronuncia ? 'O juiz decide se o caso vai a Júri…' : 'Encerrando a instrução…', encerrarInstrucao);
      if(ai){
        const aiAsked = ins.perguntas?.[ai] || 0;
        const humanAsked = ins.perguntas?.[me()] || 0;
        const humanDone = ins.pronto?.[me()] || humanAsked >= ins.limite[me()];
        if(aiAsked < ins.limite[ai] && (humanAsked >= aiAsked * 2 + 1 || humanDone)) return withLock(`A ${ROLE_LABEL[ai]} (IA) prepara uma pergunta…`, aiPergunta);
      }
      return;
    }

    case 'debates': {
      const d = room.debates;
      if(!d) return;
      if(d.turno >= TURNOS.length) return setPhase('debates', 'julgamento');
      const turno = TURNOS[d.turno];
      if(isAI(room, turno.role)) return withLock(`A ${ROLE_LABEL[turno.role]} (IA) está falando…`, r => aiAlegacao(r, d.turno));
      const deadline = d.inicio + (turno.seg + (d.extra || 0)) * 1000;
      // quem está com a palavra deixou o tempo acabar: envia o rascunho; se sumiu, o outro aparelho encerra o turno
      if(now() > deadline && turno.role === me()) return actions.enviarAlegacao(loadDraft('alegacao_' + d.turno), loadDraft('pedido') || 'conforme exposto', true);
      if(now() > deadline + 20000) return submitTurn(d.turno, turno.role, '(não se manifestou no prazo)', null);
      return;
    }

    case 'julgamento':
      if(!room.julgamento) return withLock(room.rito === 'juri' ? 'Os jurados estão votando em sala secreta…' : 'O juiz está redigindo a sentença…', julgar);
      return;

    case 'recurso': {
      const r = room.recurso || {};
      if(r.status === 'julgando') return withLock('A Câmara Criminal está em sessão…', julgarRecurso);
      const perdedores = r.perdedor === 'ambos' ? ['acusacao', 'defesa'] : [r.perdedor];
      if(r.status === 'decidir'){
        if(perdedores.every(p => r.aceitou?.[p])) return withLock('Encerrando o processo…', fr => finalizar(fr, fr.julgamento.vencedor, 'Ninguém recorreu: a sentença transitou em julgado.'));
        if(ai && perdedores.includes(ai) && !r.aceitou?.[ai]) return withLock(`A ${ROLE_LABEL[ai]} (IA) prepara a apelação…`, async fr => {
          const o = await ask('oponente', caseOf(fr), { ...aiContext(fr), papel: ai, tarefa:'apelacao', nivel_humano: nivelOf(fr, me()) });
          await pushAuto({ tipo:'nota', por:'sistema', texto:`${ROLE_ICON[ai]} ${ROLE_LABEL[ai]} interpôs APELAÇÃO ao Tribunal de Justiça.` });
          await pushAuto({ tipo:'apelacao', por: ai, texto: o.text });
          await G.roomRef.child('recurso').update({ status:'contrarrazoes', apelante: ai, razoes: o.text });
        });
      }
      if(r.status === 'contrarrazoes' && ai && r.apelante !== ai) return withLock(`A ${ROLE_LABEL[ai]} (IA) responde ao recurso…`, async fr => {
        const o = await ask('oponente', caseOf(fr), { ...aiContext(fr), papel: ai, tarefa:'contrarrazoes', nivel_humano: nivelOf(fr, me()) });
        await pushAuto({ tipo:'contrarrazoes', por: ai, texto: o.text });
        await G.roomRef.child('recurso').update({ contrarrazoes: o.text, status:'julgando' });
      });
      return;
    }
  }
}

function instrucaoDone(room){
  const ins = room.instrucao || {};
  return ['acusacao', 'defesa'].every(role => ins.pronto?.[role] || (ins.perguntas?.[role] || 0) >= ins.limite?.[role]);
}

// ── Passos de IA ──

async function homologarAcordo(room){
  if(room.phase !== 'acordo' || room.acordo?.status !== 'homologando') return;
  const r = await ask('acordo', caseOf(room), { ...aiContext(room), termos: room.acordo.termos });
  await pushAuto({ tipo:'acordo_decisao', por:'juiz', titulo:'Homologação do acordo', homologado:r.homologado, texto:r.text, em_resumo:r.em_resumo, provider:r.provider });
  await addScore(r.pontos);
  if(r.homologado){
    const s = (await G.roomRef.child('score').once('value')).val() || {};
    const vencedor = s.acusacao === s.defesa ? 'empate' : (s.acusacao > s.defesa ? 'acusacao' : 'defesa');
    await G.roomRef.child('acordo/status').set('feito');
    await G.roomRef.child('final').set({ vencedor, bonus:false, texto:'O processo terminou em acordo homologado: vence quem negociou melhor.' });
    await setPhase('acordo', 'fim');
  } else {
    await G.roomRef.child('acordo/status').set('negado');
    await setPhase('acordo', 'denuncia');
  }
}

async function aiPeca(room, role, tipo){
  const p = room.pecas || {};
  if(room.phase !== 'denuncia' || p[tipo]) return;
  const d = dossieOf(room);
  const o = await ask('oponente', caseOf(room), { ...aiContext(room), papel: role, tarefa: tipo, segredos: role === 'acusacao' ? d.segredo_acu : d.segredo_def, nivel_humano: nivelOf(room, me()) });
  await pushAuto({ tipo, por: role, texto: o.text });
  await G.roomRef.child(`pecas/${tipo}`).set(o.text);
}

async function receberDenuncia(room){
  if(room.phase !== 'denuncia' || room.recebimento) return;
  const r = await ask('recebimento', caseOf(room), { ...aiContext(room), denuncia: room.pecas.denuncia, resposta: room.pecas.resposta });
  await G.roomRef.child('recebimento').set(true);
  await pushAuto({ tipo:'decisao', por:'juiz', titulo:'Recebimento da denúncia', texto:r.text, em_resumo:r.em_resumo, comentarios:{ acusacao:r.comentario_acusacao, defesa:r.comentario_defesa }, pontos:r.pontos, provider:r.provider });
  await addScore(r.pontos);
  const lim = role => isAI(room, role) ? AI_PERGUNTAS : LIMITE_PERGUNTAS[nivelOf(room, role)];
  await setPhase('denuncia', 'instrucao', { instrucao: { limite:{ acusacao: lim('acusacao'), defesa: lim('defesa') }, perguntas:{ acusacao:0, defesa:0 }, protestos:{ acusacao:0, defesa:0 }, pronto:{}, pending:null, silencio:false, reviravolta:false } });
}

async function processPending(room){
  const pend = room.instrucao?.pending;
  if(room.phase !== 'instrucao' || !pend) return;
  const t = witnessOf(room, pend.testemunhaId);
  const c = caseOf(room);
  const ctx = aiContext(room);
  let protestoIndeferido = null;

  if(pend.protesto){
    const motivo = MOTIVOS_PROTESTO.find(m => m.id === pend.protesto.motivo)?.label || pend.protesto.motivo;
    const r = await ask('protesto', c, { ...ctx, testemunha_nome: t.nome, por: pend.por, contra: pend.protesto.por, pergunta: pend.pergunta, motivo });
    await addScore({ [pend.protesto.por]: r.decisao === 'deferido' ? 1 : -1 });
    if(r.decisao === 'deferido'){
      await pushAuto({ tipo:'protesto', por: pend.por, protestoPor: pend.protesto.por, nome: t.nome, emoji: t.emoji, pergunta: pend.pergunta, motivo, decisao:'deferido', texto:r.text, em_resumo:r.em_resumo, provider:r.provider });
      await G.roomRef.child('instrucao/pending').remove();
      playSound('gavel');
      return;
    }
    protestoIndeferido = { por: pend.protesto.por, motivo, texto: r.text };
  }

  let resp;
  if(t.papel === 'reu' && room.instrucao.silencio && pend.por === 'acusacao'){
    resp = { text:'Excelência, por orientação da minha defesa, vou exercer o meu direito de permanecer em silêncio.', tom:'firme', revelou_segredo:false, provider:'regra' };
  } else {
    const anteriores = autosList(room).filter(a => a.tipo === 'depoimento' && a.testemunhaId === t.id);
    const historico = anteriores.map(a => ({ por:a.por, pergunta:a.pergunta, resposta:a.resposta }));
    resp = await ask('testemunha', c, { ...ctx, testemunha: t, pergunta: pend.pergunta, por: pend.por, historico });
    // cada segredo só pontua uma vez: a testemunha não pode "revelar" mais segredos do que tem
    if(anteriores.filter(a => a.revelou).length >= (t.segredos || []).length) resp.revelou_segredo = false;
  }
  await pushAuto({ tipo:'depoimento', por: pend.por, testemunhaId: t.id, nome: t.nome, emoji: t.emoji, papel: t.papel_txt, pergunta: pend.pergunta, resposta: resp.text, tom: resp.tom, revelou: Boolean(resp.revelou_segredo), protestoIndeferido, provider: resp.provider });
  if(resp.revelou_segredo) await addScore({ [pend.por]: 2 });
  await G.roomRef.child('instrucao/pending').remove();

  // reviravolta: na metade das perguntas
  const ins = (await G.roomRef.child('instrucao').once('value')).val();
  const feitas = (ins.perguntas?.acusacao || 0) + (ins.perguntas?.defesa || 0);
  const total = (ins.limite?.acusacao || 0) + (ins.limite?.defesa || 0);
  if(!ins.reviravolta && feitas >= Math.ceil(total / 2)){
    await G.roomRef.child('instrucao/reviravolta').set(true);
    const rv = dossieOf(room).reviravolta;
    await pushAuto({ tipo:'reviravolta', por:'sistema', titulo: rv.titulo, texto: rv.texto });
  }
}

async function aiPergunta(room){
  const ai = aiRole(room);
  if(room.phase !== 'instrucao' || room.instrucao?.pending) return;
  const d = dossieOf(room);
  const o = await ask('oponente', caseOf(room), { ...aiContext(room), papel: ai, tarefa:'pergunta', testemunhas: d.testemunhas.map(t => ({ id:t.id, nome:t.nome, papel_txt:t.papel_txt })), segredos: ai === 'acusacao' ? d.segredo_acu : d.segredo_def, nivel_humano: nivelOf(room, me()) });
  const tid = d.testemunhas.some(t => t.id === o.testemunha_id) ? o.testemunha_id : d.testemunhas[(room.instrucao.perguntas?.[ai] || 0) % d.testemunhas.length].id;
  await createPending(ai, tid, o.text);
}

async function encerrarInstrucao(room){
  if(room.phase !== 'instrucao' || !instrucaoDone(room) || room.instrucao?.pending) return;
  let rito = room.rito;
  if(rito === 'juri' && !room.pronuncia){
    const r = await ask('pronuncia', caseOf(room), aiContext(room));
    rito = r.decisao === 'pronuncia' ? 'juri' : 'comum';
    await G.roomRef.update({ pronuncia: { decisao:r.decisao, crime:r.crime }, rito });
    await pushAuto({ tipo:'pronuncia', por:'juiz', titulo: r.decisao === 'pronuncia' ? 'PRONÚNCIA — o réu vai a Júri' : 'DESCLASSIFICAÇÃO — sem Júri', decisao:r.decisao, crime:r.crime, texto:r.text, em_resumo:r.em_resumo, provider:r.provider });
    await addScore(r.pontos);
    playSound('gavel');
  }
  await setPhase('instrucao', 'debates', { debates: { turno:0, inicio: now(), extra:0, pedidos:{} } });
}

async function aiAlegacao(room, t){
  if(room.phase !== 'debates' || room.debates?.turno !== t) return;
  const turno = TURNOS[t];
  const d = dossieOf(room);
  const o = await ask('oponente', caseOf(room), { ...aiContext(room), papel: turno.role, tarefa: turno.tipo === 'alegacao' ? 'alegacao' : 'replica', segredos: turno.role === 'acusacao' ? d.segredo_acu : d.segredo_def, nivel_humano: nivelOf(room, me()) });
  await submitTurn(t, turno.role, o.text, turno.tipo === 'alegacao' ? (o.pedido || (turno.role === 'acusacao' ? 'condenação' : 'absolvição')) : null);
}

function pickJurados(room){
  // sorteio estável por sala/rodada, para os dois aparelhos verem os mesmos jurados
  let seed = [...(G.code + (room.round || 0))].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  return [...JURADOS].map(j => ({ j, k: rnd() })).sort((a, b) => a.k - b.k).slice(0, 7).map(x => x.j);
}

async function julgar(room){
  if(room.phase !== 'julgamento' || room.julgamento) return;
  const c = caseOf(room);
  const ctx = aiContext(room);
  const pedidos = room.debates?.pedidos || {};
  let r;
  if(room.rito === 'juri'){
    const jurados = pickJurados(room);
    r = await ask('juri', c, { ...ctx, jurados, crime: room.pronuncia?.crime });
    r.votos = (r.votos || []).map((v, i) => ({ ...v, emoji: jurados[i]?.emoji || '🧑' }));
    await pushAuto({ tipo:'juri', por:'jurados', decisao:r.decisao, votos:r.votos, texto:r.text, dosimetria:r.dosimetria, em_resumo:r.em_resumo, melhor:{ acusacao:r.melhor_momento_acusacao, defesa:r.melhor_momento_defesa }, provider:r.provider });
  } else {
    r = await ask('sentenca', c, { ...ctx, pedidos });
    await pushAuto({ tipo:'sentenca', por:'juiz', decisao:r.decisao, texto:r.text, dosimetria:r.dosimetria, em_resumo:r.em_resumo, melhor:{ acusacao:r.melhor_momento_acusacao, defesa:r.melhor_momento_defesa }, provider:r.provider });
  }
  playSound('gavel');
  await addScore(r.pontos);
  const dec = String(r.decisao || '');
  const vencedor = /ABSOLV/.test(dec) ? 'defesa' : /PARCIAL|DESCLASSIF/.test(dec) ? 'empate' : 'acusacao';
  const perdedor = vencedor === 'empate' ? 'ambos' : otherRole(vencedor);
  const resumo = `${dec}${r.dosimetria?.pena_final ? ` — ${r.dosimetria.pena_final} (${r.dosimetria.regime})` : ''}`;
  await G.roomRef.child('julgamento').set({ decisao: dec, vencedor, resumo, texto: r.text });
  await setPhase('julgamento', 'recurso', { recurso: { status:'decidir', perdedor, aceitou:{} } });
}

async function julgarRecurso(room){
  if(room.phase !== 'recurso' || room.recurso?.status !== 'julgando') return;
  const rec = room.recurso;
  const r = await ask('acordao', caseOf(room), {
    ...aiContext(room), desembargadores: DESEMBARGADORES, apelante: rec.apelante,
    sentenca: `${room.julgamento.resumo}. ${room.julgamento.texto}${room.rito === 'juri' ? ' (Decisão do Tribunal do Júri: pela soberania dos veredictos, o Tribunal só pode mandar o réu a novo Júri se a decisão for manifestamente contrária à prova dos autos; a dosimetria pode ser corrigida diretamente.)' : ''}`,
    razoes: rec.razoes, contrarrazoes: rec.contrarrazoes
  });
  r.votos = (r.votos || []).map((v, i) => ({ ...v, emoji: DESEMBARGADORES[i]?.emoji || '🧑‍⚖️' }));
  await pushAuto({ tipo:'acordao', por:'tribunal', resultado:r.resultado, votos:r.votos, texto:r.text, em_resumo:r.em_resumo, provider:r.provider });
  playSound('gavel');
  await addScore(r.pontos);
  const vencedor = r.resultado === 'provido' ? rec.apelante : r.resultado === 'desprovido' ? otherRole(rec.apelante) : 'empate';
  await finalizar(room, vencedor, `Acórdão: recurso ${r.resultado}. ${r.text}`);
}

async function finalizar(room, vencedor, texto){
  if(room.phase === 'fim') return;
  const bonus = vencedor === 'acusacao' || vencedor === 'defesa';
  if(bonus) await addScore({ [vencedor]: 5 });
  await G.roomRef.child('final').set({ vencedor, bonus, texto });
  await setPhase(room.phase, 'fim');
}

// ══════════════════════════════════════════════════════
// RENDERIZAÇÃO
// ══════════════════════════════════════════════════════
const renderedAutos = new Set();
let firstAutosRender = true;

export function render(){
  const room = G.room; if(!room) return;
  renderTop(room);
  renderAutos(room);
  renderPending(room);
  renderBusy(room);
  renderPanel(room);
  renderNewEvidence(newEvidence(room));
}

function newEvidence(room){
  return autosList(room).filter(a => a.tipo === 'diligencia' || a.tipo === 'reviravolta').map(a => a.tipo === 'reviravolta' ? `${a.titulo}: ${a.texto}` : a.texto);
}

function renderTop(room){
  const s = room.score || {};
  $('top-score').innerHTML = `<span class="ts-acu" title="${escapeHtml(nameOf(room, 'acusacao'))}">⚔️ ${s.acusacao || 0}</span><span class="ts-x">×</span><span class="ts-def" title="${escapeHtml(nameOf(room, 'defesa'))}">${s.defesa || 0} 🛡️</span>`;
  $('sc-acu').textContent = s.acusacao || 0;
  $('sc-def').textContent = s.defesa || 0;
  $('sc-acu-label').textContent = `⚔️ ${nameOf(room, 'acusacao')}`;
  $('sc-def-label').textContent = `🛡️ ${nameOf(room, 'defesa')}`;

  const d = dossieOf(room);
  const steps = [d.acordo && 'acordo', 'denuncia', 'instrucao', d.rito === 'juri' && 'pronuncia', 'debates', 'julgamento', 'recurso', 'fim'].filter(Boolean);
  const order = ['acordo', 'denuncia', 'instrucao', 'pronuncia', 'debates', 'julgamento', 'recurso', 'fim'];
  // a pronúncia acontece no fim da instrução
  const cur = room.phase === 'instrucao' && room.pronuncia ? 'debates' : room.phase;
  const curIdx = order.indexOf(cur);
  $('phase-stepper').innerHTML = steps.map(p => {
    const i = order.indexOf(p);
    const st = i < curIdx || (p === 'pronuncia' && room.pronuncia) ? 'done' : p === cur ? 'now' : '';
    return `<div class="step ${st}"><span>${FASES[p].icon}</span><small>${FASES[p].nome}</small></div>`;
  }).join('<div class="step-line"></div>');
}

function roleBubbleClass(role){ return `${role} ${role === me() ? 'mine' : 'theirs'}`; }
function providerTag(p){ return p ? `<span class="prov">⚡ ${escapeHtml(p)}</span>` : ''; }
function resumoHtml(t){ return t ? `<div class="em-resumo">📢 <strong>Em resumo:</strong> ${escapeHtml(t)}</div>` : ''; }
function dosimetriaHtml(d){
  if(!d || !d.pena_final) return '';
  return `<div class="dosi"><div class="dosi-title">Dosimetria da pena</div>
    ${d.fase1 ? `<div class="dosi-row"><span>1ª fase</span>${escapeHtml(d.fase1)}</div>` : ''}
    ${d.fase2 ? `<div class="dosi-row"><span>2ª fase</span>${escapeHtml(d.fase2)}</div>` : ''}
    ${d.fase3 ? `<div class="dosi-row"><span>3ª fase</span>${escapeHtml(d.fase3)}</div>` : ''}
    <div class="dosi-final">${escapeHtml(d.pena_final)}${d.regime ? ` · regime ${escapeHtml(d.regime)}` : ''}</div></div>`;
}

function autoHtml(a){
  const room = G.room;
  const who = r => `${ROLE_ICON[r] || ''} ${escapeHtml(nameOf(room, r))}`;
  switch(a.tipo){
    case 'fase': return `<div class="auto-fase">${escapeHtml(a.texto)}</div>`;
    case 'nota': return `<div class="auto-nota">${escapeHtml(a.texto)}</div>`;
    case 'denuncia': case 'resposta': case 'apelacao': case 'contrarrazoes': case 'acordo_proposta': case 'acordo_resposta': case 'alegacao': {
      const nome = a.tipo === 'alegacao' ? (PECA_NOME[a.subtipo] || 'ALEGAÇÕES') : (PECA_NOME[a.tipo] || 'MANIFESTAÇÃO');
      return `<div class="peca ${roleBubbleClass(a.por)}"><div class="peca-head">${who(a.por)} · <span>${nome}</span></div><div class="peca-body">${nl2br(a.texto)}${a.pedido ? `<div class="peca-pedido">Pede: <strong>${escapeHtml(a.pedido)}</strong></div>` : ''}</div></div>`;
    }
    case 'decisao': case 'acordo_decisao': case 'pronuncia': {
      const com = a.comentarios ? ['acusacao', 'defesa'].filter(r => a.comentarios[r]).map(r => `<div class="judge-fb ${r}">${ROLE_ICON[r]} ${escapeHtml(a.comentarios[r])}${a.pontos ? ` <b>+${a.pontos[r] || 0}</b>` : ''}</div>`).join('') : '';
      return `<div class="judge-card gloss"><div class="jc-head">🧑‍⚖️ Dr. Augusto Melo · ${escapeHtml(a.titulo || 'Decisão')}${providerTag(a.provider)}</div><div class="jc-body">${nl2br(a.texto)}</div>${resumoHtml(a.em_resumo)}${com}</div>`;
    }
    case 'depoimento': {
      const ind = a.protestoIndeferido ? `<div class="protest-mini">✋ Protesto da ${ROLE_LABEL[a.protestoIndeferido.por]} (${escapeHtml(a.protestoIndeferido.motivo)}) — <b>INDEFERIDO</b>: ${escapeHtml(a.protestoIndeferido.texto)}</div>` : '';
      return `<div class="q-bubble ${roleBubbleClass(a.por)}"><div class="peca-head">${who(a.por)} → ${escapeHtml(a.nome)}</div><div class="peca-body">${nl2br(a.pergunta)}</div></div>${ind}
        <div class="wit-answer gloss"><div class="wa-head"><span class="wa-emoji">${a.emoji}</span><div><div class="wa-name">${escapeHtml(a.nome)}</div><div class="wa-role">${escapeHtml(a.papel || '')}${a.tom ? ` · <i>${escapeHtml(a.tom)}</i>` : ''}</div></div>${providerTag(a.provider)}</div><div class="wa-body">"${nl2br(a.resposta)}"</div>${a.revelou ? `<div class="reveal">🔓 Revelou algo novo! <b>+2</b> para a ${ROLE_LABEL[a.por]}</div>` : ''}</div>`;
    }
    case 'protesto':
      return `<div class="q-bubble struck ${roleBubbleClass(a.por)}"><div class="peca-head">${who(a.por)} → ${escapeHtml(a.nome)}</div><div class="peca-body">${nl2br(a.pergunta)}</div></div>
        <div class="judge-card protest gloss"><div class="jc-head">✋ PROTESTO da ${ROLE_LABEL[a.protestoPor]} · ${escapeHtml(a.motivo)}${providerTag(a.provider)}</div><div class="jc-body"><b>DEFERIDO.</b> ${escapeHtml(a.texto)}</div>${resumoHtml(a.em_resumo)}</div>`;
    case 'diligencia':
      return `<div class="judge-card dilig gloss"><div class="jc-head">🔍 Diligência pedida pela ${ROLE_LABEL[a.por]}${providerTag(a.provider)}</div><div class="dilig-ask">"${escapeHtml(a.pedido)}"</div><div class="jc-body">${nl2br(a.texto)}</div>${resumoHtml(a.em_resumo)}</div>`;
    case 'reviravolta':
      return `<div class="twist-card"><div class="twist-head">⚡ REVIRAVOLTA</div><div class="twist-title">${escapeHtml(a.titulo)}</div><div class="twist-body">${escapeHtml(a.texto)}</div></div>`;
    case 'sentenca':
      return `<div class="judge-card verdict gloss"><div class="jc-head">🔨 SENTENÇA${providerTag(a.provider)}</div><div class="verdict-dec">${escapeHtml(a.decisao)}</div><div class="jc-body">${nl2br(a.texto)}</div>${dosimetriaHtml(a.dosimetria)}${resumoHtml(a.em_resumo)}${melhoresHtml(a.melhor)}</div>`;
    case 'juri': {
      const condena = (a.votos || []).filter(v => v.voto === 'condena').length;
      const votos = (a.votos || []).map((v, i) => `<div class="juror ${v.voto}" style="animation-delay:${i * 0.35}s"><span class="j-emoji">${v.emoji || '🧑'}</span><div class="j-name">${escapeHtml(v.nome)}</div><div class="j-vote">${v.voto === 'condena' ? '🔴 Condena' : '🟢 Absolve'}</div>${v.pensamento ? `<div class="j-thought">"${escapeHtml(v.pensamento)}"</div>` : ''}</div>`).join('');
      return `<div class="judge-card verdict gloss"><div class="jc-head">👥 CONSELHO DE SENTENÇA${providerTag(a.provider)}</div><div class="jury-grid">${votos}</div><div class="verdict-dec">${escapeHtml(a.decisao)} · ${Math.max(condena, 7 - condena)} a ${Math.min(condena, 7 - condena)}</div><div class="jc-body">${nl2br(a.texto)}</div>${dosimetriaHtml(a.dosimetria)}${resumoHtml(a.em_resumo)}${melhoresHtml(a.melhor)}</div>`;
    }
    case 'acordao': {
      const votos = (a.votos || []).map((v, i) => `<div class="des-vote ${v.voto.replace(/\s/g, '-')}" style="animation-delay:${i * 0.5}s"><div class="dv-head"><span>${v.emoji}</span><div><b>${escapeHtml(v.nome)}</b><small>${escapeHtml(v.papel)}</small></div><div class="dv-voto">${escapeHtml(v.voto)}</div></div><div class="dv-body">${escapeHtml(v.fundamento)}</div></div>`).join('');
      return `<div class="judge-card verdict gloss"><div class="jc-head">🏛️ TRIBUNAL DE JUSTIÇA · 1ª Câmara Criminal${providerTag(a.provider)}</div>${votos}<div class="verdict-dec">Recurso ${escapeHtml(a.resultado)}</div><div class="jc-body">${nl2br(a.texto)}</div>${resumoHtml(a.em_resumo)}</div>`;
    }
    default: return `<div class="auto-nota">${escapeHtml(a.texto || '')}</div>`;
  }
}

function melhoresHtml(m){
  if(!m || (!m.acusacao && !m.defesa)) return '';
  return `<div class="best">${m.acusacao ? `<div class="judge-fb acusacao">⭐ ${escapeHtml(m.acusacao)}</div>` : ''}${m.defesa ? `<div class="judge-fb defesa">⭐ ${escapeHtml(m.defesa)}</div>` : ''}</div>`;
}

function renderAutos(room){
  const box = $('autos'); if(!box) return;
  let added = 0, lastTipo = '';
  for(const a of autosList(room)){
    if(renderedAutos.has(a.key)) continue;
    renderedAutos.add(a.key);
    const el = document.createElement('div');
    el.className = 'auto-item' + (firstAutosRender ? '' : ' new');
    el.innerHTML = autoHtml(a);
    el.querySelectorAll('.gloss').forEach(applyGlossary);
    box.appendChild(el);
    added++; lastTipo = a.tipo;
  }
  if(!added) return;
  const wasFirst = firstAutosRender;
  firstAutosRender = false;
  box.scrollTop = box.scrollHeight;
  if(wasFirst) return;
  if(lastTipo === 'reviravolta') playSound('twist');
  else if(['decisao', 'pronuncia', 'acordo_decisao', 'diligencia'].includes(lastTipo)) playSound('judge');
  else if(lastTipo !== 'fase') playSound('message');
  if(!document.querySelector('.btab[data-tab="audiencia"]')?.classList.contains('active')) $('aud-notif')?.classList.add('show');
}

function renderPending(room){
  const slot = $('pending-slot'); if(!slot) return;
  const pend = room.phase === 'instrucao' ? room.instrucao?.pending : null;
  if(!pend){ slot.innerHTML = ''; slot.dataset.key = ''; return; }
  const open = !pend.protesto && now() < pend.ts + PROTEST_WINDOW_MS;
  const canProtest = open && pend.por !== me() && !isAI(room, me()) && (room.instrucao.protestos?.[me()] || 0) < MAX_PROTESTOS;
  const key = `${pend.id}|${open}|${Boolean(pend.protesto)}|${canProtest}`;
  if(slot.dataset.key === key) return;
  slot.dataset.key = key;
  const t = witnessOf(room, pend.testemunhaId);
  const status = pend.protesto
    ? `<div class="pend-status protest-call">✋ PROTESTO da ${ROLE_LABEL[pend.protesto.por]}! O juiz vai decidir…</div>`
    : open ? `<div class="pend-status">⏳ ${pend.por === me() ? 'O adversário pode protestar…' : 'Você pode protestar contra esta pergunta'} <b data-until="${pend.ts + PROTEST_WINDOW_MS}"></b></div>`
    : `<div class="pend-status">💬 ${escapeHtml(t?.nome || 'A testemunha')} está pensando…</div>`;
  const protest = canProtest ? `<div class="protest-box"><button class="protest-btn" type="button">✋ PROTESTO, EXCELÊNCIA!</button><div class="protest-motivos">${MOTIVOS_PROTESTO.map(m => `<button type="button" class="motivo" data-motivo="${m.id}"><b>${m.label}</b><small>${m.desc}</small></button>`).join('')}</div><div class="protest-left">Protestos restantes: ${MAX_PROTESTOS - (room.instrucao.protestos?.[me()] || 0)} · protesto sem razão custa 1 ponto</div></div>` : '';
  slot.innerHTML = `<div class="q-bubble live ${roleBubbleClass(pend.por)}"><div class="peca-head">${ROLE_ICON[pend.por]} ${escapeHtml(nameOf(room, pend.por))} → ${t?.emoji || ''} ${escapeHtml(t?.nome || '')}</div><div class="peca-body">${nl2br(pend.pergunta)}</div></div>${status}${protest}`;
  if(canProtest){
    const box = slot.querySelector('.protest-box');
    slot.querySelector('.protest-btn').addEventListener('click', () => box.classList.add('open'));
    slot.querySelectorAll('.motivo').forEach(b => b.addEventListener('click', () => actions.protestar(b.dataset.motivo)));
    playSound('tick');
  }
  $('autos').scrollTop = $('autos').scrollHeight;
}

function renderBusy(room){
  const b = room.judge_busy;
  const show = b && now() - (b.ts || 0) < LOCK_MS;
  $('busy-slot').innerHTML = show ? `<div class="busy"><span class="busy-dots"><i></i><i></i><i></i></span>${escapeHtml(b.label || 'O tribunal está deliberando…')}</div>` : '';
}

// ── Painel de ação (o que EU posso fazer agora) ──
let panelKey = '';
function renderPanel(room){
  const p = panelFor(room);
  const info = phaseInfoHtml(room);
  const key = `${room.phase}|${p.key}`;
  if(key === panelKey) return;
  panelKey = key;
  $('phase-info').innerHTML = info;
  const el = $('action-panel');
  el.innerHTML = p.html;
  // restaura rascunhos e liga os campos de texto
  el.querySelectorAll('textarea[data-draft], input[data-draft]').forEach(ta => {
    ta.value = loadDraft(ta.dataset.draft);
    ta.addEventListener('input', () => { saveDraft(ta.dataset.draft, ta.value); if(ta.tagName === 'TEXTAREA') autoGrow(ta); const cnt = ta.parentElement.querySelector('.char-count'); if(cnt) cnt.textContent = `${ta.value.length} caracteres`; });
    if(ta.tagName === 'TEXTAREA') autoGrow(ta);
  });
  p.bind?.(el);
}

function phaseInfoHtml(room){
  const f = FASES[room.phase]; if(!f) return '';
  const tutorial = caseOf(room).tutorial;
  const meu = f[me()];
  return `<details class="phase-info" ${tutorial || nivelOf(room, me()) === 'estagiario' ? 'open' : ''}><summary>${f.icon} <b>${f.nome}</b> — o que acontece agora?</summary><div class="pi-body">${escapeHtml(f.o_que)}${meu ? `<div class="pi-goal">🎯 <b>Seu objetivo:</b> ${escapeHtml(meu)}</div>` : ''}</div></details>`;
}

function waitHtml(text){ return `<div class="wait">⏳ ${text}</div>`; }
function btn(id, label, cls = 'btn-primary'){ return `<button type="button" class="${cls}" data-act="${id}">${label}</button>`; }
function textarea(draft, ph, rows = 4){ return `<div class="ta-wrap"><textarea class="act-ta" data-draft="${draft}" rows="${rows}" placeholder="${escapeHtml(ph)}"></textarea><div class="char-count">0 caracteres</div></div>`; }
function on(el, act, fn){ el.querySelector(`[data-act="${act}"]`)?.addEventListener('click', async e => { const b = e.currentTarget; b.disabled = true; try{ await fn(); } finally { b.disabled = false; } }); }
const val = (el, draft) => el.querySelector(`[data-draft="${draft}"]`)?.value.trim() || '';

function cartasHtml(room, allowed){
  const c = room.cartas?.[me()] || {};
  const cards = [
    { id:'diligencia', icon:'🔍', nome:'Diligência', desc:'Pede uma investigação extra. O resultado vale para os dois lados.' },
    { id:'pergunta', icon:'➕', nome:'Perguntas extras', desc:'+2 perguntas na instrução.' },
    { id:'tempo', icon:'⏱', nome:'Mais tempo', desc:'+90 segundos na sua fala.' }
  ].filter(k => allowed.includes(k.id));
  return `<div class="cards-row">${cards.map(k => `<button type="button" class="game-card ${c[k.id] > 0 ? '' : 'used'}" data-card="${k.id}" ${c[k.id] > 0 ? '' : 'disabled'} title="${escapeHtml(k.desc)}"><span>${k.icon}</span><b>${k.nome}</b><small>${c[k.id] > 0 ? k.desc : 'já usada'}</small></button>`).join('')}</div>`;
}

function bindCartas(el){
  el.querySelectorAll('.game-card').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.card;
    if(k === 'pergunta') return actions.cartaPergunta();
    if(k === 'tempo') return actions.cartaTempo();
    if(k === 'diligencia'){
      const box = el.querySelector('.dilig-form');
      box.classList.toggle('open');
      box.querySelector('textarea')?.focus();
    }
  }));
  on(el, 'diligencia', () => actions.cartaDiligencia(val(el, 'diligencia')));
}
const diligFormHtml = () => `<div class="dilig-form">${textarea('diligencia', 'O que você quer que seja investigado? Ex.: "perícia no celular do réu", "ouvir o dono da farmácia 24h", "laudo da câmera do corredor"', 2)}${btn('diligencia', '🔍 Requerer diligência', 'btn-secondary')}</div>`;

function panelFor(room){
  const role = me();
  const opp = otherRole(role);
  const oppName = escapeHtml(nameOf(room, opp));

  switch(room.phase){
    case 'acordo': {
      const a = room.acordo || {};
      if(a.status === 'proposta'){
        if(role === 'acusacao') return { key:'acu-proposta', html:`
          <div class="act-title">🤝 Oferecer acordo de não persecução penal?</div>
          <div class="act-hint">Requisitos (Art. 28-A CPP): crime sem violência, pena mínima menor que 4 anos e confissão. Condições comuns: prestação de serviços, reparação do dano, multa.</div>
          ${textarea('acordo', 'Condições do acordo. Ex.: "confissão, reparação integral do dano em 30 dias e 8 meses de prestação de serviços à comunidade"', 3)}
          <div class="btn-row">${btn('propor', '🤝 Propor acordo')}${btn('sem', 'Não oferecer — seguir com a denúncia', 'btn-secondary')}</div>`,
          bind: el => { on(el, 'propor', () => actions.proporAcordo(val(el, 'acordo'))); on(el, 'sem', () => actions.semAcordo()); } };
        return { key:'def-espera-proposta', html: waitHtml(`${oppName} está decidindo se oferece um acordo. Enquanto isso, leia o caso na aba 📋 CASO.`) };
      }
      if(a.status === 'resposta'){
        if(role === 'defesa') return { key:'def-resposta', html:`
          <div class="act-title">🤝 A Acusação ofereceu um acordo</div>
          <div class="offer">"${nl2br(a.termos)}"</div>
          <div class="act-hint">Se aceitar, o réu confessa e cumpre as condições, e o processo acaba aqui (o juiz ainda precisa homologar). Se recusar, vai a julgamento: pode ser absolvido… ou condenado.</div>
          <div class="btn-row">${btn('aceitar', '✅ Aceitar acordo')}${btn('recusar', '❌ Recusar e ir a julgamento', 'btn-secondary')}</div>`,
          bind: el => { on(el, 'aceitar', () => actions.responderAcordo(true)); on(el, 'recusar', () => actions.responderAcordo(false)); } };
        return { key:'acu-espera-resposta', html: waitHtml(`${oppName} está avaliando a sua proposta…`) };
      }
      return { key:'acordo-' + a.status, html: waitHtml('O juiz está analisando o acordo…') };
    }

    case 'denuncia': {
      const p = room.pecas || {};
      if(!p.denuncia){
        if(role === 'acusacao') return { key:'acu-denuncia', html:`
          <div class="act-title">📜 Ofereça a denúncia</div>
          <div class="act-hint">Uma boa denúncia tem: <b>quem</b> fez, <b>o que</b> fez, <b>quando e onde</b>, <b>qual crime</b> (artigo da lei) e o <b>pedido</b> de condenação.</div>
          ${textarea('denuncia', 'O Ministério Público denuncia [nome], porque no dia ... às ..., [o que fez]. A conduta configura o crime do Art. ... do Código Penal, com a qualificadora ... Requer o recebimento da denúncia e a condenação.', 6)}
          <div class="btn-row">${btn('modelo', '📝 Usar modelo', 'btn-secondary')}${btn('enviar', '📜 Oferecer denúncia')}</div>`,
          bind: el => {
            on(el, 'modelo', () => { const ta = el.querySelector('[data-draft="denuncia"]'); if(!ta.value) { ta.value = `O Ministério Público denuncia ${caseOf(room).titulo.replace(/^O |^A /, '')}: no dia dos fatos, o acusado [descreva o que ele fez].\nA conduta se enquadra no ${caseOf(room).arts_rapidos?.[0] || 'Art. ___ do CP'}.\nRequer o recebimento da denúncia, a citação do réu e, ao final, a condenação.`; saveDraft('denuncia', ta.value); autoGrow(ta); } });
            on(el, 'enviar', () => actions.enviarPeca('denuncia', val(el, 'denuncia')));
          } };
        return { key:'def-espera-denuncia', html: waitHtml(`${oppName} está redigindo a denúncia. Aproveite para estudar o caso e o 📖 VADE.`) };
      }
      if(!p.resposta){
        if(role === 'defesa') return { key:'def-resposta', html:`
          <div class="act-title">🛡️ Apresente a resposta à acusação</div>
          <div class="act-hint">Leia a denúncia acima. Aponte: <b>provas fracas</b>, <b>nulidades</b> (algo feito errado na investigação), <b>excludentes</b> (legítima defesa, estado de necessidade…) e o que você vai provar.</div>
          ${textarea('resposta', 'A defesa de [nome] responde à acusação: preliminarmente, ... No mérito, ... Por isso, requer a absolvição.', 6)}
          <div class="btn-row">${btn('enviar', '🛡️ Apresentar resposta')}</div>`,
          bind: el => on(el, 'enviar', () => actions.enviarPeca('resposta', val(el, 'resposta'))) };
        return { key:'acu-espera-resposta', html: waitHtml(`${oppName} está preparando a resposta à acusação…`) };
      }
      return { key:'den-juiz', html: waitHtml('O juiz está analisando as peças…') };
    }

    case 'instrucao': {
      const ins = room.instrucao || {};
      const d = dossieOf(room);
      const feitas = ins.perguntas?.[role] || 0;
      const lim = ins.limite?.[role] || 0;
      const pronto = ins.pronto?.[role] || feitas >= lim;
      const oppDone = ins.pronto?.[opp] || (ins.perguntas?.[opp] || 0) >= (ins.limite?.[opp] || 0);
      const silencio = role === 'defesa' ? `<label class="silencio"><input type="checkbox" data-silencio ${ins.silencio ? 'checked' : ''}> 🤐 Orientar o réu a ficar em silêncio diante das perguntas da Acusação</label>` : '';
      const key = `ins|${feitas}|${lim}|${pronto}|${oppDone}|${ins.silencio}|${JSON.stringify(room.cartas?.[role])}`;
      if(pronto) return { key, html:`${waitHtml(oppDone ? 'Encerrando a instrução…' : `Você encerrou suas perguntas. ${oppName} ainda está perguntando (pode protestar se quiser).`)}${silencio}`,
        bind: el => el.querySelector('[data-silencio]')?.addEventListener('change', e => actions.toggleSilencio(e.target.checked)) };
      return { key, html:`
        <div class="act-title">🎙️ Inquirição — suas perguntas: <b>${feitas}/${lim}</b></div>
        <div class="wit-pick">${d.testemunhas.map(t => {
          const n = autosList(room).filter(a => a.tipo === 'depoimento' && a.testemunhaId === t.id).length;
          return `<button type="button" class="wit-btn" data-wit="${t.id}"><span class="wit-emoji">${t.emoji}</span><b>${escapeHtml(t.nome)}</b><small>${escapeHtml(t.papel_txt)}${n ? ` · ${n} resp.` : ''}</small></button>`;
        }).join('')}</div>
        ${textarea('pergunta', 'Escolha a testemunha acima e faça sua pergunta. Dica: perguntas específicas arrancam segredos; perguntas indutivas ("não é verdade que…?") podem levar protesto.', 2)}
        <div class="btn-row">${btn('perguntar', '🎙️ Perguntar')}${btn('encerrar', 'Encerrar minhas perguntas', 'btn-secondary')}</div>
        ${silencio}
        <div class="act-sub">🃏 Suas cartas</div>${cartasHtml(room, ['diligencia', 'pergunta'])}${diligFormHtml()}`,
        bind: el => {
          let sel = sessionStorage.getItem('wit_sel') || '';
          const mark = () => el.querySelectorAll('.wit-btn').forEach(b => b.classList.toggle('sel', b.dataset.wit === sel));
          el.querySelectorAll('.wit-btn').forEach(b => b.addEventListener('click', () => { sel = b.dataset.wit; sessionStorage.setItem('wit_sel', sel); mark(); el.querySelector('[data-draft="pergunta"]').focus(); }));
          mark();
          on(el, 'perguntar', () => actions.perguntar(sel, val(el, 'pergunta')));
          on(el, 'encerrar', () => confirm('Encerrar suas perguntas? Você não poderá perguntar mais nesta audiência.') && actions.encerrarPerguntas());
          el.querySelector('[data-silencio]')?.addEventListener('change', e => actions.toggleSilencio(e.target.checked));
          bindCartas(el);
        } };
    }

    case 'debates': {
      const d = room.debates || {};
      if(d.turno >= TURNOS.length) return { key:'deb-fim', html: waitHtml('Debates encerrados.') };
      const turno = TURNOS[d.turno];
      const deadline = d.inicio + (turno.seg + (d.extra || 0)) * 1000;
      const juri = room.rito === 'juri';
      const key = `deb|${d.turno}|${d.extra}|${JSON.stringify(room.cartas?.[role])}`;
      if(turno.role !== role) return { key, html:`<div class="act-title">${escapeHtml(turno.titulo)}</div>${waitHtml(`${escapeHtml(nameOf(room, turno.role))} está com a palavra… <b class="clock" data-until="${deadline}"></b>`)}` };
      const primeira = turno.tipo === 'alegacao';
      return { key, html:`
        <div class="act-title">🗣️ ${escapeHtml(turno.titulo)} — <b class="clock" data-until="${deadline}"></b></div>
        <div class="act-hint">${juri ? 'Você fala para os <b>7 jurados</b>: pessoas comuns, que decidem pela emoção e pela clareza. Fale simples, conte uma história, mostre as provas.' : 'Você fala para o juiz: retome as provas e o que as testemunhas disseram, e rebata o adversário.'} Quando o tempo acabar, o que estiver escrito é enviado.</div>
        ${textarea('alegacao_' + d.turno, primeira ? (juri ? 'Senhores jurados, imaginem a cena… as provas mostram que…' : 'Excelência, as provas mostram que…') : 'Rebata o último argumento do adversário…', 6)}
        ${primeira ? `<input class="pedido-inp" data-draft="pedido" maxlength="80" placeholder="${role === 'acusacao' ? 'Seu pedido: ex. "condenação a 4 anos, regime semiaberto"' : 'Seu pedido: ex. "absolvição" ou "pena mínima com substituição"'}">` : ''}
        <div class="btn-row">${btn('enviar', '🗣️ Encerrar minha fala')}${d.turno === 2 ? btn('dispensar', 'Dispensar réplica', 'btn-secondary') : ''}</div>
        ${cartasHtml(room, ['tempo'])}`,
        bind: el => {
          on(el, 'enviar', () => actions.enviarAlegacao(val(el, 'alegacao_' + d.turno), primeira ? val(el, 'pedido') : null));
          on(el, 'dispensar', () => actions.dispensarReplica());
          bindCartas(el);
        } };
    }

    case 'julgamento':
      return { key:'julg', html:`<div class="suspense">${room.rito === 'juri' ? '👥 Os jurados se recolheram à sala secreta para votar…' : '🔨 O juiz se recolheu para redigir a sentença…'}</div>` };

    case 'recurso': {
      const r = room.recurso || {};
      const perdedores = r.perdedor === 'ambos' ? ['acusacao', 'defesa'] : [r.perdedor];
      const souPerdedor = perdedores.includes(role);
      if(r.status === 'decidir'){
        if(souPerdedor && !r.aceitou?.[role]) return { key:'rec-decidir', html:`
          <div class="act-title">🏛️ ${r.perdedor === 'ambos' ? 'A decisão foi parcial. Quer recorrer?' : 'Você perdeu. Quer apelar ao Tribunal?'}</div>
          <div class="sentenca-box">${escapeHtml(room.julgamento?.resumo || '')}</div>
          <div class="act-hint">Três desembargadores vão revisar a decisão: uma garantista, um linha-dura e um técnico. Se ganhar, a decisão muda (e você ganha a conquista "Virada no Tribunal").</div>
          <div class="btn-row">${btn('apelar', '🏛️ Apelar')}${btn('aceitar', 'Aceitar a decisão', 'btn-secondary')}</div>`,
          bind: el => { on(el, 'apelar', () => actions.apelar()); on(el, 'aceitar', () => actions.aceitarDecisao()); } };
        return { key:'rec-espera', html: waitHtml(souPerdedor ? 'Aguardando o outro lado decidir se recorre…' : `${oppName} está decidindo se apela…`) };
      }
      if(r.status === 'razoes'){
        if(r.apelante === role) return { key:'rec-razoes', html:`
          <div class="act-title">🏛️ Razões de apelação</div>
          <div class="act-hint">Mostre aos desembargadores o que o juiz errou: prova mal avaliada, pena exagerada (ou branda demais), nulidade… Seja objetivo.</div>
          ${textarea('razoes', 'Egrégio Tribunal, a sentença merece reforma porque…', 6)}
          <div class="btn-row">${btn('enviar', '📤 Enviar apelação')}</div>`,
          bind: el => on(el, 'enviar', () => actions.enviarRazoes(val(el, 'razoes'))) };
        return { key:'rec-espera-razoes', html: waitHtml(`${escapeHtml(nameOf(room, r.apelante))} está escrevendo a apelação…`) };
      }
      if(r.status === 'contrarrazoes'){
        if(r.apelante !== role) return { key:'rec-contra', html:`
          <div class="act-title">🛡️ Contrarrazões</div>
          <div class="act-hint">O adversário recorreu. Defenda a sentença: mostre por que o juiz acertou.</div>
          ${textarea('contrarrazoes', 'A sentença deve ser mantida porque…', 5)}
          <div class="btn-row">${btn('enviar', '📤 Enviar contrarrazões')}${btn('dispensar', 'Não apresentar', 'btn-secondary')}</div>`,
          bind: el => { on(el, 'enviar', () => actions.enviarContrarrazoes(val(el, 'contrarrazoes'))); on(el, 'dispensar', () => actions.enviarContrarrazoes('', true)); } };
        return { key:'rec-espera-contra', html: waitHtml(`${oppName} está respondendo ao seu recurso…`) };
      }
      return { key:'rec-julgando', html:`<div class="suspense">🏛️ A 1ª Câmara Criminal está reunida…</div>` };
    }

    case 'fim': return finalPanel(room);
  }
  return { key:'?', html:'' };
}

let careerSaved = false;
function finalPanel(room){
  const s = room.score || {};
  const role = me();
  const res = computeResult(room, role);
  const vencedor = room.final?.vencedor;
  const placarWin = s.acusacao === s.defesa ? null : (s.acusacao > s.defesa ? 'acusacao' : 'defesa');
  const titulo = placarWin === role ? '🏆 VOCÊ VENCEU!' : placarWin ? `${ROLE_ICON[placarWin]} ${escapeHtml(nameOf(room, placarWin))} venceu` : '🤝 EMPATE';
  const nextIdx = (room.caseIdx + 1) % G.cases.length || 1;
  return { key:'fim', html:`
    <div class="final-card">
      <div class="final-title">${titulo}</div>
      <div class="final-score"><div class="fs acusacao"><small>${escapeHtml(nameOf(room, 'acusacao'))}</small><b>${s.acusacao || 0}</b><span>⚔️ Acusação</span></div><div class="fs-x">×</div><div class="fs defesa"><small>${escapeHtml(nameOf(room, 'defesa'))}</small><b>${s.defesa || 0}</b><span>🛡️ Defesa</span></div></div>
      <div class="final-proc">⚖️ <b>Resultado do processo:</b> ${escapeHtml(room.final?.texto || '')} ${room.final?.bonus ? `<br>A causa foi ganha pela <b>${ROLE_LABEL[vencedor]}</b> (+5 pontos).` : vencedor === 'empate' ? '<br>Resultado dividido: ninguém levou a causa por inteiro.' : ''}</div>
      <div class="act-sub">Suas conquistas</div>
      <div class="ach-row">${res.conquistas.length ? res.conquistas.map(c => `<div class="ach"><span>${c.emoji}</span><b>${c.nome}</b><small>${c.desc}</small></div>`).join('') : '<div class="act-hint">Nenhuma desta vez. Na próxima!</div>'}</div>
      <div class="xp-gain">+${res.xp} XP</div>
      <div id="final-career"></div>
      <div class="act-sub">Próxima rodada (os papéis se invertem)</div>
      <select class="case-select" data-next>${G.cases.map((c, i) => `<option value="${i}" ${i === nextIdx ? 'selected' : ''}>${c.id} · ${escapeHtml(c.nome)}</option>`).join('')}</select>
      <div class="btn-row">${btn('novo', '▶ Próximo caso')}</div>
    </div>`,
    bind: el => {
      playSound(placarWin === role ? 'win' : 'gavel');
      on(el, 'novo', () => confirm('Começar o próximo caso? Vocês trocam de papel.') && actions.novoCaso(Number(el.querySelector('[data-next]').value)));
      if(!careerSaved && !isAI(room, role)){
        careerSaved = true;
        saveCareer(G.db, G.me.name, { ...room, code: G.code }, role, res).then(c => { if(c) $('final-career').innerHTML = careerCardHtml(c); }).catch(e => console.warn('carreira', e));
      }
    } };
}

// Atualiza relógios e reavalia o painel (janela de protesto, prazos)
export function tick(){
  const room = G.room; if(!room) return;
  document.querySelectorAll('[data-until]').forEach(el => {
    const left = Number(el.dataset.until) - now();
    el.textContent = fmtClock(left);
    el.classList.toggle('urgent', left < 20000);
  });
  renderPending(room);
  renderBusy(room);
  autopilot();
}

// Contexto extra para o assistente privado
export function assistContext(){
  const room = G.room;
  const d = dossieOf(room);
  const nivel = nivelOf(room, me());
  const usados = room.assistUses?.[me()] || 0;
  return {
    extra: { ...aiContext(room), fase: FASES[room.phase]?.nome, nivel, segredos: me() === 'acusacao' ? d.segredo_acu : d.segredo_def },
    limite: ASSIST_LIMITE[nivel], usados,
    caseObj: caseOf(room)
  };
}
export async function countAssistUse(){ await G.roomRef.child(`assistUses/${me()}`).transaction(v => (v || 0) + 1); }
