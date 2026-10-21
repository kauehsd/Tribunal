// main.js — orquestra o app: salas no Firebase, debate em tempo real e chamadas ao Juiz IA
import { askJudge, askVerdict, askAssistant } from './ai-bridge.js';

function $(id){ return document.getElementById(id); }

const SESSION_KEY = 'tribunal_session';
const IN_GAME_KEY = 'tribunal_in_game';
const JUDGE_EVERY_N_MESSAGES = 4;
const JUDGE_LOCK_MS = 70000;   // se um cliente travar no meio, o outro pode chamar o juiz depois disso
const TURN_SECONDS = 90;

const MODERATION_BLOCKLIST = ['merda','porra','filho da puta','puta','viado','otário','idiota','burro','escroto','imbecil','piranha','moleque'];

const state = { roomCode:'', myRole:'', myName:'', partnerName:'', partnerRole:'', caseIdx:0, solo:false, createRole:'', round:0 };
window.state = state;

let db = null;
let roomRef = null;
let waitingHandler = null;
let replyTo = null;          // pergunta do juiz que estou respondendo
let iaHistory = [];          // conversa privada com o assistente (para dar contexto à IA)
let currentCalcCase = null;
const selectedCalcAgg = new Set();
const selectedCalcMaj = new Set();

// ══════════════════════════════════════════════════════
// UTILITÁRIOS
// ══════════════════════════════════════════════════════
function escapeHtml(s){ return String(s ?? '').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

function moderateText(text){
  const normalized = (text||'').toLowerCase();
  const found = MODERATION_BLOCKLIST.find(w => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'iu').test(normalized));
  return { blocked: Boolean(found), word: found };
}

let toastTimer = null;
function showToast(msg, duration=3000){
  const t = $('sync-toast');
  if(!t){ console.info(msg); return; }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), duration);
}

function caseObj(){ return (window.CASES && window.CASES[state.caseIdx]) || { titulo:'Caso genérico', context_juiz:'' }; }
function sideKey(role){ return role === 'acusacao' ? 'acu' : 'def'; }
function roleLabel(role){ return role === 'acusacao' ? 'Acusação' : 'Defesa'; }
function otherRole(role){ return role === 'acusacao' ? 'defesa' : 'acusacao'; }

// A sessão fica no localStorage (para o botão "Voltar para a sala") e também no
// sessionStorage, que é por aba: ao recarregar, cada aba volta como quem era.
function saveSession(){
  const s = JSON.stringify({ roomCode:state.roomCode, myName:state.myName, myRole:state.myRole });
  try{ localStorage.setItem(SESSION_KEY, s); sessionStorage.setItem(SESSION_KEY, s); }catch(e){}
}
function loadSession(){
  try{ return JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || 'null'); }catch(e){ return null; }
}
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); }catch(e){} }

function newRoomCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I para não confundir
  return Array.from({length:4}, ()=>chars[Math.floor(Math.random()*chars.length)]).join('');
}

function initFirebase(){
  try{
    if(db) return true;
    if(!window.firebase) throw new Error('Firebase SDK não carregado');
    if(!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
    db = firebase.database();
    return true;
  }catch(e){ console.error('initFirebase', e); return false; }
}

async function recentMessages(){
  if(!roomRef) return [];
  const snap = await roomRef.child('chat').limitToLast(40).once('value');
  return Object.values(snap.val() || {}).map(m=>({ sender:m.sender, role:m.role, text:m.text }));
}

// ══════════════════════════════════════════════════════
// LOBBY
// ══════════════════════════════════════════════════════
function initUI(){
  $('btn-send')?.addEventListener('click', sendMessage);
  $('btn-judge')?.addEventListener('click', ()=>requestJudge({ manual:true }));
  $('ia-send-btn')?.addEventListener('click', sendIaMsg);
  const iaInp = $('ia-inp');
  if(iaInp){ iaInp.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendIaMsg(); } }); iaInp.addEventListener('input', ()=>autoGrow(iaInp)); }
  const chatInp = $('chat-inp');
  if(chatInp){ chatInp.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); } }); chatInp.addEventListener('input', ()=>autoGrow(chatInp)); }
  $('inp-room-code')?.addEventListener('input', e=>{ e.target.value = e.target.value.toUpperCase(); });

  document.querySelectorAll('.notas-tab').forEach((b,i)=>b.addEventListener('click', ()=>showNotasTab(i===0 ? 'pad' : 'ia')));
  $('notas-ta')?.addEventListener('input', onNotasInput);
  document.querySelector('.notas-clear')?.addEventListener('click', clearNotas);
  document.querySelector('.reply-banner-close')?.addEventListener('click', clearReply);

  // clique numa pergunta do juiz dentro do chat → responder
  $('chat-messages')?.addEventListener('click', e=>{
    const q = e.target.closest('.judge-q');
    if(q && q.dataset.role === state.myRole) startReply(q.dataset.question);
  });

  const scroll = $('case-scroll');
  if(scroll && window.CASES){
    scroll.innerHTML = window.CASES.map((c,i)=>`<div class="case-chip ${i===state.caseIdx?'active':''}" data-idx="${i}">${escapeHtml(c.id)} · ${escapeHtml(c.nome)}</div>`).join('');
    scroll.querySelectorAll('.case-chip').forEach(el=>el.addEventListener('click', ()=>selectCase(Number(el.dataset.idx))));
  }

  renderResumeCard();
  // a página recarregou no meio da partida (celular, "novo caso"): volta direto pra sala
  if(sessionStorage.getItem(IN_GAME_KEY) && loadSession()) resumeSession();
}

function renderResumeCard(){
  const card = $('card-resume');
  const session = loadSession();
  if(!card) return;
  if(!session?.roomCode){ card.style.display = 'none'; return; }
  card.style.display = 'block';
  $('resume-text').textContent = `Sala ${session.roomCode} · ${session.myName} (${roleLabel(session.myRole)})`;
}

