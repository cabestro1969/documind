/**
 * app.js — Frontend Documind RAG + Web Agent
 */

// ── Estado ────────────────────────────────────────────────────
const state = {
  sessionId:   `s_${Date.now()}`,
  docs:        [],
  processing:  false,
  chatting:    false,
  sidebarOpen: window.innerWidth > 680,
};

// ── DOM ───────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const dropZone    = $('dropZone');
const dropContent = $('dropContent');
const dropProc    = $('dropProc');
const procStep    = $('procStep');
const fileInput   = $('fileInput');
const docList     = $('docList');
const messages    = $('messages');
const welcome     = $('welcome');
const msgInput    = $('msgInput');
const sendBtn     = $('sendBtn');
const statusDot   = $('statusDot');
const statusTxt   = $('statusTxt');
const modelBadge  = $('modelBadge');
const stChunks    = $('stChunks');
const stDocs      = $('stDocs');
const toastEl     = $('toast');
const sidebar     = $('sidebar');

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupDragDrop();
  fileInput.addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; });
  await refreshStats();
  if (!state.sidebarOpen) sidebar.classList.add('hidden');
});

// ── Drag & Drop ───────────────────────────────────────────────
function setupDragDrop() {
  ['dragenter','dragover','dragleave','drop'].forEach((e) => document.addEventListener(e, (ev) => ev.preventDefault()));
  dropZone.addEventListener('dragenter',  ()  => dropZone.classList.add('drag-over'));
  dropZone.addEventListener('dragleave',  (e) => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop',       (e) => { dropZone.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });
  dropZone.addEventListener('click',      ()  => { if (!state.processing) fileInput.click(); });
}

// ── Upload PDF ────────────────────────────────────────────────
async function handleFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.pdf')) { showToast('Solo se admiten PDFs', 'err'); return; }
  if (file.size > 20 * 1024 * 1024)              { showToast('Archivo demasiado grande (máx 20MB)', 'err'); return; }
  if (state.processing)                           { showToast('Ya hay un PDF procesándose', 'err'); return; }

  state.processing = true;
  showDropProcessing(true);
  setStatus('indexando', 'busy');

  const steps = ['Extrayendo texto…', 'Dividiendo en fragmentos…', 'Generando embeddings…', 'Indexando…'];
  let si = 0;
  const interval = setInterval(() => { if (si < steps.length) procStep.textContent = steps[si++]; }, 900);

  const fd = new FormData();
  fd.append('pdf', file);

  try {
    const res  = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al procesar');

    state.docs.push({ name: data.filename, chunks: data.chunks, pages: data.stats?.totalFiles });
    renderDocList();
    await refreshStats();
    addSysMsg(`📄 **${data.filename}** indexado — ${data.chunks} fragmentos`);
    showToast(`✓ ${data.filename} listo`, 'ok');
  } catch (e) {
    showToast(e.message, 'err');
  } finally {
    clearInterval(interval);
    state.processing = false;
    showDropProcessing(false);
    setStatus('listo', '');
  }
}

// ── Enviar mensaje ────────────────────────────────────────────
async function sendMessage() {
  const q = msgInput.value.trim();
  if (!q || state.chatting) return;

  welcome?.remove();
  addMessage('user', q);
  msgInput.value = '';
  msgInput.style.height = 'auto';

  state.chatting = true;
  sendBtn.disabled = true;
  setStatus('agente activo', 'busy');

  const typingId = addTyping();

  try {
    const res  = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ question: q, sessionId: state.sessionId, useAgent: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');

    removeTyping(typingId);
    addBotMessage(data);
  } catch (e) {
    removeTyping(typingId);
    addMessage('bot', `⚠️ ${e.message}`, null, true);
    showToast(e.message, 'err');
  } finally {
    state.chatting  = false;
    sendBtn.disabled = false;
    setStatus('listo', '');
  }
}

