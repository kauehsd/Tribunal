// modules/case_view.js — abas CASO (dossiê), VADE (artigos) e PENA (calculadora)
import { $, escapeHtml, ROLE_LABEL, otherRole } from './util.js';
import { applyGlossary } from '../data/glossario.js';

// ── Aba CASO ──────────────────────────────────────────────────────────────
export function renderCase(c, dossie, role, nivel){
  $('g-tags').innerHTML = (c.tags || []).map(t=>`<span class="tag ${escapeHtml(t.c||'tg')}">${escapeHtml(t.t)}</span>`).join('');
  $('g-title').textContent = c.titulo || '';
  $('g-body').innerHTML = c.corpo || escapeHtml(c.context_juiz || ''); // corpo é HTML escrito por nós em data/cases.js

  const segredos = role === 'acusacao' ? dossie.segredo_acu : dossie.segredo_def;
  const dicas = role === 'acusacao' ? dossie.dicas_acu : dossie.dicas_def;
  const blocks = [];
  if(segredos?.length) blocks.push(`<div class="card secret-card"><div class="section-lbl">🔒 só você sabe (${ROLE_LABEL[role]})</div>${segredos.map(s=>`<div class="brief-body">• ${escapeHtml(s)}</div>`).join('')}<div class="secret-note">Na vida real, cada lado tem informações que o outro não tem. Use com estratégia — ou guarde para a hora certa.</div></div>`);
  if(nivel === 'estagiario' && dicas?.length) blocks.push(`<div class="card tip-card"><div class="section-lbl">💡 dicas de estagiário</div>${dicas.map(d=>`<div class="brief-body">• ${escapeHtml(d)}</div>`).join('')}</div>`);

  blocks.push(`<div class="card"><div class="section-lbl">// quem vai depor</div><div class="wit-list">${dossie.testemunhas.map(t=>`
    <div class="wit-mini"><span class="wit-emoji">${t.emoji}</span><div><div class="wit-name">${escapeHtml(t.nome)}</div><div class="wit-role">${escapeHtml(t.papel_txt)} · arrolada pela ${t.arrolada_por === 'juizo' ? 'lei (interrogatório)' : ROLE_LABEL[t.arrolada_por].toLowerCase()}</div><div class="wit-profile">${escapeHtml(t.perfil)}</div></div></div>`).join('')}</div></div>`);

  if(c.contexto_social) blocks.push(`<div class="card"><div class="section-lbl">// contexto social</div><div class="brief-body">${escapeHtml(c.contexto_social)}</div></div>`);
  if(c.antecedentes || c.antecedentes_criminais){
    blocks.push(`<div class="card"><div class="section-lbl">// antecedentes</div>${c.antecedentes?`<div class="brief-body"><strong>Perfil social:</strong> ${escapeHtml(c.antecedentes)}</div>`:''}${c.antecedentes_criminais?`<div class="brief-body" style="margin-top:10px;"><strong>Antecedentes criminais:</strong> ${escapeHtml(c.antecedentes_criminais)}</div>`:''}</div>`);
  }
  if(c.provas?.length) blocks.push(`<div class="card"><div class="section-lbl">// provas nos autos</div><div class="brief-body">${c.provas.map(p=>`<div style="margin-bottom:6px;">• ${escapeHtml(p)}</div>`).join('')}</div><div id="g-provas-novas"></div></div>`);
  if(c.linha_tempo?.length) blocks.push(`<div class="card"><div class="section-lbl">// linha do tempo</div><div class="brief-body">${c.linha_tempo.map(e=>`<div style="margin-bottom:5px;"><strong style="color:var(--gold2);">${escapeHtml(e.hora||e.data||'')}</strong> — ${escapeHtml(e.fato)}</div>`).join('')}</div></div>`);
  $('g-context').innerHTML = blocks.join('');

  const mine = role === 'acusacao' ? c.perguntas_acu : c.perguntas_def;
  const sections = [];
  if(mine?.length) sections.push(`<div class="art-strategy-block ${role==='acusacao'?'asb-acu':'asb-def'}"><div class="asb-label">Perguntas para a sua estratégia</div><div>${mine.map(p=>`<div class="art-texto">• ${escapeHtml(p)}</div>`).join('')}</div></div>`);
  if(c.arts_rapidos?.length) sections.push(`<div class="art-strategy-block"><div class="asb-label">Pontos-chave</div><div>${c.arts_rapidos.map(p=>`<div class="art-texto">• ${escapeHtml(p)}</div>`).join('')}</div></div>`);
  $('g-guide').innerHTML = sections.join('');
  $('g-hot').innerHTML = (c.hot || []).map(item=>`<div class="art-texto">• ${escapeHtml(item)}</div>`).join('');
  applyGlossary($('tab-caso'));

  renderVade(c, role, nivel);
  initializeCalcPanel(c);
}

// Provas que surgiram durante o processo (diligências e reviravolta)
export function renderNewEvidence(items){
  const el = $('g-provas-novas'); if(!el) return;
  el.innerHTML = items.length ? `<div class="section-lbl" style="margin-top:12px;color:var(--gold2);">// provas novas no processo</div>${items.map(p=>`<div class="brief-body new-proof">🆕 ${escapeHtml(p)}</div>`).join('')}` : '';
}