function selectCase(i){
  state.caseIdx = i;
  document.querySelectorAll('.case-chip').forEach((el,j)=>el.classList.toggle('active', j===i));
}

function selectRole(r){
  state.createRole = r;
  $('rc-acu')?.classList.toggle('sel', r==='acusacao');
  $('rc-def')?.classList.toggle('sel', r==='defesa');
}

async function createRoom(){
  if(!initFirebase()){ showToast('Erro ao conectar ao servidor do jogo'); return; }
  const name = $('inp-name-create').value.trim();
  if(!name){ showToast('Digite seu nome'); return; }
  if(!state.createRole){ showToast('Escolha seu papel'); return; }
  const btn = $('btn-create'); btn.disabled = true; btn.textContent = 'CRIANDO...';
  try{
    let code = newRoomCode();
    for(let tries=0; tries<5 && (await db.ref(`rooms/${code}`).once('value')).exists(); tries++) code = newRoomCode();
    state.myName = name; state.myRole = state.createRole; state.roomCode = code;
    roomRef = db.ref(`rooms/${code}`);
    await roomRef.set({ creator:name, creatorRole:state.myRole, caseIdx:state.caseIdx, scoreAcu:0, scoreDef:0, round:0, createdAt:firebase.database.ServerValue.TIMESTAMP });
    saveSession();
    showWaiting();
  }catch(e){ showToast('Erro: ' + e.message); }
  finally{ btn.disabled = false; btn.textContent = 'CRIAR SALA'; }
}

async function joinRoom(){
  if(!initFirebase()){ showToast('Erro ao conectar ao servidor do jogo'); return; }
  const name = $('inp-name-join').value.trim();
  const code = $('inp-room-code').value.trim().toUpperCase();
  if(!name){ showToast('Digite seu nome'); return; }
  if(code.length !== 4){ showToast('O código tem 4 caracteres'); return; }
  const btn = $('btn-join'); btn.disabled = true; btn.textContent = 'ENTRANDO...';
  try{
    const ref = db.ref(`rooms/${code}`);
    const room = (await ref.once('value')).val();
    if(!room){ showToast('Sala não encontrada'); return; }
    // quem já está na sala com esse nome pode voltar (ex.: recarregou a página)
    if(room.creator === name){ await enterRoom(code, name, room.creatorRole); return; }
    if(room.partnerName && room.partnerName !== name){ showToast('Essa sala já tem dois jogadores'); return; }
    const role = otherRole(room.creatorRole); // o papel que sobrou
    await ref.update({ partnerName:name, partnerRole:role });
    await enterRoom(code, name, role);
  }catch(e){ showToast('Erro: ' + e.message); }
  finally{ btn.disabled = false; btn.textContent = 'ENTRAR NA SALA'; }
}

async function resumeSession(){
  const session = loadSession();
  if(!session) return;
  if(!initFirebase()){ showToast('Erro ao conectar ao servidor do jogo'); return; }
  const room = (await db.ref(`rooms/${session.roomCode}`).once('value')).val();
  if(!room){ clearSession(); renderResumeCard(); showToast('Essa sala não existe mais'); return; }
  await enterRoom(session.roomCode, session.myName, session.myRole);
}

function forgetSession(){ clearSession(); renderResumeCard(); }

// Entra numa sala existente (criador voltando, parceiro entrando ou retomando)
async function enterRoom(code, name, role){
  state.roomCode = code; state.myName = name; state.myRole = role;
  roomRef = db.ref(`rooms/${code}`);
  const room = (await roomRef.once('value')).val() || {};
  state.caseIdx = room.caseIdx || 0;
  state.round = room.round || 0;
  state.solo = Boolean(room.solo);
  const iAmCreator = room.creator === name && room.creatorRole === role;
  state.partnerName = iAmCreator ? (room.partnerName || '') : room.creator;
  state.partnerRole = otherRole(role);
  saveSession();
  if(iAmCreator && !room.partnerName && !room.solo) showWaiting();
  else launchGame();
}

function showWaiting(){
  $('card-create').style.display = 'none';
  $('card-join').style.display = 'none';
  $('card-resume').style.display = 'none';
  document.querySelectorAll('.divider').forEach(el=>el.style.display='none');
  const cw = $('card-waiting'); cw.style.display = 'flex'; cw.style.flexDirection = 'column'; cw.style.alignItems = 'center';
  $('waiting-code').textContent = state.roomCode;
  updateWaitingUI();
  waitingHandler = roomRef.on('value', snap=>{
    const room = snap.val();
    if(room?.partnerName){
      state.partnerName = room.partnerName;
      state.partnerRole = room.partnerRole;
      updateWaitingUI();
      roomRef.off('value', waitingHandler); waitingHandler = null;
      setTimeout(launchGame, 400);
    }
  });
}

function updateWaitingUI(){
  const label = r => r==='acusacao' ? '⚔️ ACUSAÇÃO' : '🛡️ DEFESA';
  $('players-list').innerHTML = `
    <div class="player-item"><div class="pi-dot ${state.myRole}"></div><div class="pi-name">${escapeHtml(state.myName)} (você)</div><div class="pi-role">${label(state.myRole)}</div></div>
    <div class="player-item"><div class="pi-dot ${state.partnerName?state.partnerRole:'empty'}"></div><div class="pi-name">${escapeHtml(state.partnerName||'Aguardando...')}</div><div class="pi-role">${state.partnerName?label(state.partnerRole):'...'}</div></div>`;
}

async function copyRoomCode(){
  const text = `Bora jogar Tribunal do Casal? ⚖️ Código da sala: ${state.roomCode}\n${location.origin}${location.pathname}`;
  try{ await navigator.clipboard.writeText(text); showToast('Convite copiado!'); }
  catch(e){ showToast(`Código: ${state.roomCode}`); }
}

async function startAnySolo(){
  if(waitingHandler){ roomRef.off('value', waitingHandler); waitingHandler = null; }
  state.solo = true;
  state.partnerName = '';
  state.partnerRole = otherRole(state.myRole);
  if(roomRef) await roomRef.update({ solo:true });
  launchGame();
}