// ── Renderizar mensaje bot con fuentes ────────────────────────
function addBotMessage(data) {
  const row = document.createElement('div');
  row.className = 'msg-row';

  const avatar = document.createElement('div');
  avatar.className = 'avatar bot';
  avatar.innerHTML = `<svg width="15" height="15" fill="none" stroke="white" stroke-width="1.8" viewBox="0 0 24 24">
    <rect x="3" y="11" width="18" height="10" rx="2"/>
    <path d="M12 11V7"/><circle cx="12" cy="5" r="2"/>
    <circle cx="8" cy="16" r="1" fill="white" stroke="none"/>
    <circle cx="12" cy="16" r="1" fill="white" stroke="none"/>
    <circle cx="16" cy="16" r="1" fill="white" stroke="none"/>
  </svg>`;

  const body = document.createElement('div');
  body.style.maxWidth = 'min(78%, 660px)';

  // Badges de fuentes
  if (data.ragSources?.length > 0 || data.usedWeb) {
    const badges = document.createElement('div');
    badges.className = 'src-badges';
    if (data.ragSources?.length > 0) {
      const b = document.createElement('span');
      b.className = 'src-badge';
      b.textContent = `📄 ${data.ragSources.length} fragmentos del doc`;
      badges.appendChild(b);
    }
    if (data.usedWeb) {
      const b = document.createElement('span');
      b.className = 'src-badge web';
      b.textContent = `🌐 Web: "${data.searchQuery}"`;
      badges.appendChild(b);
    }
    body.appendChild(badges);
  }

  // Burbuja de respuesta
  const bubble = document.createElement('div');
  bubble.className = 'bubble-bot';
  bubble.textContent = data.answer;
  body.appendChild(bubble);

  // Pasos del agente (colapsable)
  if (data.agentSteps?.length > 0) {
    const steps = document.createElement('div');
    steps.className = 'agent-steps';
    steps.style.display = 'none';
    data.agentSteps.forEach((s) => {
      const d = document.createElement('div');
      d.className = 'agent-step';
      d.textContent = s;
      steps.appendChild(d);
    });

    const toggle = document.createElement('button');
    toggle.className = 'src-toggle';
    toggle.textContent = `▸ ${data.agentSteps.length} pasos del agente`;
    toggle.onclick = () => {
      const open = steps.style.display !== 'none';
      steps.style.display = open ? 'none' : 'flex';
      toggle.textContent = `${open ? '▸' : '▾'} ${data.agentSteps.length} pasos del agente`;
    };
    body.appendChild(toggle);
    body.appendChild(steps);
  }

  // Fuentes (colapsable)
  const totalSrc = (data.ragSources?.length || 0) + (data.webSources?.length || 0);
  if (totalSrc > 0) {
    const srcList = document.createElement('div');
    srcList.className = 'src-list';
    srcList.style.display = 'none';

    data.ragSources?.forEach((s) => {
      const chip = document.createElement('div');
      chip.className = 'src-chip';
      chip.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="src-file">📄 ${s.filename} <span class="src-score">${s.score}%</span></div>
          <div class="src-prev">${s.preview}</div>
        </div>`;
      srcList.appendChild(chip);
    });

    data.webSources?.forEach((s) => {
      const chip = document.createElement('div');
      chip.className = 'src-chip web';
      chip.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="src-file web">🌐 ${s.title || s.url || 'Web'}</div>
          ${s.url ? `<div class="src-prev" style="font-size:.6rem;color:#1e4a5a">${s.url}</div>` : ''}
        </div>`;
      srcList.appendChild(chip);
    });

    const toggle = document.createElement('button');
    toggle.className = 'src-toggle';
    toggle.textContent = `▸ ${totalSrc} fuentes consultadas`;
    toggle.onclick = () => {
      const open = srcList.style.display !== 'none';
      srcList.style.display = open ? 'none' : 'flex';
      toggle.textContent = `${open ? '▸' : '▾'} ${totalSrc} fuentes consultadas`;
    };
    body.appendChild(toggle);
    body.appendChild(srcList);
  }

  row.appendChild(avatar);
  row.appendChild(body);
  messages.appendChild(row);
  scrollBottom();
}