// ── Aba VADE ──────────────────────────────────────────────────────────────
function renderVade(c, role, nivel){
  const myLabel = ROLE_LABEL[role], oppLabel = ROLE_LABEL[otherRole(role)];
  $('vade-grid').innerHTML = (c.vade || []).map(item => {
    const myText = role === 'acusacao' ? item.use_acu : item.use_def;
    const oppText = role === 'acusacao' ? item.use_def : item.use_acu;
    // texto/exp vêm de data/cases.js (conteúdo nosso, com <em> etc.)
    return `<div class="art-card ${nivel === 'estagiario' ? 'expanded' : ''}" onclick="this.classList.toggle('expanded')">
      <div class="art-header"><div class="art-header-content"><div class="art-num-badge">${escapeHtml(item.num||'')}</div><div class="art-name">${escapeHtml(item.nome)}</div><div class="art-pena">${escapeHtml(item.pena||'')}</div></div><div class="art-chevron">›</div></div>
      <div class="art-body">
        ${item.simple?`<div class="art-simple"><div class="art-simple-lbl">💡 em linguagem simples</div><div class="art-simple-txt">${item.simple}</div></div>`:''}
        <div class="art-texto-label">// texto legal</div><div class="art-texto">${item.texto || ''}</div>
        <div class="art-exp-label">// o que isso significa na prática</div><div class="art-exp">${item.exp || ''}</div>
        <div class="art-strategy-block asb-mine"><div class="asb-label">Como a ${myLabel} usa isso</div><div class="art-simple-txt">${myText || ''}</div></div>
        <div class="art-strategy-block asb-opp"><div class="asb-label">Como a ${oppLabel} pode responder</div><div class="art-simple-txt">${oppText || ''}</div></div>
        ${item.juris?`<div class="art-juris">📚 ${escapeHtml(item.juris)} <span style="color:var(--text3);font-size:9px;">${escapeHtml(item.ref||'')}</span></div>`:''}
      </div></div>`;
  }).join('');
  applyGlossary($('vade-grid'));
}

// ── Aba PENA (calculadora de dosimetria) ─────────────────────────────────
let currentCalcCase = null;
const selectedAgg = new Set();
const selectedMaj = new Set();

function parsePenaEf(effect){
  if(!effect) return 0;
  const text = String(effect).trim();
  if(/qualifica/i.test(text)) return text.startsWith('-') ? -2 : 2;
  const frac = text.match(/([+-]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if(frac) return Number(frac[1]) / Number(frac[2]);
  const num = text.match(/([+-]?\d+(?:\.\d+)?)/);
  return num ? Number(num[1]) : 0;
}
function roundPena(v){ return Math.round((v + Number.EPSILON) * 100) / 100; }

function updateCalcDisplay(){
  const c = currentCalcCase; if(!c) return;
  const slider = $('sl-pb'); if(!slider) return;
  const min = Number(c.penaMin || 0), max = Number(c.penaMax || min);
  const base = min + (max - min) * (Number(slider.value) / 100);
  const agg = [...selectedAgg].reduce((s, i) => s + parsePenaEf(c.agravantes?.[i]?.ef), 0);
  const maj = [...selectedMaj].reduce((s, i) => s + parsePenaEf(c.majorantes?.[i]?.ef), 0);
  const total = Math.max(0, base + agg + maj);
  const regime = total <= 4 ? 'Provável regime: aberto' : total <= 8 ? 'Provável regime: semiaberto' : 'Provável regime: fechado';
  $('calc-big').innerHTML = `${roundPena(total)}<span> anos</span>`;
  $('calc-regime').textContent = regime;
  $('regime-txt').textContent = `${regime}. Regra do Art. 33 §2º CP (réu não reincidente): até 4 anos → aberto; de 4 a 8 → semiaberto; acima de 8 → fechado. Pena até 4 anos, sem violência, pode virar prestação de serviços (Art. 44).`;
  $('ph1').textContent = `${roundPena(base)} anos`;
  $('ph2').textContent = `${roundPena(base + agg)} anos`;
  $('ph3').textContent = `${roundPena(total)} anos`;
  $('sl-val').textContent = `${Math.round(Number(slider.value))}%`;
}

function initializeCalcPanel(c){
  currentCalcCase = c;
  selectedAgg.clear(); selectedMaj.clear();
  const row = (section, item, i) => `<button type="button" class="chk-item" data-section="${section}" data-index="${i}"><div class="chk-box"></div><div><div class="chk-lbl">${escapeHtml(item.t)}</div><div class="chk-ef">${escapeHtml(item.ef)}</div></div></button>`;
  $('chk-agg').innerHTML = (c.agravantes||[]).map((it,i)=>row('agg', it, i)).join('') || '<div class="msg">Nenhum agravante registrado.</div>';
  $('chk-maj').innerHTML = (c.majorantes||[]).map((it,i)=>row('maj', it, i)).join('') || '<div class="msg">Nenhum fator adicional registrado.</div>';
  document.querySelectorAll('#tab-calc .chk-item').forEach(btn => btn.addEventListener('click', () => {
    const set = btn.dataset.section === 'agg' ? selectedAgg : selectedMaj;
    const i = Number(btn.dataset.index);
    if(set.has(i)) set.delete(i); else set.add(i);
    btn.classList.toggle(btn.dataset.section === 'agg' ? 'on-agg' : 'on-ate', set.has(i));
    updateCalcDisplay();
  }));
  const slider = $('sl-pb');
  if(slider){ slider.value = 50; slider.oninput = updateCalcDisplay; }
  updateCalcDisplay();
}