function backToLobby(){
  if(!confirm('Sair da sala? Você pode voltar depois pelo botão "Voltar para a sala".')) return;
  sessionStorage.removeItem(IN_GAME_KEY);
  location.reload(); // limpa todos os listeners de uma vez; a sessão fica salva
}

// ══════════════════════════════════════════════════════
// JOGO — tempo real
// ══════════════════════════════════════════════════════
function launchGame(){
  sessionStorage.setItem(IN_GAME_KEY, '1');
  $('s-lobby').classList.remove('active');
  $('s-game').classList.add('active');
  const c = caseObj();
  renderCaseDetails(c);
  showTab('caso');
  showNotasTab('pad');
  loadNotas();
  renderVerdict(null);
  $('gtb-title').textContent = `Sala ${state.roomCode} • ${c.nome || ''}`;
  $('gtb-role-txt').textContent = state.myRole === 'acusacao' ? 'ACUSAÇÃO' : 'DEFESA';
  const badge = $('gtb-badge'); if(badge) badge.className = `gtb-badge ${state.myRole}`;
  updateScoreLabels();
  lockOpponentPedido();
  setupRealtimeListeners();
  startTurnTimer();
}

function setupRealtimeListeners(){
  if(!roomRef) return;

  roomRef.child('chat').on('child_added', snap=>{
    const msg = snap.val(); if(!msg) return;
    appendChatMessage(msg, snap.key);
    if(msg.type !== 'judge') resetTurnTimer();
  });

  roomRef.child('scoreAcu').on('value', s=>{ $('sc-acu').textContent = s.val() ?? 0; });
  roomRef.child('scoreDef').on('value', s=>{ $('sc-def').textContent = s.val() ?? 0; });

  roomRef.child('judge_busy').on('value', s=>{
    const busy = s.val() && Date.now() - s.val() < JUDGE_LOCK_MS;
    $('typing-who').textContent = 'O Juiz';
    $('typing-ind').classList.toggle('show', Boolean(busy));
    $('btn-judge').disabled = Boolean(busy);
  });

  // assistente: canal privado do meu papel (o adversário não vê na tela)
  roomRef.child(`ia_chat_${state.myRole}`).on('child_added', snap=>{
    const msg = snap.val(); if(!msg) return;
    iaHistory.push(msg);
    appendIaMessage(msg);
  });

  roomRef.child('verdict').on('value', s=>{
    const v = s.val();
    renderVerdict(v);
    const onTab = document.querySelector('.btab[data-tab="veredito"]')?.classList.contains('active');
    if(v && !onTab) $('veredito-notif').classList.add('show');
  });
  roomRef.child('recursos').on('value', s=>{ recursosState = s.val() || {}; renderRecursoStatus(); });

  roomRef.child('pedidos').on('value', s=>{
    const pedidos = s.val() || {};
    if(state.myRole !== 'acusacao') $('pena-acu').value = pedidos.acu || '';
    if(state.myRole !== 'defesa') $('pena-def').value = pedidos.def || '';
    $('pedido-acu-txt').textContent = pedidos.acu || 'Aguardando...';
    $('pedido-def-txt').textContent = pedidos.def || 'Aguardando...';
    const both = Boolean(pedidos.acu && pedidos.def);
    $('pedido-notif').classList.toggle('show', both);
    $('pedido-sync-status').innerHTML = both
      ? '<span class="pedido-sync-dot"></span>Ambos os pedidos registrados — vá para ⚖️ VEREDITO'
      : 'Aguardando o outro lado preencher...';
  });

  // "novo caso": o outro jogador iniciou uma nova rodada → recarrega para limpar tudo
  roomRef.child('round').on('value', s=>{ if((s.val() || 0) !== state.round) location.reload(); });

  // presença: avisa quando o parceiro entra/sai
  const me = roomRef.child(`presence/${state.myRole}`);
  me.set({ name:state.myName, online:true });
  me.onDisconnect().set({ name:state.myName, online:false });
  let firstPresence = true;
  roomRef.child(`presence/${state.partnerRole}`).on('value', s=>{
    const p = s.val();
    const online = Boolean(p?.online);
    if(p?.name && !state.partnerName){ state.partnerName = p.name; updateScoreLabels(); }
    $('gtb-badge')?.classList.toggle('partner-off', !online && !state.solo);
    if(!firstPresence && p?.name && !state.solo) showToast(online ? `${p.name} entrou na sala` : `${p.name} saiu da sala`);
    firstPresence = false;
  });
}

// ══════════════════════════════════════════════════════
// CHAT DO DEBATE
// ══════════════════════════════════════════════════════
const renderedMsgIds = new Set();

