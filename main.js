// main.js — orquestra o app: Firebase realtime sync, UI handlers, chamadas ao juiz (askJudge)
import './ai-bridge.js'; // garante que askJudge esteja disponível globalmente

// util
function $(id){return document.getElementById(id);} 

let db = null;
let roomRef = null;
let presenceRef = null;
let localClientId = Math.random().toString(36).slice(2,9);

let judgeQuestions = { perguntas_acu: [], perguntas_def: [] };
let judgeAnswers = {};
let selectedJudgeQuestion = null;
let currentCalcCase = null;
const selectedCalcAgg = new Set();
const selectedCalcMaj = new Set();
const MODERATION_BLOCKLIST = ['merda','porra','filho da puta','puta','viado','otário','idiota','burro','escroto','imbecil','piranha','moleque'];

function moderateText(text){
  const normalized = (text||'').toLowerCase();
  const found = MODERATION_BLOCKLIST.find(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`, 'i').test(normalized));
  return { blocked: Boolean(found), word: found };
}

function formatJudgeQuestion(question){ return question?.length > 75 ? question.slice(0,72) + '...' : question; }

function renderJudgeQuestions(questions = judgeQuestions, answers = judgeAnswers){
  const panel = $('judge-question-list');
  const stateEl = $('judge-question-state');
  const answerArea = $('question-answer-text');
  const btn = $('question-answer-btn');
  if(!panel || !stateEl) return;

  let hasQuestions = false;
  const sections = ['perguntas_acu','perguntas_def'].map(sideKey => {
    const title = sideKey === 'perguntas_acu' ? 'Acusação' : 'Defesa';
    const side = sideKey === 'perguntas_acu' ? 'acu' : 'def';
    const list = (questions[sideKey]||[]).map((q, idx) => {
      const answered = answers?.[side]?.[idx];
      const safeQuestion = JSON.stringify(q).replace(/"/g,'&quot;');
      return `<div class="judge-question-row ${answered?'answered':''}">
        <div><strong>${escapeHtml(q)}</strong>${answered?`<div class="judge-question-status">Respondida</div>`:''}</div>
        <button class="judge-question-btn" type="button" onclick="selectJudgeQuestion('${side}', ${idx}, ${safeQuestion})">${answered?'Rever':'Responder'}</button>
      </div>`;
    }).join('');
    if(list) hasQuestions = true;
    return `<div class="judge-question-block"><div class="judge-question-label">Perguntas para ${title}</div>${list || '<div class="judge-question-empty">Sem perguntas registradas.</div>'}</div>`;
  }).join('');

  panel.innerHTML = sections;
  if(!hasQuestions){ stateEl.textContent = 'Sem perguntas ativas do juiz no momento.'; btn.disabled = true; if(answerArea) answerArea.value = ''; selectedJudgeQuestion = null; }
  else {
    const pending = questions.perguntas_acu.length + questions.perguntas_def.length > 0;
    stateEl.textContent = pending ? 'Selecione uma pergunta e responda para disparar nova análise do juiz.' : 'Sem perguntas ativas.';
    btn.disabled = !selectedJudgeQuestion;
  }
}

function selectJudgeQuestion(side, index, question){
  selectedJudgeQuestion = { side, index, question };
  const answerArea = $('question-answer-text');
  const banner = $('reply-banner');
  if(answerArea){ answerArea.value = `Resposta à pergunta: ${question}\n`; answerArea.focus(); }
  if(banner){ banner.classList.add('show'); $('reply-banner-text').textContent = `Respondendo pergunta: ${formatJudgeQuestion(question)}`; }
  const btn = $('question-answer-btn'); if(btn) btn.disabled = false;
}

function clearJudgeQuestionSelection(){
  selectedJudgeQuestion = null;
  const answerArea = $('question-answer-text'); if(answerArea) answerArea.value = '';
  const banner = $('reply-banner'); if(banner){ banner.classList.remove('show'); $('reply-banner-text').textContent = ''; }
  const btn = $('question-answer-btn'); if(btn) btn.disabled = true;
}

async function submitJudgeAnswer(){
  const textArea = $('question-answer-text');
  if(!textArea) return;
  const text = textArea.value.trim();
  if(!text){ showToast('Escreva sua resposta antes de enviar.'); return; }
  if(!selectedJudgeQuestion){ showToast('Selecione a pergunta que deseja responder.'); return; }

  const moderation = moderateText(text);
  if(moderation.blocked){ showToast(`⚠️ Palavra sensível detectada: ${moderation.word}`); }

  const msg = {
    sender: state.myName,
    role: state.myRole,
    text: `Resposta à pergunta do juiz: ${selectedJudgeQuestion.question}\n\n${text}`,
    ts: Date.now(),
    type: 'chat',
    question_reply: true,
    question_side: selectedJudgeQuestion.side,
    question_index: selectedJudgeQuestion.index
  };
  if(roomRef){
    await roomRef.child('chat').push(msg);
    await roomRef.child('judge_answers').child(selectedJudgeQuestion.side).child(selectedJudgeQuestion.index.toString()).set({
      question: selectedJudgeQuestion.question,
      answer: text,
      sender: state.myName,
      role: state.myRole,
      ts: Date.now()
    });
    await roomRef.child('judge_pending').set(true);
  } else {
    appendChatMessage(msg);
  }
  clearJudgeQuestionSelection();
  if(roomRef) scheduleJudgeRerun(800);
}

// debounce timer for auto re-running judge when players respond
let judgeDebounceTimer = null;
function scheduleJudgeRerun(delay=1800){ if(judgeDebounceTimer) clearTimeout(judgeDebounceTimer); judgeDebounceTimer = setTimeout(async ()=>{ try{ if(!roomRef) return; const snap = await roomRef.child('judge_pending').once('value'); if(snap && snap.val()){ requestJudge(); } }catch(e){ console.warn('scheduleJudgeRerun failed', e); } }, delay); }

function parsePenaEf(effect){
  if(!effect) return 0;
  const text = String(effect).trim();
  if(/qualifica/i.test(text)) return text.startsWith('-') ? -2 : 2;
  const frac = text.match(/([+-]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if(frac){ return Number(frac[1]) / Number(frac[2]); }
  const num = text.match(/([+-]?\d+(?:\.\d+)?)/);
  return num ? Number(num[1]) : 0;
}

function roundPena(value){ return Math.round((value + Number.EPSILON) * 100) / 100; }

function updateCalcDisplay(caseObj){
  if(!caseObj) return;
  const slider = $('sl-pb'); if(!slider) return;
  const min = Number(caseObj.penaMin || 0);
  const max = Number(caseObj.penaMax || min);
  const baseValue = min + (max - min) * (Number(slider.value) / 100);
  const aggSum = Array.from(selectedCalcAgg).reduce((sum, idx) => sum + parsePenaEf(caseObj.agravantes?.[idx]?.ef), 0);
  const majSum = Array.from(selectedCalcMaj).reduce((sum, idx) => sum + parsePenaEf(caseObj.majorantes?.[idx]?.ef), 0);
  const total = Math.max(0, baseValue + aggSum + majSum);
  const regime = total <= 4 ? 'Provável regime: aberto / semiaberto' : 'Provável regime: fechado';

  $('calc-big').innerHTML = `${roundPena(total)}<span> anos</span>`;
  $('calc-regime').textContent = regime;
  const regimeText = $('regime-txt'); if(regimeText) regimeText.textContent = regime;
  $('ph1').textContent = `${roundPena(baseValue)} anos`;
  $('ph2').textContent = `${roundPena(baseValue + aggSum)} anos`;
  $('ph3').textContent = `${roundPena(total)} anos`;
  $('sl-val').textContent = `${Math.round(Number(slider.value))}%`;
}

function calcPena(){ updateCalcDisplay(currentCalcCase); }

function toggleCalcFactor(section, idx){
  const index = Number(idx);
  const set = section === 'agg' ? selectedCalcAgg : selectedCalcMaj;
  if(set.has(index)) set.delete(index); else set.add(index);
  const grid = section === 'agg' ? $('chk-agg') : $('chk-maj');
  const btn = grid?.querySelector(`button[data-index="${index}"]`);
  if(btn){ btn.classList.toggle('on-agg', section==='agg' && set.has(index)); btn.classList.toggle('on-ate', section==='maj' && set.has(index)); }
  updateCalcDisplay(currentCalcCase);
}

function initializeCalcPanel(caseObj){
  currentCalcCase = caseObj;
  selectedCalcAgg.clear();
  selectedCalcMaj.clear();
  const aggGrid = $('chk-agg');
  const majGrid = $('chk-maj');
  if(aggGrid){
    aggGrid.innerHTML = (caseObj.agravantes||[]).map((item,i)=>`<button type="button" class="chk-item" data-index="${i}" onclick="toggleCalcFactor('agg',${i})"><div class="chk-box"></div><div><div class="chk-lbl">${escapeHtml(item.t)}</div><div class="chk-ef">${escapeHtml(item.ef)}</div></div></button>`).join('') || '<div class="msg">Nenhum agravante registrado.</div>';
  }
  if(majGrid){
    majGrid.innerHTML = (caseObj.majorantes||[]).map((item,i)=>`<button type="button" class="chk-item" data-index="${i}" onclick="toggleCalcFactor('maj',${i})"><div class="chk-box"></div><div><div class="chk-lbl">${escapeHtml(item.t)}</div><div class="chk-ef">${escapeHtml(item.ef)}</div></div></button>`).join('') || '<div class="msg">Nenhum fator adicional registrado.</div>';
  }
  const slider = $('sl-pb'); if(slider){ slider.value = 50; slider.min = 0; slider.max = 100; }
  updateCalcDisplay(caseObj);
}

async function initFirebase(){
  try{
    if (!window.firebase) throw new Error('Firebase SDK não carregado');
    if (!window.firebase.apps?.length){
      firebase.initializeApp(window.firebaseConfig);
    }
    db = firebase.database();
    return true;
  }catch(e){ console.error('initFirebase', e); return false; }
}

function initUI(){
  // Bindings
  const createBtn = $('btn-create'); if(createBtn) createBtn.addEventListener('click', createRoom);
  const joinBtn = $('btn-join'); if(joinBtn) joinBtn.addEventListener('click', joinRoom);
  const sendBtn = $('btn-send'); if(sendBtn) sendBtn.addEventListener('click', sendMessage);
  const judgeBtn = $('btn-judge'); if(judgeBtn) judgeBtn.addEventListener('click', requestJudge);
  const iaSend = $('ia-send-btn'); if(iaSend) iaSend.addEventListener('click', sendIaMsg);
  const iaInp = $('ia-inp'); if(iaInp) iaInp.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendIaMsg(); } });
  const chatInp = $('chat-inp'); if(chatInp) chatInp.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); } });

  // populate cases list
  const scroll = $('case-scroll');
  if(scroll && window.CASES){
    scroll.innerHTML = window.CASES.map((c,i)=>`<div class="case-chip ${i===0?'active':''}" data-idx="${i}">${c.id} · ${c.nome}</div>`).join('');
    scroll.querySelectorAll('.case-chip').forEach(el=>el.addEventListener('click', (e)=>{ selectCase(Number(el.dataset.idx)); }));
  }
}

function initLobby(){ if(!initFirebase()){ alert('Erro ao conectar ao Firebase!'); return; } initUI(); initApiKeyUI?.(); }

// state mirrored from inline script
const state = window.state || { roomCode:'', myRole:'', myName:'', partnerName:'', partnerRole:'', caseIdx:0, solo:false };
window.state = state;

function showToast(msg, duration=3000){ const t = document.createElement('div'); t.textContent = msg; t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1c1c27;border:1px solid #c9953a;color:#e8b45a;padding:12px 20px;border-radius:8px;font-family:var(--mono);font-size:12px;z-index:9999;animation:slideUp .3s ease;'; document.body.appendChild(t); setTimeout(()=>{ t.style.animation='slideDown .3s ease'; setTimeout(()=>t.remove(), 300); }, duration); }

async function createRoom(){
  if(!initFirebase()) { showToast('Erro ao inicializar Firebase'); return; }
  const name = $('inp-name-create').value.trim(); if(!name){ showToast('Digite seu nome'); return; }
  if(!state.createRole){ showToast('Escolha seu papel'); return; }
  const btn = $('btn-create'); btn.disabled=true; btn.textContent='CRIANDO...';
  state.myName = name; state.myRole = state.createRole; state.roomCode = Math.random().toString(36).substr(2,4).toUpperCase();
  roomRef = db.ref(`rooms/${state.roomCode}`);
  try{
    const snap = await roomRef.once('value');
    if(snap.exists()){ state.roomCode = Math.random().toString(36).substr(2,4).toUpperCase(); roomRef = db.ref(`rooms/${state.roomCode}`); }
    await roomRef.set({ creator:name, creatorRole:state.myRole, caseIdx:state.caseIdx, scoreAcu:0, scoreDef:0, ready:false, createdAt:firebase.database.ServerValue.TIMESTAMP });
    roomRef.onDisconnect().remove();
    btn.disabled=false; btn.textContent='CRIAR SALA';
    $('room-code-display').textContent = state.roomCode; $('code-display').style.display='block';
    showToast('✓ Sala criada! Aguardando parceiro...');
    showWaiting();
  }catch(e){ btn.disabled=false; btn.textContent='CRIAR SALA'; showToast('Erro: '+e.message); }
}

async function joinRoom(){
  if(!initFirebase()) { showToast('Erro ao inicializar Firebase'); return; }
  const name = $('inp-name-join').value.trim(); const code = $('inp-room-code').value.trim().toUpperCase();
  if(!name){ showToast('Digite seu nome'); return; }
  if(!state.joinRole){ showToast('Escolha seu papel'); return; }
  if(code.length!==4){ showToast('Código deve ter 4 letras'); return; }
  const btn = $('btn-join'); btn.disabled=true; btn.textContent='ENTRANDO...';
  state.myName = name; state.myRole = state.joinRole; state.roomCode = code; roomRef = db.ref(`rooms/${code}`);
  try{
    const snap = await roomRef.once('value'); const room = snap.val();
    if(!room){ btn.disabled=false; btn.textContent='ENTRAR NA SALA'; showToast('Sala não encontrada'); return; }
    if(room.creatorRole === state.myRole){ btn.disabled=false; btn.textContent='ENTRAR NA SALA'; showToast('Papel já ocupado'); return; }
    if(room.partnerName){ btn.disabled=false; btn.textContent='ENTRAR NA SALA'; showToast('Sala cheia'); return; }
    state.caseIdx = room.caseIdx || 0; state.partnerName = room.creator; state.partnerRole = room.creatorRole;
    await roomRef.update({ partnerName:name, partnerRole:state.myRole, ready:true });
    setupRealtimeListeners();
    showToast('✓ Entrando na sala...');
    setTimeout(launchGame, 300);
    btn.disabled=false; btn.textContent='ENTRAR NA SALA';
  }catch(e){ btn.disabled=false; btn.textContent='ENTRAR NA SALA'; showToast('Erro: '+e.message); }
}

function showWaiting(){
  document.getElementById('card-create').style.display='none'; document.querySelectorAll('.divider').forEach(el=>el.style.display='none'); document.getElementById('card-join').style.display='none';
  const cw = $('card-waiting'); cw.style.display='flex'; cw.style.flexDirection='column'; cw.style.alignItems='center';
  $('waiting-code').textContent = state.roomCode; updateWaitingUI();
  roomRef.on('value', snap => { const room = snap.val(); if(!room) return; if(room.ready && room.partnerName){ state.partnerName = room.partnerName; state.partnerRole = room.partnerRole; updateWaitingUI(); roomRef.off(); setupRealtimeListeners(); setTimeout(()=>launchGame(),400); } });
}

function updateWaitingUI(){ const list = $('players-list'); const myLbl = state.myRole==='acusacao'?'⚔️ ACUSAÇÃO':'🛡️ DEFESA'; const partLbl = state.partnerName ? (state.partnerRole==='acusacao'?'⚔️ ACUSAÇÃO':'🛡️ DEFESA') : '...'; list.innerHTML = ` <div class="player-item"><div class="pi-dot ${state.myRole}"></div><div class="pi-name">${state.myName} (você)</div><div class="pi-role">${myLbl}</div></div> <div class="player-item"><div class="pi-dot ${state.partnerName?state.partnerRole:'empty'}"></div><div class="pi-name">${state.partnerName||'Aguardando...'}</div><div class="pi-role">${partLbl}</div></div>`; }

function startAnySolo(){ state.solo=true; state.partnerName='Parceiro'; state.partnerRole = state.myRole==='acusacao'?'defesa':'acusacao'; if(roomRef) roomRef.off(); launchGame(); }

function setupRealtimeListeners(){
  if(!roomRef) return; 
  // chat
  const chatRef = roomRef.child('chat');
  chatRef.on('child_added', snap => {
    const msg = snap.val(); if(!msg) return; appendChatMessage(msg);
    // se houver perguntas pendentes do juiz e mensagem de usuário, agendar re-análise
    try{
      if(msg.type === 'chat' && msg.sender && msg.sender !== 'Juiz'){
        roomRef.child('judge_pending').once('value').then(snap => { if(snap && snap.val()){ scheduleJudgeRerun(1500); } }).catch(()=>{});
      }
    }catch(e){ console.warn('chat child_added handler', e); }
  });
  // judge questions
  roomRef.child('verdict_questions').on('value', s => { judgeQuestions = s.val() || { perguntas_acu: [], perguntas_def: [] }; renderJudgeQuestions(); });
  roomRef.child('judge_answers').on('value', s => { judgeAnswers = s.val() || {}; renderJudgeQuestions(); });
  roomRef.child('judge_pending').on('value', s => { const pending = s.val(); const badge = $('veredito-notif'); if(badge){ badge.classList.toggle('show', Boolean(pending)); } });
  // score
  roomRef.child('scoreAcu').on('value', s => { const v = s.val(); if(v!==null) $('sc-acu').textContent = v; });
  roomRef.child('scoreDef').on('value', s => { const v = s.val(); if(v!==null) $('sc-def').textContent = v; });
  // notes
  roomRef.child('notes').on('value', s => { const v = s.val(); if(v!==null){ const ta = $('notas-ta'); if(ta) ta.value = v; updateNotasCount(); } });
  // IA assistant chat
  roomRef.child('ia_chat').on('child_added', snap => { const msg = snap.val(); if(!msg) return; appendIaMessage(msg); });
  // verdict
  roomRef.child('verdict').on('value', s=>{ const v = s.val(); if(v) renderVerdict(v); });
  // pedidos do parceiro — sincroniza campos do adversário
  roomRef.child('pedidos').on('value', s => {
    const pedidos = s.val() || {};
    const acu = $('pena-acu'); const def = $('pena-def');
    const acuTxt = $('pedido-acu-txt'); const defTxt = $('pedido-def-txt');
    if(pedidos.acu !== undefined){
      if(acu && state.myRole !== 'acusacao') acu.value = pedidos.acu;
      if(acuTxt) acuTxt.textContent = pedidos.acu || 'Aguardando...';
    }
    if(pedidos.def !== undefined){
      if(def && state.myRole !== 'defesa') def.value = pedidos.def;
      if(defTxt) defTxt.textContent = pedidos.def || 'Aguardando...';
    }
    // notificação quando ambos preencheram
    const pedidoNotif = $('pedido-notif');
    if(pedidoNotif) pedidoNotif.classList.toggle('show', Boolean(pedidos.acu && pedidos.def));
    const syncStatus = $('pedido-sync-status');
    if(syncStatus){
      if(pedidos.acu && pedidos.def) syncStatus.innerHTML = '<span class="pedido-sync-dot"></span>Ambos os pedidos registrados — vá para ⚖️ VEREDITO';
      else syncStatus.textContent = 'Aguardando o outro lado preencher...';
    }
  });
  // presence
  presenceRef = roomRef.child('presence/' + localClientId);
  presenceRef.set({ name: state.myName, role: state.myRole, ts: firebase.database.ServerValue.TIMESTAMP });
  presenceRef.onDisconnect().remove();
}

function appendChatMessage(msg){
  const container = $('chat-messages'); if(!container) return;
  // evitar duplicatas por ts+sender
  const msgId = `${msg.ts}-${msg.sender}`;
  if(container.querySelector(`[data-msgid="${msgId}"]`)) return;
  const el = document.createElement('div'); el.className = 'msg'; el.dataset.msgid = msgId;
  const isJudge = msg.type==='judge' || msg.role==='juiz';
  if(isJudge) el.classList.add('judge');
  else if(msg.sender===state.myName) el.classList.add('mine');
  else el.classList.add('theirs');
  const roleCls = msg.role==='acusacao'?'acusacao':(msg.role==='defesa'?'defesa':'');
  if(!isJudge) el.classList.add(roleCls);
  const time = new Date(msg.ts||Date.now()).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  // skip placeholder "(analisando...)"
  if(msg.text && msg.text.includes('analisando...') && isJudge) return;
  let bubbleContent = escapeHtml(msg.text||'').replace(/\n/g,'<br>');
  let header, bubble;
  if(isJudge){
    header = `<div class="msg-header"><span class="msg-role juiz">⚖️ Juiz</span><span class="msg-time">${time}</span></div>`;
    bubble = `<div class="msg-bubble">${bubbleContent}</div>`;
  } else {
    header = `<div class="msg-header"><span class="msg-role ${roleCls}">${escapeHtml(msg.sender||'')}</span><span class="msg-time">${time}</span></div>`;
    bubble = `<div class="msg-bubble">${bubbleContent}</div>`;
  }
  el.innerHTML = header + bubble;
  container.appendChild(el); container.scrollTop = container.scrollHeight;
  // notificação se não estiver na aba de chat
  const chatTab = document.querySelector('.btab[data-tab="chat"]');
  if(chatTab && !chatTab.classList.contains('active') && !isJudge){
    const notif = $('chat-notif'); if(notif) notif.classList.add('show');
  }
}

function escapeHtml(s){ return (s||'').replace(/[&<>\"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

let msgCountSinceJudge = 0;

async function sendMessage(){
  const ta = $('chat-inp'); if(!ta) return; const text = ta.value.trim(); if(!text) return;
  const moderation = moderateText(text);
  if(moderation.blocked){ showToast(`⚠️ Palavra sensível detectada: ${moderation.word}`); return; }
  ta.value=''; ta.style.height='auto';
  const msg = { sender: state.myName, role: state.myRole, text, ts: Date.now(), type:'chat' };
  if(roomRef){ await roomRef.child('chat').push(msg); }
  else { appendChatMessage(msg); }

  msgCountSinceJudge++;
  const judgeTrigger = /(?:\bjuiz\b|\bjuí?z\b|@juiz|juíza)/i;
  // chamar juiz se mencionado explicitamente OU a cada 4 mensagens automaticamente
  if(judgeTrigger.test(text) || msgCountSinceJudge >= 4){
    msgCountSinceJudge = 0;
    setTimeout(()=>requestJudge(), 600);
  }
}

async function addScore(side){ if(!roomRef) return; if(side==='acu') roomRef.child('scoreAcu').transaction(v=> (v||0)+1); else roomRef.child('scoreDef').transaction(v=> (v||0)+1); }
function resetScore(){ if(roomRef){ roomRef.child('scoreAcu').set(0); roomRef.child('scoreDef').set(0); } }

async function sendIaMsg(){ const ta = $('ia-inp'); if(!ta) return; const text = ta.value.trim(); if(!text) return;
  const moderation = moderateText(text);
  if(moderation.blocked){ showToast(`Mensagem bloqueada por moderação local: ${moderation.word}`); return; }
  ta.value='';
  const userMsg = { sender: state.myName, text, ts: Date.now(), type:'user' };
  if(roomRef){ await roomRef.child('ia_chat').push(userMsg); } else { appendIaMessage(userMsg); }
  try{
    const resp = await window.callAI?.('Assistente', text, 400, []);
    const reply = { sender:'Assistente', text: resp || 'Não foi possível obter resposta no momento.', ts: Date.now(), type:'ai' };
    if(roomRef){ await roomRef.child('ia_chat').push(reply); } else { appendIaMessage(reply); }
  }catch(e){ console.warn('assist fail', e); const errMsg = { sender:'Assistente', text:'Falha ao consultar o assistente IA. Tente novamente.', ts: Date.now(), type:'ai' }; if(roomRef){ await roomRef.child('ia_chat').push(errMsg); } else { appendIaMessage(errMsg); } }
}

async function requestJudge(){
  // collect last N messages
  const chatSnapshot = await (roomRef? roomRef.child('chat').limitToLast(50).once('value') : { val: ()=>null });
  const msgs = [];
  if(chatSnapshot && chatSnapshot.val()){ Object.values(chatSnapshot.val()).forEach(m=> msgs.push({ sender:m.sender, role:m.role, text:m.text })); }
  // local case object
  const caseObj = window.CASES && window.CASES[state.caseIdx] ? window.CASES[state.caseIdx] : { titulo:'Caso genérico', context_juiz:'' };
  // mostrar typing indicator
  const typingEl = $('typing-ind'); if(typingEl){ $('typing-who').textContent='Juiz'; typingEl.classList.add('show'); }
  try{
    // incluir pedidos de pena no contexto
    let pedidosCtx = '';
    if(roomRef){
      const pedSnap = await roomRef.child('pedidos').once('value');
      const ped = pedSnap.val() || {};
      if(ped.acu || ped.def) pedidosCtx = `\n\nPEDIDOS DE PENA — Acusação: ${ped.acu||'não informado'} / Defesa: ${ped.def||'não informado'}`;
    }
    const caseObjComPedidos = { ...caseObj, context_juiz: (caseObj.context_juiz||'') + pedidosCtx };

    if(roomRef) await roomRef.child('judge_pending').set(true);

    // 1. tenta IA inteligente via proxy/askJudge
    if(window.askJudge){
      const answer = await window.askJudge(caseObjComPedidos, msgs);
      if(roomRef){
        await roomRef.child('chat').push({ sender:'Juiz', role:'juiz', text:answer, ts:Date.now(), type:'judge' });
        await roomRef.child('verdict').set({ text: answer, ts: Date.now() });
      } else {
        appendChatMessage({ sender:'Juiz', role:'juiz', text:answer, ts:Date.now(), type:'judge' });
      }
    } else if(window.localJudgeAnalyze){
      // 2. fallback local só se askJudge não existir
      const final = await window.localJudgeAnalyze(msgs, caseObj, async (update)=>{
        try{
          const text = update?.text || '';
          const meta = update?.meta || {};
          if(roomRef){
            await roomRef.child('chat').push({ sender:'Juiz', role:'juiz', text, ts:Date.now(), type:'judge', _stage:update.stage, _meta:meta });
            if(update.stage === 'questions'){
              await roomRef.child('verdict_questions').set({ perguntas_acu: meta.perguntas_acu || [], perguntas_def: meta.perguntas_def || [] });
            }
          } else appendChatMessage({ sender:'Juiz', role:'juiz', text, ts:Date.now(), type:'judge' });
        }catch(err){ console.warn('localJudge push failed', err); }
      });
      if(roomRef) await roomRef.child('verdict').set({ text: final.text, ts: Date.now(), verdict: final.verdict });
    }

    if(roomRef) await roomRef.child('judge_pending').set(false);
    const typingEl2 = $('typing-ind'); if(typingEl2) typingEl2.classList.remove('show');
  }catch(e){
    console.error('judge request failed', e);
    const typingEl3 = $('typing-ind'); if(typingEl3) typingEl3.classList.remove('show');
    const errMsg = { sender:'Juiz', role:'juiz', text:'⚠️ Falha ao consultar o Juiz. Tente novamente clicando em ⚖️', ts:Date.now(), type:'judge' };
    if(roomRef) await roomRef.child('chat').push(errMsg); else appendChatMessage(errMsg);
  }
}

// render mais rico: inclui perguntas do juiz se existirem (salvas em verdict_questions)
async function renderVerdictRich(v){ const wrap = $('verdict-wrap'); if(!wrap) return; let questionsHtml = '';
  if(!v || !v.text){ wrap.innerHTML = `<div class="verdict-card"><div class="verdict-stamp"><div class="vs-icon">⚖️</div><div><div class="vs-label">Juiz IA</div><div class="vs-name">Aguardando veredicto</div></div></div><div class="verdict-fund">Nenhum veredito registrado ainda. Use a aba <strong>DEBATE</strong> e clique em <strong>JUIZ</strong> para iniciar a análise.</div><div style="margin-top:16px;text-align:center;"><button class="btn-primary" style="max-width:280px;margin:0 auto;" onclick="requestJudge()">⚖️ Pedir Veredicto Agora</button></div></div>`; return; }
  let q = v.questions || null;
  if(!q && roomRef){ try{ const snap = await roomRef.child('verdict_questions').once('value'); q = snap.val(); }catch(e){} }
  if(q){ const acu = (q.perguntas_acu||[]).map(p=>`<div class="art-texto">• ${escapeHtml(p)}</div>`).join(''); const def = (q.perguntas_def||[]).map(p=>`<div class="art-texto">• ${escapeHtml(p)}</div>`).join(''); questionsHtml = `<div style="margin-top:14px;"><div style="font-family:var(--mono);font-size:9px;color:var(--text3);letter-spacing:.08em;margin-bottom:8px;">// PERGUNTAS DO JUIZ</div><div class="art-strategy-block asb-acu"><div class="asb-label">Para Acusação</div>${acu||'<div class=\"art-texto\">—</div>'}</div><div class="art-strategy-block asb-def" style="margin-top:8px;"><div class="asb-label">Para Defesa</div>${def||'<div class=\"art-texto\">—</div>'}</div></div>`; }
  wrap.innerHTML = `<div class="verdict-card"><div class="verdict-stamp"><div class="vs-icon">⚖️</div><div><div class="vs-label">Juiz IA</div><div class="vs-name">Veredicto</div></div></div><div class="verdict-fund">${escapeHtml(v.text).replace(/\n/g,'<br>')}</div>${questionsHtml}<div style="margin-top:16px;text-align:center;"><button class="btn-secondary" onclick="requestJudge()" style="max-width:220px;margin:0 auto;">↺ Nova análise</button></div></div>`;
}

// backward-compatible entry
function renderVerdict(v){ renderVerdictRich(v).catch(e=>{ console.warn('renderVerdictRich failed', e); const wrap = $('verdict-wrap'); if(!wrap) return; wrap.innerHTML = `<div class="verdict-card"><div class="verdict-stamp"><div class="vs-icon">⚖️</div><div><div class="vs-label">Juiz IA</div><div class="vs-name">Veredicto</div></div></div><div class="verdict-fund">${escapeHtml(v?.text||'Nenhum veredito registrado ainda.')} </div></div>`; }); }

function renderCaseDetails(caseObj){
  if(!caseObj) return;
  $('g-tags').innerHTML = (caseObj.tags || []).map(t=>`<span class="tag ${escapeHtml(t.c||'tg')}">${escapeHtml(t.t)}</span>`).join('');
  $('g-title').innerHTML = caseObj.titulo || '';
  $('g-body').innerHTML = caseObj.corpo || caseObj.context_juiz || '';

  const contextBlock = [];
  if(caseObj.contexto_social){
    contextBlock.push(`<div class="card"><div class="section-lbl">// contexto social</div><div class="brief-body">${escapeHtml(caseObj.contexto_social)}</div></div>`);
  }
  if(caseObj.antecedentes || caseObj.antecedentes_criminais){
    contextBlock.push(`<div class="card"><div class="section-lbl">// antecedentes</div>${caseObj.antecedentes?`<div class="brief-body"><strong>Perfil social:</strong> ${escapeHtml(caseObj.antecedentes)}</div>`:''}${caseObj.antecedentes_criminais?`<div class="brief-body" style="margin-top:10px;"><strong>Antecedentes criminais:</strong> ${escapeHtml(caseObj.antecedentes_criminais)}</div>`:''}</div>`);
  }
  if(caseObj.context_juiz){
    contextBlock.push(`<div class="card"><div class="section-lbl">// resumo para o juiz</div><div class="brief-body">${escapeHtml(caseObj.context_juiz).replace(/\n/g,'<br>')}</div></div>`);
  }
  $('g-context').innerHTML = contextBlock.join('');

  const guide = $('g-guide');
  const hot = $('g-hot');
  if(guide){
    const sections = [];
    if(caseObj.perguntas_acu?.length){
      sections.push(`<div class="art-strategy-block asb-acu"><div class="asb-label">Perguntas da Acusação</div><div>${caseObj.perguntas_acu.map(p=>`<div class="art-texto">• ${escapeHtml(p)}</div>`).join('')}</div></div>`);
    }
    if(caseObj.perguntas_def?.length){
      sections.push(`<div class="art-strategy-block asb-def"><div class="asb-label">Perguntas da Defesa</div><div>${caseObj.perguntas_def.map(p=>`<div class="art-texto">• ${escapeHtml(p)}</div>`).join('')}</div></div>`);
    }
    if(caseObj.arts_rapidos?.length){
      sections.push(`<div class="art-strategy-block"><div class="asb-label">Pontos-chave</div><div>${caseObj.arts_rapidos.map(p=>`<div class="art-texto">• ${escapeHtml(p)}</div>`).join('')}</div></div>`);
    }
    guide.innerHTML = sections.join('');
  }
  if(hot){
    hot.innerHTML = (caseObj.hot||[]).map(item=>`<div class="art-texto">• ${escapeHtml(item)}</div>`).join('');
  }

  const quick = $('art-quick-row');
  if(quick){
    quick.innerHTML = (caseObj.arts_rapidos||[]).map(item=>`<button type="button" class="art-quick-pill" onclick="iaQuickAsk('Explique como usar ${escapeHtml(item)} no caso ${escapeHtml(caseObj.titulo)}')">${escapeHtml(item)}</button>`).join('');
  }

  const vadeGrid = $('vade-grid');
  if(vadeGrid){
    vadeGrid.innerHTML = (caseObj.vade||[]).map(item => {
      const roleText = state.myRole==='acusacao' ? item.use_acu : item.use_def;
      return `<div class="art-card" onclick="toggleArtCard(this)"><div class="art-header"><div class="art-header-content"><div class="art-name">${escapeHtml(item.nome)}</div><div class="art-pena">${escapeHtml(item.pena||'')}</div></div><div class="art-chevron">›</div></div><div class="art-body"><div class="art-texto">${escapeHtml(item.texto)}</div><div class="art-exp">${escapeHtml(item.exp||'')}</div><div class="art-juris">${escapeHtml(item.juris||'')}</div><div class="art-simple"><div class="art-simple-lbl">Estratégia para ${state.myRole==='acusacao'?'Acusação':'Defesa'}</div><div class="art-simple-txt">${escapeHtml(roleText||'')}</div></div></div></div>`;
    }).join('');
  }
  initializeCalcPanel(caseObj);
}

function toggleArtCard(el){ const card = el.closest('.art-card'); if(!card) return; card.classList.toggle('expanded'); }
function appendIaMessage(msg){ const container = $('ia-chat-msgs'); if(!container) return; const el = document.createElement('div'); el.className = `ia-msg ${msg.type==='ai' ? 'ai' : 'user'}`; el.innerHTML = `<div class="ia-msg-sender">${escapeHtml(msg.sender)}</div><div class="ia-msg-bubble">${escapeHtml(msg.text).replace(/\n/g,'<br>')}</div>`; container.appendChild(el); container.scrollTop = container.scrollHeight; }
function updateNotasCount(){ const ta = $('notas-ta'); if(!ta) return; const chars = ta.value.length; const label = $('notas-chars'); if(label) label.textContent = `${chars} caracteres`; }

function launchGame(){
  document.getElementById('s-lobby').classList.remove('active'); document.getElementById('s-game').classList.add('active');
  showTab('caso');
  showNotasTab('pad');
  const caseObj = window.CASES && window.CASES[state.caseIdx];
  if(caseObj){ renderCaseDetails(caseObj); }
  updateNotasCount();
  renderJudgeQuestions();
  // inicializar veredito com estado vazio (mostra botão de pedir)
  renderVerdict(null);
  $('gtb-title').textContent = `Sala ${state.roomCode} • ${caseObj?caseObj.nome:''}`;
  $('gtb-role-txt').textContent = state.myRole==='acusacao'?'ACUSAÇÃO':'DEFESA';
  const badge = $('gtb-badge');
  if(badge) badge.className = `gtb-badge ${state.myRole}`;
}

function selectCase(i){ if(window.CASES){ state.caseIdx = i; document.querySelectorAll('.case-chip').forEach((el,j)=>el.classList.toggle('active',j===i)); const caseObj = window.CASES[i]; if(caseObj){ renderCaseDetails(caseObj); const title = $('gtb-title'); if(title) title.textContent = `Sala ${state.roomCode} • ${caseObj.nome}`; } }}

function selectRole(r){ state.createRole = r; document.getElementById('rc-acu')?.classList.toggle('sel', r==='acusacao'); document.getElementById('rc-def')?.classList.toggle('sel', r==='defesa'); }

function selectJoinRole(r){ state.joinRole = r; document.getElementById('rj-acu')?.classList.toggle('sel', r==='acusacao'); document.getElementById('rj-def')?.classList.toggle('sel', r==='defesa'); }

// expose helpers to global scope for inline handlers
window.createRoom = createRoom; window.joinRoom = joinRoom; window.startAnySolo = startAnySolo; window.sendMessage = sendMessage; window.addScore = addScore; window.resetScore = resetScore; window.requestJudge = requestJudge; window.launchGame = launchGame; window.selectCase = selectCase; window.selectRole = selectRole; window.selectJoinRole = selectJoinRole; window.initLobby = initLobby; window.selectJudgeQuestion = selectJudgeQuestion; window.clearJudgeQuestionSelection = clearJudgeQuestionSelection; window.submitJudgeAnswer = submitJudgeAnswer; window.toggleArtCard = toggleArtCard;

// init on DOM ready
window.addEventListener('DOMContentLoaded', ()=>{ initUI(); initFirebase(); });

// Additional global handlers expected by inline HTML
function backToLobby(){
  document.getElementById('s-game').classList.remove('active'); document.getElementById('s-lobby').classList.add('active');
  if(roomRef) { roomRef.off(); roomRef = null; }
}

function showTab(tab){ 
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id===`tab-${tab}`)); 
  document.querySelectorAll('.btab').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  if(tab==='chat'){ const notif=$('chat-notif'); if(notif) notif.classList.remove('show'); const msgs=$('chat-messages'); if(msgs) msgs.scrollTop=msgs.scrollHeight; }
  if(tab==='veredito'){ renderVerdict(null); if(roomRef){ roomRef.child('verdict').once('value').then(s=>{ const v=s.val(); if(v) renderVerdict(v); }).catch(()=>{}); } }
}

