// app.js — integração básica, fallback para LocalJudge
let geminiKey = localStorage.getItem('tribunal_gemini_key') || '';
const CASES = [
  { id:'01', titulo:'O Furto do Mercado', context_juiz:'Marcos arrombou um mercado às 2h e levou R$127 para filho doente.', penaMin:1, penaMax:8, arts_rapidos:['Art.155 CP','Art.24 CP','Art.44 CP'] },
  { id:'02', titulo:'A Noite que Diego Voltou', context_juiz:'Renata esfaqueou ex-marido após histórico de violência.', penaMin:6, penaMax:20, arts_rapidos:['Art.25 CP','Art.20 §1º','Art.121 §1º'] }
];
let state = { caseIdx:0, messages:[] };

function init(){
  document.getElementById('btn-save-key').addEventListener('click', saveKey);
  document.getElementById('btn-send').addEventListener('click', onSend);
  document.getElementById('btn-judge').addEventListener('click', onAskJudge);
  document.getElementById('inp-apikey').value = geminiKey;
  renderCase();
}

function saveKey(){
  const v = document.getElementById('inp-apikey').value.trim();
  geminiKey = v; if(v) localStorage.setItem('tribunal_gemini_key', v); else localStorage.removeItem('tribunal_gemini_key');
  updateKeyStatus();
}
function updateKeyStatus(){
  const box = document.getElementById('apikey-status');
  if(!geminiKey) box.textContent = 'Chave não configurada — fallback local ativo.'; else box.textContent = 'Chave configurada (será usada quando válida).';
}

function renderCase(){
  const c = CASES[state.caseIdx];
  document.getElementById('case-title').textContent = `Caso: ${c.titulo}`;
  document.getElementById('case-body').textContent = c.context_juiz;
}

function appendMessage(role, sender, text){
  const el = document.createElement('div'); el.className = 'message';
  if(role==='mine') el.classList.add('mine');
  if(role==='judge') el.classList.add('judge');
  el.innerHTML = `<div><strong>${sender}</strong></div><div>${text}</div>`;
  document.getElementById('chat-messages').appendChild(el);
  document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
}

function onSend(){
  const ta = document.getElementById('chat-inp'); const text = ta.value.trim(); if(!text) return; ta.value='';
  const msg = { type:'msg', role:'acusacao', sender:'Você', text };
  state.messages.push(msg); appendMessage('mine','Você',text);
}

async function onAskJudge(){
  appendMessage('judge','Juiz','(analisando...)');
  // Attempt to call Gemini API, but handle quota/429 errors gracefully
  try{
    const resp = await callClaudeIfAvailable(CASES[state.caseIdx], state.messages);
    // remove last analyzing placeholder
    const msgs = document.getElementById('chat-messages'); msgs.removeChild(msgs.lastChild);
    appendMessage('judge','Juiz',resp);
  }catch(e){
    // fallback to local judge
    const msgs = document.getElementById('chat-messages'); if(msgs.lastChild) msgs.removeChild(msgs.lastChild);
    const local = LocalJudge.generateIntervention(CASES[state.caseIdx], state.messages);
    appendMessage('judge','Juiz (local)', local.text + `\n\n(placar simulado: ${local.score.acusacao}×${local.score.defesa})`);
  }
}

async function callClaudeIfAvailable(caseObj, messages){
  if(!geminiKey) throw new Error('Sem chave');
  // Build request similar to original — simplified
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
  const system = `Você é o Dr. Augusto Melo, juiz federal criminal. Analise o caso e responda de forma direta.`;
  const debate = messages.map(m=>`${m.sender} (${m.role}): ${m.text}`).join('\n')||'Nenhum argumento.';
  const body = { system_instruction:{parts:[{text:system}]}, contents:[{role:'user',parts:[{text:`CASO: ${caseObj.titulo}\n${caseObj.context_juiz}\n\nDEBATE:\n${debate}\n\nDê uma intervenção curta e direta.`}]}], generationConfig:{maxOutputTokens:500,temperature:0.8} };
  const resp = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  if(!resp.ok){
    const txt = await resp.text();
    // detect quota or 429
    throw new Error(`API error: ${resp.status} ${txt}`);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data);
  return text;
}

window.addEventListener('DOMContentLoaded', ()=>{ init(); updateKeyStatus(); });