function appendChatMessage(msg, key){
  const container = $('chat-messages'); if(!container) return;
  const msgId = key || `${msg.ts}-${msg.sender}`;
  if(renderedMsgIds.has(msgId)) return;
  renderedMsgIds.add(msgId);

  const isJudge = msg.type === 'judge';
  const el = document.createElement('div');
  el.className = 'msg ' + (isJudge ? 'judge' : (msg.role === state.myRole ? 'mine' : 'theirs'));
  if(!isJudge) el.classList.add(msg.role === 'acusacao' ? 'acusacao' : 'defesa');
  const time = new Date(msg.ts || Date.now()).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });

  let body = escapeHtml(msg.text || '').replace(/\n/g, '<br>');
  if(msg.reply_to) body = `<div class="msg-reply">↩️ ${escapeHtml(msg.reply_to)}</div>` + body;
  if(isJudge){
    const qs = [['acusacao', msg.perguntas_acu], ['defesa', msg.perguntas_def]]
      .flatMap(([role, list]) => (list || []).map(q => {
        const mine = role === state.myRole;
        return `<button type="button" class="judge-q ${role} ${mine?'mine':''}" data-role="${role}" data-question="${escapeHtml(q)}" ${mine?'':'tabindex="-1"'}>
          <span class="judge-q-who">${role==='acusacao'?'⚔️ Acusação':'🛡️ Defesa'}${mine?' · toque para responder':''}</span>${escapeHtml(q)}</button>`;
      })).join('');
    if(qs) body += `<div class="judge-qs">${qs}</div>`;
    const provider = msg.provider ? `<span class="msg-provider">⚡ ${escapeHtml(msg.provider)}</span>` : '';
    el.innerHTML = `<div class="msg-header"><span class="msg-role juiz">⚖️ Juiz${provider}</span><span class="msg-time">${time}</span></div><div class="msg-bubble">${body}</div>`;
  } else {
    el.innerHTML = `<div class="msg-header"><span class="msg-role ${msg.role}">${escapeHtml(msg.sender || '')}</span><span class="msg-time">${time}</span></div><div class="msg-bubble">${body}</div>`;
  }
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;

  const chatTabActive = document.querySelector('.btab[data-tab="chat"]')?.classList.contains('active');
  if(isJudge) playSound('judge');
  else if(msg.role !== state.myRole) playSound('message');
  if(!chatTabActive && msg.role !== state.myRole) $('chat-notif')?.classList.add('show');
}

async function sendMessage(){
  const ta = $('chat-inp'); if(!ta || !roomRef) return;
  const text = ta.value.trim(); if(!text) return;
  const moderation = moderateText(text);
  if(moderation.blocked){ showToast(`⚠️ Calma, doutor(a)! Palavra não permitida: ${moderation.word}`); return; }
  ta.value = ''; autoGrow(ta);

  const msg = { sender:state.myName, role:state.myRole, text, ts:Date.now(), type:'chat' };
  if(replyTo) msg.reply_to = replyTo;
  const answeredQuestion = Boolean(replyTo);
  clearReply();
  await roomRef.child('chat').push(msg);

  // o juiz entra quando é chamado pelo nome, a cada N mensagens, ou quando respondem às perguntas dele
  const tx = await roomRef.child('msgsSinceJudge').transaction(v => (v || 0) + 1);
  const count = tx.snapshot.val() || 0;
  const mentioned = /(^|\s|@)ju[ií]z(a)?\b/i.test(text);
  if(mentioned || count >= JUDGE_EVERY_N_MESSAGES || (answeredQuestion && count >= 2)) requestJudge();
}

function startReply(question){
  replyTo = question;
  $('reply-banner').classList.add('show');
  $('reply-banner-text').textContent = `Respondendo ao juiz: ${question}`;
  showTab('chat');
  $('chat-inp').focus();
}

function clearReply(){
  replyTo = null;
  $('reply-banner')?.classList.remove('show');
  if($('reply-banner-text')) $('reply-banner-text').textContent = '';
}

// Botões de artigo acima do chat: inserem a referência no texto em vez de enviar
function insertArticle(ref){
  const ta = $('chat-inp'); if(!ta) return;
  const pos = ta.selectionStart ?? ta.value.length;
  const before = ta.value.slice(0, pos);
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  ta.value = before + sep + ref + ' ' + ta.value.slice(pos);
  ta.focus();
  autoGrow(ta);
}

function autoGrow(ta){ ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; }

// ══════════════════════════════════════════════════════
// JUIZ
// ══════════════════════════════════════════════════════

// Garante que só um dos dois celulares chame a IA por vez.
async function acquireJudgeLock(){
  const tx = await roomRef.child('judge_busy').transaction(v => (v && Date.now() - v < JUDGE_LOCK_MS) ? undefined : Date.now());
  return tx.committed;
}
function releaseJudgeLock(){ return roomRef.child('judge_busy').remove(); }

async function setScore(placar){
  if(!placar) return;
  await roomRef.update({ scoreAcu:placar.acusacao, scoreDef:placar.defesa });
}

async function requestJudge({ manual=false } = {}){
  if(!roomRef) return;
  if(!await acquireJudgeLock()){ if(manual) showToast('O juiz já está analisando...'); return; }
  try{
    const msgs = await recentMessages();
    if(!msgs.some(m => m.role === 'acusacao' || m.role === 'defesa')){
      if(manual) showToast('Comecem o debate primeiro — o juiz precisa de argumentos!');
      return;
    }
    const pedidos = (await roomRef.child('pedidos').once('value')).val() || {};
    const r = await askJudge(caseObj(), msgs, { pedidos });
    await roomRef.child('chat').push({
      sender:'Juiz', role:'juiz', type:'judge', ts:Date.now(), text:r.text, provider:r.provider || 'local',
      perguntas_acu:r.perguntas_acu || [], perguntas_def:r.perguntas_def || []
    });
    await setScore(r.placar);
    await roomRef.child('msgsSinceJudge').set(0);
  }catch(e){
    console.error('requestJudge', e);
    showToast('Falha ao consultar o juiz. Tente de novo no ⚖️');
  }finally{
    await releaseJudgeLock();
  }
}

// ══════════════════════════════════════════════════════
// VEREDITO E RECURSO
// ══════════════════════════════════════════════════════
let recursosState = {};
let currentVerdict = null;

async function requestVerdict(){
  if(!roomRef) return;
  if(!await acquireJudgeLock()){ showToast('O juiz já está analisando...'); return; }
  const btn = $('btn-verdict'); if(btn){ btn.disabled = true; btn.textContent = '⚖️ O juiz está deliberando...'; }
  try{
    const msgs = await recentMessages();
    const pedidos = (await roomRef.child('pedidos').once('value')).val() || {};
    const r = await askVerdict(caseObj(), msgs, { pedidos });
    await roomRef.child('recursos').remove();
    await roomRef.child('verdict').set({ text:r.text, decisao:r.decisao || '', placar:r.placar || null, provider:r.provider || 'local', final:false, ts:Date.now() });
    await setScore(r.placar);
    await roomRef.child('chat').push({ sender:'Juiz', role:'juiz', type:'judge', ts:Date.now(), text:`⚖️ VEREDITO:\n${r.text}`, provider:r.provider || 'local' });
  }catch(e){
    console.error('requestVerdict', e);
    showToast('Falha ao pedir o veredito. Tente novamente.');
    if(btn){ btn.disabled = false; btn.textContent = '⚖️ Pedir Veredito'; }
  }finally{
    await releaseJudgeLock();
  }
}