function onChatInput(){ const ta = $('chat-inp'); if(ta) ta.style.height = 'auto'; if(ta) ta.style.height = Math.min(120, ta.scrollHeight)+'px'; }
function onChatKey(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); } }
function onIaInpInput(){ const ta = $('ia-inp'); if(ta) ta.style.height='auto'; if(ta) ta.style.height = Math.min(120, ta.scrollHeight)+'px'; }
function onIaInpKey(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendIaMsg(); } }

function onNotasInput(){ const ta = $('notas-ta'); if(!ta) return; updateNotasCount(); if(roomRef) roomRef.child('notes').set(ta.value); }
function clearNotas(){ const ta = $('notas-ta'); if(ta) ta.value=''; if(roomRef) roomRef.child('notes').set(''); }

function iaQuickAsk(q){ const ta = $('ia-inp'); if(!ta) return; ta.value = q; sendIaMsg(); }

// Expose simple handlers globally
window.backToLobby = backToLobby; window.showTab = showTab; window.onChatInput = onChatInput; window.onChatKey = onChatKey; window.onIaInpInput = onIaInpInput; window.onIaInpKey = onIaInpKey; window.onNotasInput = onNotasInput; window.clearNotas = clearNotas; window.iaQuickAsk = iaQuickAsk; window.calcPena = calcPena; window.toggleCalcFactor = toggleCalcFactor;

function showNotasTab(tab){ document.getElementById('notas-panel-pad').classList.toggle('active', tab==='pad'); document.getElementById('notas-panel-ia').classList.toggle('active', tab==='ia'); document.querySelectorAll('.notas-tab').forEach(b=>b.classList.toggle('active', b.textContent.includes(tab==='pad'?'ANOTAÇÕES':'ASSISTENTE'))); }

function clearReply(){ const rb = $('reply-banner'); if(rb){ rb.classList.remove('show'); $('reply-banner-text').textContent=''; } }
window.showNotasTab = showNotasTab; window.clearReply = clearReply;

function onPedidoInput(side){ const el = side==='acu' ? $('pena-acu') : $('pena-def'); const txt = el ? el.value.trim() : ''; if(side==='acu') $('pedido-acu-txt').textContent = txt||'Aguardando...'; else $('pedido-def-txt').textContent = txt||'Aguardando...'; if(roomRef){ roomRef.child('pedidos').update({ [side]: txt }); } }
window.onPedidoInput = onPedidoInput;
