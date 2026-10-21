// main.js — lobby, sessão, abas, notas e assistente. O processo em si fica em modules/game.js.
import { CASES } from './data/cases.js';
import { DOSSIES } from './data/dossies.js';
import { ask } from './ai-bridge.js';
import { G, render, tick, initialRoomState, assistContext, countAssistUse } from './modules/game.js';
import { renderCase } from './modules/case_view.js';
import { NIVEIS_JOGO, loadCareers, careerCardHtml } from './modules/career.js';
import { $, escapeHtml, toast, ROLE_LABEL, otherRole, autoGrow, moderate, playSound, initGlossaryPopover } from './modules/util.js';

const SESSION_KEY = 'tribunal_session';
const IN_GAME_KEY = 'tribunal_in_game';

G.cases = CASES;
const lobby = { caseIdx: 0, role: '', nivelCreate: 'advogado', nivelJoin: 'advogado' };
let waitingHandler = null;

// ══════════════════════════════════════════════════════
// Sessão (por aba no sessionStorage, e no localStorage para o botão "Voltar para a sala")
// ══════════════════════════════════════════════════════
function saveSession(){
  const s = JSON.stringify({ roomCode: G.code, myName: G.me.name });
  try{ localStorage.setItem(SESSION_KEY, s); sessionStorage.setItem(SESSION_KEY, s); }catch(e){}
}
function loadSession(){
  try{ return JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || 'null'); }catch(e){ return null; }
}
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(IN_GAME_KEY); }catch(e){} }

function newRoomCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I para não confundir
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function initFirebase(){
  try{
    if(G.db) return true;
    if(!window.firebase) throw new Error('Firebase SDK não carregado');
    if(!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
    G.db = firebase.database();
    G.db.ref('.info/serverTimeOffset').on('value', s => { G.serverOffset = s.val() || 0; });
    return true;
  }catch(e){ console.error('initFirebase', e); return false; }
}

// ══════════════════════════════════════════════════════
// LOBBY
// ══════════════════════════════════════════════════════
function nivelChips(target){
  return Object.entries(NIVEIS_JOGO).map(([k, n]) => `<button type="button" class="nivel-chip ${k === lobby[target] ? 'sel' : ''}" data-nivel="${k}" data-target="${target}"><span>${n.emoji}</span><b>${n.label}</b><small>${n.desc}</small></button>`).join('');
}

function renderNivelPickers(){
  $('nivel-create').innerHTML = nivelChips('nivelCreate');
  $('nivel-join').innerHTML = nivelChips('nivelJoin');
  document.querySelectorAll('.nivel-chip').forEach(b => b.addEventListener('click', () => { lobby[b.dataset.target] = b.dataset.nivel; renderNivelPickers(); }));
}

function initLobby(){
  $('case-scroll').innerHTML = CASES.map((c, i) => `<div class="case-chip ${i === lobby.caseIdx ? 'active' : ''} ${c.tutorial ? 'tutorial' : ''}" data-idx="${i}">${c.tutorial ? '🎓 ' : ''}${escapeHtml(c.id)} · ${escapeHtml(c.nome)}${DOSSIES[c.id].rito === 'juri' ? ' 👥' : ''}</div>`).join('');
  $('case-scroll').querySelectorAll('.case-chip').forEach(el => el.addEventListener('click', () => {
    lobby.caseIdx = Number(el.dataset.idx);
    document.querySelectorAll('.case-chip').forEach((x, j) => x.classList.toggle('active', j === lobby.caseIdx));
    renderCaseHint();
  }));
  renderCaseHint();
  renderNivelPickers();
  $('inp-room-code')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
  $('btn-career')?.addEventListener('click', showCareers);
  renderResumeCard();
  if(sessionStorage.getItem(IN_GAME_KEY) && loadSession()) resumeSession();
}

function renderCaseHint(){
  const c = CASES[lobby.caseIdx];
  const d = DOSSIES[c.id];
  $('case-hint').innerHTML = `${c.tutorial ? '🎓 <b>Caso tutorial</b>: leve e engraçado, ótimo para aprender as fases. ' : ''}${escapeHtml(c.titulo)} · ${d.rito === 'juri' ? '👥 pode ir a Júri' : '⚖️ juiz singular'}${d.acordo ? ' · 🤝 admite acordo' : ''}`;
}

function renderResumeCard(){
  const card = $('card-resume');
  const s = loadSession();
  if(!s?.roomCode){ card.style.display = 'none'; return; }
  card.style.display = 'block';
  $('resume-text').textContent = `Sala ${s.roomCode} · ${s.myName}`;
}

function selectRole(r){
  lobby.role = r;
  $('rc-acu')?.classList.toggle('sel', r === 'acusacao');
  $('rc-def')?.classList.toggle('sel', r === 'defesa');
}

async function createRoom(){
  if(!initFirebase()){ toast('Erro ao conectar ao servidor do jogo'); return; }
  const name = $('inp-name-create').value.trim();
  if(!name){ toast('Digite seu nome'); return; }
  if(!lobby.role){ toast('Escolha seu papel'); return; }
  const btn = $('btn-create'); btn.disabled = true; btn.textContent = 'CRIANDO...';
  try{
    let code = newRoomCode();
    for(let tries = 0; tries < 5 && (await G.db.ref(`rooms/${code}`).once('value')).exists(); tries++) code = newRoomCode();
    await G.db.ref(`rooms/${code}`).set({
      ...initialRoomState(lobby.caseIdx, CASES),
      code, creator: name, round: 0, solo: false, createdAt: firebase.database.ServerValue.TIMESTAMP,
      players: { [lobby.role]: { name, nivel: lobby.nivelCreate } }
    });
    G.code = code; G.me = { name, role: lobby.role };
    G.roomRef = G.db.ref(`rooms/${code}`);
    saveSession();
    showWaiting();
  }catch(e){ toast('Erro: ' + e.message); }
  finally{ btn.disabled = false; btn.textContent = 'CRIAR SALA'; }
}

async function joinRoom(){
  if(!initFirebase()){ toast('Erro ao conectar ao servidor do jogo'); return; }
  const name = $('inp-name-join').value.trim();
  const code = $('inp-room-code').value.trim().toUpperCase();
  if(!name){ toast('Digite seu nome'); return; }
  if(code.length !== 4){ toast('O código tem 4 caracteres'); return; }
  const btn = $('btn-join'); btn.disabled = true; btn.textContent = 'ENTRANDO...';
  try{
    const ref = G.db.ref(`rooms/${code}`);
    const room = (await ref.once('value')).val();
    if(!room){ toast('Sala não encontrada'); return; }
    const players = room.players || {};
    // quem já está na sala com esse nome volta para o seu papel (ex.: recarregou a página)
    if(Object.values(players).some(p => p?.name === name)){ await enterRoom(code, name); return; }
    if(room.solo){ toast('Essa sala está no modo treino (contra a IA)'); return; }
    const free = ['acusacao', 'defesa'].find(r => !players[r]);
    if(!free){ toast('Essa sala já tem dois jogadores'); return; }
    const tx = await ref.child(`players/${free}`).transaction(p => p ? undefined : { name, nivel: lobby.nivelJoin });
    if(!tx.committed){ toast('Alguém entrou antes de você. Tente de novo.'); return; }
    await enterRoom(code, name);
  }catch(e){ toast('Erro: ' + e.message); }
  finally{ btn.disabled = false; btn.textContent = 'ENTRAR NA SALA'; }
}

async function resumeSession(){
  const s = loadSession();
  if(!s) return;
  if(!initFirebase()){ toast('Erro ao conectar ao servidor do jogo'); return; }
  const room = (await G.db.ref(`rooms/${s.roomCode}`).once('value')).val();
  if(!room){ clearSession(); renderResumeCard(); toast('Essa sala não existe mais'); return; }
  await enterRoom(s.roomCode, s.myName);
}

function forgetSession(){ clearSession(); renderResumeCard(); }

async function enterRoom(code, name){
  const ref = G.db.ref(`rooms/${code}`);
  const room = (await ref.once('value')).val() || {};
  const role = ['acusacao', 'defesa'].find(r => room.players?.[r]?.name === name);
  if(!role){ clearSession(); renderResumeCard(); toast('Você não está nesta sala.'); return; }
  G.code = code; G.me = { name, role }; G.roomRef = ref;
  saveSession();
  const partner = room.players?.[otherRole(role)];
  if(!partner && !room.solo) showWaiting();
  else launchGame(room);
}

function showWaiting(){
  ['card-create', 'card-join', 'card-resume'].forEach(id => { $(id).style.display = 'none'; });
  document.querySelectorAll('.divider, .lobby-career-btn').forEach(el => { el.style.display = 'none'; });
  const cw = $('card-waiting'); cw.style.display = 'flex'; cw.style.flexDirection = 'column'; cw.style.alignItems = 'center';
  $('waiting-code').textContent = G.code;
  waitingHandler = G.roomRef.on('value', snap => {
    const room = snap.val(); if(!room) return;
    updateWaitingUI(room);
    if(room.players?.acusacao && room.players?.defesa){
      G.roomRef.off('value', waitingHandler); waitingHandler = null;
      setTimeout(() => launchGame(room), 500);
    }
  });
}

function updateWaitingUI(room){
  const row = r => {
    const p = room.players?.[r];
    return `<div class="player-item"><div class="pi-dot ${p ? r : 'empty'}"></div><div class="pi-name">${escapeHtml(p?.name || 'Aguardando...')}${p?.name === G.me.name ? ' (você)' : ''}</div><div class="pi-role">${r === 'acusacao' ? '⚔️ ACUSAÇÃO' : '🛡️ DEFESA'}${p ? ` · ${NIVEIS_JOGO[p.nivel]?.emoji || ''}` : ''}</div></div>`;
  };
  $('players-list').innerHTML = row('acusacao') + row('defesa');
}

async function copyRoomCode(){
  const text = `Bora jogar Tribunal do Casal? ⚖️ Código da sala: ${G.code}\n${location.origin}${location.pathname}`;
  try{ await navigator.clipboard.writeText(text); toast('Convite copiado!'); }
  catch(e){ toast(`Código: ${G.code}`); }
}

async function startSolo(){
  if(waitingHandler){ G.roomRef.off('value', waitingHandler); waitingHandler = null; }
  await G.roomRef.update({ solo: true });
  launchGame((await G.roomRef.once('value')).val());
}

async function showCareers(){
  if(!initFirebase()) return;
  const modal = $('career-modal');
  modal.classList.add('show');
  $('career-list').innerHTML = '<div class="wait">Carregando…</div>';
  try{
    const list = await loadCareers(G.db);
    $('career-list').innerHTML = list.length ? list.map(careerCardHtml).join('') : '<div class="wait">Ninguém jogou ainda. Bora ser o primeiro!</div>';
  }catch(e){ $('career-list').innerHTML = '<div class="wait">Não foi possível carregar.</div>'; }
}

function backToLobby(){
  if(!confirm('Sair da sala? Você pode voltar depois pelo botão "Voltar para a sala".')) return;
  sessionStorage.removeItem(IN_GAME_KEY);
  location.reload(); // limpa todos os listeners de uma vez; a sessão fica salva
}

// ══════════════════════════════════════════════════════
// JOGO
// ══════════════════════════════════════════════════════
let launched = false;
function launchGame(room){
  if(launched) return;
  launched = true;
  G.room = room;
  sessionStorage.setItem(IN_GAME_KEY, '1');
  $('s-lobby').classList.remove('active');
  $('s-game').classList.add('active');

  const c = CASES[room.caseIdx] || CASES[0];
  const role = G.me.role;
  const nivel = room.players?.[role]?.nivel || 'advogado';
  renderCase(c, DOSSIES[c.id], role, nivel);
  $('gtb-title').textContent = `${c.nome} · Sala ${G.code}`;
  $('gtb-role-txt').textContent = role === 'acusacao' ? 'ACUSAÇÃO' : 'DEFESA';
  $('gtb-badge').className = `gtb-badge ${role}`;
  $('ia-assist-desc').textContent = nivel === 'jurista' ? 'Nível Jurista: você está por conta própria 😎' : nivel === 'advogado' ? 'Chat privado · até 5 perguntas por caso' : 'Chat privado · só você vê';
  loadNotas();
  showTab(room.phase === 'fim' || (room.autos && Object.keys(room.autos).length > 1) ? 'audiencia' : 'caso');

  const round = room.round || 0;
  G.roomRef.on('value', snap => {
    const r = snap.val();
    if(!r){ toast('A sala foi encerrada.'); clearSession(); setTimeout(() => location.reload(), 1500); return; }
    if((r.round || 0) !== round){ location.reload(); return; } // novo caso: recomeça a tela do zero
    G.room = r;
    render();
  });
  setInterval(tick, 500);

  // assistente: canal privado do meu papel
  G.roomRef.child(`ia_chat_${role}`).on('child_added', snap => { const m = snap.val(); if(m){ iaHistory.push(m); appendIaMessage(m); } });

  // presença: avisa quando o parceiro entra/sai
  const meRef = G.roomRef.child(`presence/${role}`);
  meRef.set({ name: G.me.name, online: true });
  meRef.onDisconnect().set({ name: G.me.name, online: false });
  if(!room.solo){
    let first = true;
    G.roomRef.child(`presence/${otherRole(role)}`).on('value', s => {
      const p = s.val();
      $('gtb-badge').classList.toggle('partner-off', !p?.online);
      if(!first && p?.name) toast(p.online ? `${p.name} entrou na sala` : `${p.name} saiu da sala`);
      first = false;
    });
  }
}

function showTab(tab){
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  document.querySelectorAll('.btab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if(tab === 'audiencia'){ $('aud-notif')?.classList.remove('show'); const a = $('autos'); if(a) a.scrollTop = a.scrollHeight; }
}

function showNotasTab(tab){
  $('notas-panel-pad').classList.toggle('active', tab === 'pad');
  $('notas-panel-ia').classList.toggle('active', tab === 'ia');
  document.querySelectorAll('.notas-tab').forEach((b, i) => b.classList.toggle('active', (i === 0) === (tab === 'pad')));
}

// ── Notas (privadas: ficam só neste aparelho) ──
function notasKey(){ return `tribunal_notas_${G.code}_${G.me.role}_${G.room?.round || 0}`; }
function loadNotas(){ const ta = $('notas-ta'); if(!ta) return; try{ ta.value = localStorage.getItem(notasKey()) || ''; }catch(e){} updateNotasCount(); }
let notasSavedTimer = null;
function onNotasInput(){
  const ta = $('notas-ta'); if(!ta) return;
  try{ localStorage.setItem(notasKey(), ta.value); }catch(e){}
  updateNotasCount();
  const saved = $('notas-saved'); saved?.classList.add('show');
  clearTimeout(notasSavedTimer); notasSavedTimer = setTimeout(() => saved?.classList.remove('show'), 1200);
}
function clearNotas(){ const ta = $('notas-ta'); if(!ta || !confirm('Apagar suas anotações?')) return; ta.value = ''; onNotasInput(); }
function updateNotasCount(){ const ta = $('notas-ta'), l = $('notas-chars'); if(ta && l) l.textContent = `${ta.value.length} caracteres`; }

// ── Assistente IA (privado) ──
let iaHistory = [];
let iaSending = false;
async function sendIaMsg(){
  if(iaSending || !G.roomRef || !G.room) return;
  const ta = $('ia-inp'); const text = ta?.value.trim(); if(!text) return;
  const ctx = assistContext();
  if(ctx.usados >= ctx.limite){ toast(ctx.limite === 0 ? 'No nível Jurista não há assistente. Confie no seu taco!' : 'Você já usou as 5 perguntas do assistente neste caso.'); return; }
  if(moderate(text).blocked){ toast('Mensagem bloqueada pela moderação.'); return; }
  iaSending = true;
  const btn = $('ia-send-btn'); btn.disabled = true; btn.textContent = '...';
  const channel = G.roomRef.child(`ia_chat_${G.me.role}`);
  try{
    ta.value = ''; autoGrow(ta, 120);
    const history = iaHistory.slice(-8);
    await channel.push({ sender: G.me.name, text, ts: Date.now(), type: 'user' });
    await countAssistUse();
    const r = await ask('assist', ctx.caseObj, { ...ctx.extra, role: G.me.role, question: text, history });
    await channel.push({ sender: 'Assistente', text: r.text, ts: Date.now(), type: 'ai', provider: r.provider || 'local' });
  }catch(e){
    console.warn('assistente', e);
    toast('Falha ao consultar o assistente. Tente novamente.');
  }finally{
    iaSending = false; btn.disabled = false; btn.textContent = 'ENVIAR';
  }
}
function iaQuickAsk(q){ const ta = $('ia-inp'); if(!ta) return; ta.value = q; sendIaMsg(); }
function appendIaMessage(msg){
  const box = $('ia-chat-msgs'); if(!box) return;
  const el = document.createElement('div');
  el.className = `ia-msg ${msg.type === 'ai' ? 'ai' : 'user'}`;
  el.innerHTML = `<div class="ia-msg-sender">${escapeHtml(msg.sender)}</div><div class="ia-msg-bubble">${escapeHtml(msg.text).replace(/\n/g, '<br>')}</div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

// ══════════════════════════════════════════════════════
// Inicialização
// ══════════════════════════════════════════════════════
function initUI(){
  $('ia-send-btn')?.addEventListener('click', sendIaMsg);
  const iaInp = $('ia-inp');
  if(iaInp){ iaInp.addEventListener('keydown', e => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendIaMsg(); } }); iaInp.addEventListener('input', () => autoGrow(iaInp, 120)); }
  document.querySelectorAll('.notas-tab').forEach((b, i) => b.addEventListener('click', () => showNotasTab(i === 0 ? 'pad' : 'ia')));
  $('notas-ta')?.addEventListener('input', onNotasInput);
  document.querySelector('.notas-clear')?.addEventListener('click', clearNotas);
  $('career-modal')?.addEventListener('click', e => { if(e.target.id === 'career-modal' || e.target.closest('.modal-close')) $('career-modal').classList.remove('show'); });
  // desbloqueia o áudio no primeiro toque (exigência dos navegadores de celular)
  document.addEventListener('pointerdown', () => playSound('none'), { once: true });
  initGlossaryPopover();
  initLobby();
}

// Funções usadas por onclick="" no HTML
Object.assign(window, { createRoom, joinRoom, resumeSession, forgetSession, copyRoomCode, startSolo, backToLobby, selectRole, showTab, showNotasTab, iaQuickAsk });

initUI();