async function submitRecurso(){
  const texto = $('recurso-inp')?.value.trim();
  if(!texto){ showToast('Escreva seu argumento de recurso antes de enviar.'); return; }
  await roomRef.child(`recursos/${sideKey(state.myRole)}`).set({ texto, ts:Date.now() });
  const recursos = (await roomRef.child('recursos').once('value')).val() || {};
  if((recursos.acu && recursos.def) || state.solo) await julgaRecurso(recursos);
  else showToast('Recurso enviado! Aguardando o outro lado (ou ele pode desistir).');
}

// O outro lado pode abrir mão do recurso para o juiz decidir logo.
async function waiveRecurso(){
  await roomRef.child(`recursos/${sideKey(state.myRole)}`).set({ texto:'(abriu mão do recurso)', ts:Date.now() });
  const recursos = (await roomRef.child('recursos').once('value')).val() || {};
  if(recursos.acu && recursos.def) await julgaRecurso(recursos);
}

async function julgaRecurso(recursos){
  if(!await acquireJudgeLock()) return;
  try{
    const msgs = await recentMessages();
    const pedidos = (await roomRef.child('pedidos').once('value')).val() || {};
    const r = await askVerdict(caseObj(), msgs, { pedidos, recursos:{ acu:recursos.acu?.texto || '', def:recursos.def?.texto || '' } });
    await roomRef.child('verdict').set({ text:r.text, decisao:r.decisao || '', placar:r.placar || null, provider:r.provider || 'local', final:true, ts:Date.now() });
    await setScore(r.placar);
    await roomRef.child('chat').push({ sender:'Juiz', role:'juiz', type:'judge', ts:Date.now(), text:`🔨 VEREDITO FINAL:\n${r.text}`, provider:r.provider || 'local' });
  }catch(e){
    console.error('julgaRecurso', e);
    showToast('Falha ao processar o recurso. Tente novamente.');
  }finally{
    await releaseJudgeLock();
  }
}

// Começa outro caso na mesma sala (os dois jogadores continuam)
async function newCase(){
  if(!confirm('Começar um novo caso? O debate atual será apagado.')) return;
  const next = (state.caseIdx + 1) % (window.CASES?.length || 1);
  await roomRef.update({
    caseIdx:next, round:(state.round || 0) + 1, scoreAcu:0, scoreDef:0,
    chat:null, verdict:null, recursos:null, pedidos:null, msgsSinceJudge:null, judge_busy:null,
    ia_chat_acusacao:null, ia_chat_defesa:null
  });
  // o listener de 'round' recarrega a página nos dois aparelhos
}

function renderVerdict(v){
  currentVerdict = v;
  const wrap = $('verdict-wrap'); if(!wrap) return;
  if(!v || !v.text){
    wrap.innerHTML = `<div class="verdict-card"><div class="verdict-stamp"><div class="vs-icon">⚖️</div><div><div class="vs-label">Juiz IA</div><div class="vs-name">Aguardando veredito</div></div></div>
      <div class="verdict-fund">Quando o debate estiver maduro (e os pedidos de pena preenchidos na aba <strong>PEDIDO</strong>), peça o veredito. Depois, cada lado ainda pode recorrer uma vez.</div>
      <div style="margin-top:16px;text-align:center;"><button class="btn-primary" id="btn-verdict" style="max-width:280px;margin:0 auto;" onclick="requestVerdict()">⚖️ Pedir Veredito</button></div></div>`;
    return;
  }
  const score = v.placar ? `<div class="verdict-score"><span class="acu">⚔️ ${v.placar.acusacao}</span><span class="vs">×</span><span class="def">${v.placar.defesa} 🛡️</span></div>` : '';
  const after = v.final
    ? `<div style="margin-top:18px;text-align:center;"><button class="btn-primary" onclick="newCase()" style="max-width:260px;margin:0 auto;">▶ Próximo caso</button></div>`
    : `<div class="recurso-box">
        <div class="section-lbl">// recurso — seu argumento final</div>
        <div id="recurso-status" class="recurso-status"></div>
        <div id="recurso-form">
          <textarea id="recurso-inp" class="recurso-inp" placeholder="Por que o veredito deve ser revisto?"></textarea>
          <button class="btn-primary" onclick="submitRecurso()" style="max-width:100%;">⚖️ Interpor Recurso</button>
          <button class="btn-secondary" onclick="waiveRecurso()" style="max-width:100%;margin-top:6px;">Aceito o veredito</button>
        </div>
      </div>`;
  wrap.innerHTML = `<div class="verdict-card"><div class="verdict-stamp"><div class="vs-icon">${v.final?'🔨':'⚖️'}</div><div><div class="vs-label">Juiz IA${v.provider?` · ${escapeHtml(v.provider)}`:''}</div><div class="vs-name">${v.final?'Veredito Final':'Veredito'}</div></div></div>
    ${score}<div class="verdict-fund">${escapeHtml(v.text).replace(/\n/g,'<br>')}</div>${after}</div>`;
  renderRecursoStatus();
}

function renderRecursoStatus(){
  const status = $('recurso-status'); if(!status) return;
  const mine = recursosState[sideKey(state.myRole)];
  const theirs = recursosState[sideKey(state.partnerRole)];
  const parts = [];
  if(mine) parts.push('✓ Seu recurso foi registrado.');
  if(theirs && !state.solo) parts.push(`✓ ${roleLabel(state.partnerRole)} já se manifestou.`);
  if(mine && !theirs && !state.solo) parts.push('Aguardando o outro lado...');
  status.textContent = parts.join(' ');
  const form = $('recurso-form'); if(form) form.style.display = mine ? 'none' : 'block';
}