// ── Mensaje genérico ──────────────────────────────────────────
function addMessage(role, text, sources, error = false) {
  const row = document.createElement('div');
  row.className = `msg-row ${role}`;

  const avatar = document.createElement('div');
  avatar.className = `avatar ${role === 'bot' ? 'bot' : ''}`;
  avatar.textContent = role === 'user' ? 'TÚ' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = role === 'user' ? 'bubble-user' : `bubble-bot${error ? ' bubble-err' : ''}`;
  bubble.textContent = text;
  bubble.style.maxWidth = 'min(78%, 660px)';

  if (role === 'user') { row.appendChild(avatar); row.appendChild(bubble); }
  else                 { row.appendChild(avatar); row.appendChild(bubble); }

  messages.appendChild(row);
  scrollBottom();
}

function addSysMsg(text) {
  const d = document.createElement('div');
  d.className = 'sys-msg';
  d.textContent = text.replace(/\*\*/g, '');
  messages.appendChild(d);
  scrollBottom();
}

let typingCounter = 0;
function addTyping() {
  const id = `t${++typingCounter}`;
  const row = document.createElement('div');
  row.id = id; row.className = 'msg-row';
  row.innerHTML = `
    <div class="avatar bot">AI</div>
    <div class="bubble-bot"><div class="typing"><span></span><span></span><span></span></div></div>`;
  messages.appendChild(row);
  scrollBottom();
  return id;
}
function removeTyping(id) { $(`${id}`)?.remove(); }

// ── Doc list ──────────────────────────────────────────────────
function renderDocList() {
  docList.innerHTML = '';
  state.docs.forEach((doc, i) => {
    const d = document.createElement('div');
    d.className = 'doc-item';
    d.innerHTML = `
      <span style="font-size:17px">📄</span>
      <div style="flex:1;min-width:0">
        <div class="doc-name" title="${doc.name}">${doc.name}</div>
        <div class="doc-meta">${doc.chunks} frags</div>
      </div>
      <button class="del-btn" onclick="removeDoc(${i})">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
        </svg>
      </button>`;
    docList.appendChild(d);
  });
}

async function removeDoc(i) {
  const doc = state.docs[i];
  if (!doc) return;
  try {
    await fetch(`/api/docs/${encodeURIComponent(doc.name)}`, { method: 'DELETE' });
    state.docs.splice(i, 1);
    renderDocList();
    await refreshStats();
    addSysMsg(`🗑️ "${doc.name}" eliminado`);
  } catch { showToast('Error al eliminar', 'err'); }
}

// ── Stats ─────────────────────────────────────────────────────
async function refreshStats() {
  try {
    const data = await fetch('/api/stats').then((r) => r.json());
    stChunks.textContent   = data.totalChunks;
    stDocs.textContent     = data.totalFiles;
    modelBadge.textContent = `Claude Sonnet · RAG + Web · ${data.totalChunks} chunks`;
  } catch { /* silencioso */ }
}

// ── Helpers ───────────────────────────────────────────────────
function newSession() {
  state.sessionId = `s_${Date.now()}`;
  messages.querySelectorAll('.msg-row, .sys-msg').forEach((el) => el.remove());
  if (!$('welcome')) {
    const w = document.createElement('div');
    w.id = 'welcome'; w.className = 'welcome';
    w.innerHTML = `
      <span class="w-badge">◈ RAG + Web Agent</span>
      <h1 class="w-title">Tu asistente que<br><span class="grad">piensa y busca</span></h1>
      <p class="w-sub">Nueva sesión iniciada. ¡Haz una pregunta!</p>`;
    messages.prepend(w);
  }
  fetch(`/api/session/${state.sessionId}`, { method: 'DELETE' }).catch(() => {});
}

function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  sidebar.classList.toggle('hidden', !state.sidebarOpen);
}

function setStatus(text, type) {
  statusTxt.textContent = text;
  statusDot.className   = `status-dot${type ? ' ' + type : ''}`;
}

function showDropProcessing(show) {
  dropContent.style.display = show ? 'none' : 'flex';
  dropProc.style.display    = show ? 'flex' : 'none';
}

function scrollBottom() {
  setTimeout(() => { messages.scrollTop = messages.scrollHeight; }, 50);
}

function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 150) + 'px';
}

let toastTimer;
function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className   = `toast show${type ? ' ' + type : ''}`;
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}