// ══════════════════════════════════════════════════════
// PLACAR E PEDIDOS
// ══════════════════════════════════════════════════════
function updateScoreLabels(){
  const acuName = state.myRole === 'acusacao' ? state.myName : state.partnerName;
  const defName = state.myRole === 'defesa' ? state.myName : state.partnerName;
  if(acuName) $('sc-acu-label').textContent = `⚔️ ${acuName}`;
  if(defName) $('sc-def-label').textContent = `🛡️ ${defName}`;
}

function lockOpponentPedido(){
  const opp = state.myRole === 'acusacao' ? $('pena-def') : $('pena-acu');
  if(!opp) return;
  opp.readOnly = true; opp.style.opacity = '0.45'; opp.style.cursor = 'not-allowed';
  opp.placeholder = `Aguardando ${roleLabel(state.partnerRole).toLowerCase()}...`;
}

let pedidoTimer = null;
function onPedidoInput(side){
  if(side !== sideKey(state.myRole)) return;
  const txt = (side === 'acu' ? $('pena-acu') : $('pena-def')).value.trim();
  clearTimeout(pedidoTimer);
  pedidoTimer = setTimeout(()=>roomRef?.child('pedidos').update({ [side]: txt }), 400);
}

// ══════════════════════════════════════════════════════
// ASSISTENTE IA (privado)
// ══════════════════════════════════════════════════════
let iaSending = false;
async function sendIaMsg(){
  if(iaSending || !roomRef) return;
  const ta = $('ia-inp'); const text = ta?.value.trim(); if(!text) return;
  iaSending = true;
  const btn = $('ia-send-btn'); btn.disabled = true; btn.textContent = '...';
  const channel = roomRef.child(`ia_chat_${state.myRole}`);
  try{
    ta.value = ''; autoGrow(ta);
    const history = iaHistory.slice(-8);
    await channel.push({ sender:state.myName, text, ts:Date.now(), type:'user' });
    const msgs = await recentMessages();
    const r = await askAssistant(caseObj(), msgs, { role:state.myRole, question:text, history });
    await channel.push({ sender:'Assistente', text:r.text, ts:Date.now(), type:'ai', provider:r.provider || 'local' });
  }catch(e){
    console.warn('assistente', e);
    showToast('Falha ao consultar o assistente. Tente novamente.');
  }finally{
    iaSending = false; btn.disabled = false; btn.textContent = 'ENVIAR';
  }
}

function iaQuickAsk(q){ const ta = $('ia-inp'); if(!ta) return; ta.value = q; sendIaMsg(); }

function appendIaMessage(msg){
  const container = $('ia-chat-msgs'); if(!container) return;
  const el = document.createElement('div');
  el.className = `ia-msg ${msg.type === 'ai' ? 'ai' : 'user'}`;
  el.innerHTML = `<div class="ia-msg-sender">${escapeHtml(msg.sender)}</div><div class="ia-msg-bubble">${escapeHtml(msg.text).replace(/\n/g,'<br>')}</div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

// ══════════════════════════════════════════════════════
// NOTAS (privadas: ficam só neste aparelho)
// ══════════════════════════════════════════════════════
function notasKey(){ return `tribunal_notas_${state.roomCode}_${state.myRole}_${state.round}`; }
function loadNotas(){ const ta = $('notas-ta'); if(!ta) return; try{ ta.value = localStorage.getItem(notasKey()) || ''; }catch(e){} updateNotasCount(); }
let notasSavedTimer = null;
function onNotasInput(){
  const ta = $('notas-ta'); if(!ta) return;
  try{ localStorage.setItem(notasKey(), ta.value); }catch(e){}
  updateNotasCount();
  const saved = $('notas-saved'); saved?.classList.add('show');
  clearTimeout(notasSavedTimer); notasSavedTimer = setTimeout(()=>saved?.classList.remove('show'), 1200);
}
function clearNotas(){ const ta = $('notas-ta'); if(!ta || !confirm('Apagar suas anotações?')) return; ta.value = ''; onNotasInput(); }
function updateNotasCount(){ const ta = $('notas-ta'); const label = $('notas-chars'); if(ta && label) label.textContent = `${ta.value.length} caracteres`; }

// ══════════════════════════════════════════════════════
// CRONÔMETRO DE ARGUMENTO
// Reinicia a cada mensagem de qualquer jogador; ao zerar, cobra quem está devendo.
// ══════════════════════════════════════════════════════
let timerLeft = TURN_SECONDS;
let timerInterval = null;
let timerPaused = false;

function startTurnTimer(){ $('timer-bar-wrap')?.classList.add('active'); clearInterval(timerInterval); timerInterval = setInterval(tickTurnTimer, 1000); renderTimer(); }
function resetTurnTimer(){ timerLeft = TURN_SECONDS; renderTimer(); }
function toggleTimer(){
  timerPaused = !timerPaused;
  const btn = document.querySelector('.timer-btn'); if(btn) btn.textContent = timerPaused ? '▶' : '⏸';
  renderTimer();
}
function tickTurnTimer(){
  if(timerPaused || timerLeft <= 0) return;
  timerLeft--;
  const chatActive = document.querySelector('.btab[data-tab="chat"]')?.classList.contains('active');
  if(timerLeft <= 10 && timerLeft > 0 && chatActive) playSound('tick');
  if(timerLeft === 0){ if(chatActive) playSound('timeout'); showToast('⏱ Tempo esgotado! O tribunal aguarda um argumento.'); }
  renderTimer();
}
function renderTimer(){
  const pct = Math.max(0, timerLeft / TURN_SECONDS * 100);
  const fill = $('timer-bar-fill'); if(!fill) return;
  fill.style.width = pct + '%';
  fill.style.background = timerLeft <= 15 ? 'var(--red2)' : timerLeft <= 40 ? 'var(--gold2)' : 'var(--gold)';
  $('timer-count').textContent = timerLeft;
  $('timer-count').classList.toggle('urgent', timerLeft > 0 && timerLeft <= 15 && !timerPaused);
  $('timer-label').textContent = timerPaused ? '⏸ pausado' : timerLeft === 0 ? '⏱ tempo esgotado' : '⏱ tempo para argumentar';
}

// ══════════════════════════════════════════════════════
// CASO, VADE MECUM E CALCULADORA DE PENA
// ══════════════════════════════════════════════════════
function renderCaseDetails(c){
  if(!c) return;
  $('g-tags').innerHTML = (c.tags || []).map(t=>`<span class="tag ${escapeHtml(t.c||'tg')}">${escapeHtml(t.t)}</span>`).join('');
  $('g-title').textContent = c.titulo || '';
  $('g-body').innerHTML = c.corpo || escapeHtml(c.context_juiz || ''); // corpo é HTML escrito por nós em CASES

  const blocks = [];
  if(c.contexto_social) blocks.push(`<div class="card"><div class="section-lbl">// contexto social</div><div class="brief-body">${escapeHtml(c.contexto_social)}</div></div>`);
  if(c.antecedentes || c.antecedentes_criminais){
    blocks.push(`<div class="card"><div class="section-lbl">// antecedentes</div>${c.antecedentes?`<div class="brief-body"><strong>Perfil social:</strong> ${escapeHtml(c.antecedentes)}</div>`:''}${c.antecedentes_criminais?`<div class="brief-body" style="margin-top:10px;"><strong>Antecedentes criminais:</strong> ${escapeHtml(c.antecedentes_criminais)}</div>`:''}</div>`);
  }
  if(c.provas?.length) blocks.push(`<div class="card"><div class="section-lbl">// provas e evidências</div><div class="brief-body">${c.provas.map(p=>`<div style="margin-bottom:6px;">• ${escapeHtml(p)}</div>`).join('')}</div></div>`);
  if(c.linha_tempo?.length) blocks.push(`<div class="card"><div class="section-lbl">// linha do tempo</div><div class="brief-body">${c.linha_tempo.map(e=>`<div style="margin-bottom:5px;"><strong style="color:var(--gold2);">${escapeHtml(e.hora||e.data||'')}</strong> — ${escapeHtml(e.fato)}</div>`).join('')}</div></div>`);
  $('g-context').innerHTML = blocks.join('');

  const mine = state.myRole === 'acusacao' ? c.perguntas_acu : c.perguntas_def;
  const sections = [];
  if(mine?.length) sections.push(`<div class="art-strategy-block ${state.myRole==='acusacao'?'asb-acu':'asb-def'}"><div class="asb-label">Perguntas para a sua estratégia</div><div>${mine.map(p=>`<div class="art-texto">• ${escapeHtml(p)}</div>`).join('')}</div></div>`);
  if(c.arts_rapidos?.length) sections.push(`<div class="art-strategy-block"><div class="asb-label">Pontos-chave</div><div>${c.arts_rapidos.map(p=>`<div class="art-texto">• ${escapeHtml(p)}</div>`).join('')}</div></div>`);
  $('g-guide').innerHTML = sections.join('');
  $('g-hot').innerHTML = (c.hot || []).map(item=>`<div class="art-texto">• ${escapeHtml(item)}</div>`).join('');

  $('art-quick-row').innerHTML = (c.arts_rapidos || []).map(item=>`<button type="button" class="art-quick-pill" data-ref="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('');
  $('art-quick-row').querySelectorAll('.art-quick-pill').forEach(b=>b.addEventListener('click', ()=>insertArticle(b.dataset.ref)));

  const myLabel = roleLabel(state.myRole), oppLabel = roleLabel(state.partnerRole);
  $('vade-grid').innerHTML = (c.vade || []).map(item => {
    const myText = state.myRole === 'acusacao' ? item.use_acu : item.use_def;
    const oppText = state.myRole === 'acusacao' ? item.use_def : item.use_acu;
    // texto/exp vêm de CASES (conteúdo nosso, com <em> etc.)
    return `<div class="art-card" onclick="toggleArtCard(this)">
      <div class="art-header"><div class="art-header-content"><div class="art-num-badge">${escapeHtml(item.num||'')}</div><div class="art-name">${escapeHtml(item.nome)}</div><div class="art-pena">${escapeHtml(item.pena||'')}</div></div><div class="art-chevron">›</div></div>
      <div class="art-body">
        <div class="art-texto-label">// texto legal</div><div class="art-texto">${item.texto || ''}</div>
        <div class="art-exp-label">// o que isso significa na prática</div><div class="art-exp">${item.exp || ''}</div>
        ${item.simple?`<div class="art-simple"><div class="art-simple-lbl">💡 em linguagem simples</div><div class="art-simple-txt">${item.simple}</div></div>`:''}
        <div class="art-strategy-block asb-mine"><div class="asb-label">⚔️ Como a ${myLabel} usa isso</div><div class="art-simple-txt">${myText || ''}</div></div>
        <div class="art-strategy-block asb-opp"><div class="asb-label">🛡️ Como a ${oppLabel} pode responder</div><div class="art-simple-txt">${oppText || ''}</div></div>
        ${item.juris?`<div class="art-juris">📚 ${escapeHtml(item.juris)} <span style="color:var(--text3);font-size:9px;">${escapeHtml(item.ref||'')}</span></div>`:''}
      </div></div>`;
  }).join('');
  initializeCalcPanel(c);
}

function toggleArtCard(el){ el.closest('.art-card')?.classList.toggle('expanded'); }

function parsePenaEf(effect){
  if(!effect) return 0;
  const text = String(effect).trim();
  if(/qualifica/i.test(text)) return text.startsWith('-') ? -2 : 2;
  const frac = text.match(/([+-]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if(frac) return Number(frac[1]) / Number(frac[2]);
  const num = text.match(/([+-]?\d+(?:\.\d+)?)/);
  return num ? Number(num[1]) : 0;
}

function roundPena(value){ return Math.round((value + Number.EPSILON) * 100) / 100; }

function updateCalcDisplay(c){
  if(!c) return;
  const slider = $('sl-pb'); if(!slider) return;
  const min = Number(c.penaMin || 0);
  const max = Number(c.penaMax || min);
  const baseValue = min + (max - min) * (Number(slider.value) / 100);
  const aggSum = Array.from(selectedCalcAgg).reduce((sum, idx) => sum + parsePenaEf(c.agravantes?.[idx]?.ef), 0);
  const majSum = Array.from(selectedCalcMaj).reduce((sum, idx) => sum + parsePenaEf(c.majorantes?.[idx]?.ef), 0);
  const total = Math.max(0, baseValue + aggSum + majSum);
  const regime = total <= 4 ? 'Provável regime: aberto' : total <= 8 ? 'Provável regime: semiaberto' : 'Provável regime: fechado';
  $('calc-big').innerHTML = `${roundPena(total)}<span> anos</span>`;
  $('calc-regime').textContent = regime;
  $('regime-txt').textContent = `${regime} (Art. 33 §2º CP: até 4 anos aberto, de 4 a 8 semiaberto, acima de 8 fechado — para réu não reincidente).`;
  $('ph1').textContent = `${roundPena(baseValue)} anos`;
  $('ph2').textContent = `${roundPena(baseValue + aggSum)} anos`;
  $('ph3').textContent = `${roundPena(total)} anos`;
  $('sl-val').textContent = `${Math.round(Number(slider.value))}%`;
}

function calcPena(){ updateCalcDisplay(currentCalcCase); }

function toggleCalcFactor(section, idx){
  const set = section === 'agg' ? selectedCalcAgg : selectedCalcMaj;
  if(set.has(idx)) set.delete(idx); else set.add(idx);
  const btn = (section === 'agg' ? $('chk-agg') : $('chk-maj'))?.querySelector(`button[data-index="${idx}"]`);
  if(btn){ btn.classList.toggle('on-agg', section==='agg' && set.has(idx)); btn.classList.toggle('on-ate', section==='maj' && set.has(idx)); }
  updateCalcDisplay(currentCalcCase);
}

function initializeCalcPanel(c){
  currentCalcCase = c;
  selectedCalcAgg.clear(); selectedCalcMaj.clear();
  const row = (section, item, i) => `<button type="button" class="chk-item" data-index="${i}" onclick="toggleCalcFactor('${section}',${i})"><div class="chk-box"></div><div><div class="chk-lbl">${escapeHtml(item.t)}</div><div class="chk-ef">${escapeHtml(item.ef)}</div></div></button>`;
  $('chk-agg').innerHTML = (c.agravantes||[]).map((item,i)=>row('agg', item, i)).join('') || '<div class="msg">Nenhum agravante registrado.</div>';
  $('chk-maj').innerHTML = (c.majorantes||[]).map((item,i)=>row('maj', item, i)).join('') || '<div class="msg">Nenhum fator adicional registrado.</div>';
  const slider = $('sl-pb'); if(slider) slider.value = 50;
  updateCalcDisplay(c);
}

// ══════════════════════════════════════════════════════
// NAVEGAÇÃO
// ══════════════════════════════════════════════════════
function showTab(tab){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id === `tab-${tab}`));
  document.querySelectorAll('.btab').forEach(b=>b.classList.toggle('active', b.dataset.tab === tab));
  if(tab === 'chat'){ $('chat-notif')?.classList.remove('show'); const msgs = $('chat-messages'); if(msgs) msgs.scrollTop = msgs.scrollHeight; }
  if(tab === 'veredito') $('veredito-notif')?.classList.remove('show');
  if(tab === 'pedido') $('pedido-notif')?.classList.remove('show');
}

function showNotasTab(tab){
  $('notas-panel-pad').classList.toggle('active', tab === 'pad');
  $('notas-panel-ia').classList.toggle('active', tab === 'ia');
  document.querySelectorAll('.notas-tab').forEach((b,i)=>b.classList.toggle('active', (i === 0) === (tab === 'pad')));
}

// ══════════════════════════════════════════════════════
// SONS (Web Audio API — sem arquivos)
// ══════════════════════════════════════════════════════
let audioCtx = null;
function playSound(type){
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx, t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    const tones = {
      message:{ f:[[880,0]], end:660, vol:0.12, dur:0.2 },
      judge:{ f:[[440,0],[554,0.1],[659,0.2]], vol:0.15, dur:0.4 },
      tick:{ f:[[1200,0]], vol:0.08, dur:0.08 },
      timeout:{ f:[[220,0]], vol:0.2, dur:0.6, wave:'sawtooth' }
    }[type];
    if(!tones) return;
    if(tones.wave) osc.type = tones.wave;
    tones.f.forEach(([f, at]) => osc.frequency.setValueAtTime(f, t + at));
    if(tones.end) osc.frequency.exponentialRampToValueAtTime(tones.end, t + tones.dur * 0.75);
    gain.gain.setValueAtTime(tones.vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + tones.dur);
    osc.start(t); osc.stop(t + tones.dur);
  }catch(e){ /* sem áudio, sem problema */ }
}

// ══════════════════════════════════════════════════════
// Funções usadas por onclick="" no HTML
// ══════════════════════════════════════════════════════
Object.assign(window, {
  createRoom, joinRoom, resumeSession, forgetSession, copyRoomCode, startAnySolo, backToLobby,
  selectCase, selectRole, showTab, showNotasTab, toggleTimer,
  requestJudge, requestVerdict, submitRecurso, waiveRecurso, newCase,
  sendMessage, sendIaMsg, iaQuickAsk, clearNotas, clearReply,
  onPedidoInput, calcPena, toggleCalcFactor, toggleArtCard, playSound
});

initUI();
