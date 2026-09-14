const CONFIG_KEY = 'umaFactorLedger:githubConfig';
const DATA_PATH = 'data/factors.json';

class ConflictError extends Error {
  constructor() {
    super('conflict');
    this.name = 'ConflictError';
  }
}

let config = loadConfig();
let currentSha = null;
let allEntries = [];
let currentImageBase64 = null;
let currentImageMediaType = null;

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function persistConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}
function clearStoredConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

function contentsApiUrl() {
  return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${DATA_PATH}`;
}
function contentsApiUrlForGet() {
  const url = contentsApiUrl();
  return config.branch ? `${url}?ref=${encodeURIComponent(config.branch)}` : url;
}
function authHeaders() {
  return {
    'Authorization': `Bearer ${config.token}`,
    'Accept': 'application/vnd.github+json',
  };
}

function decodeBase64Utf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}
function encodeUtf8Base64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

async function fetchFactorsRaw() {
  const res = await fetch(contentsApiUrlForGet(), { headers: authHeaders() });
  if (res.status === 404) {
    return { sha: null, entries: [] };
  }
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.message || `GitHub APIエラー: ${res.status}`);
  }
  const json = await res.json();
  let entries = [];
  try {
    entries = JSON.parse(decodeBase64Utf8(json.content));
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }
  return { sha: json.sha, entries };
}

async function saveEntriesToGitHub(newEntries, commitMessage) {
  const latest = await fetchFactorsRaw();
  currentSha = latest.sha;

  const body = {
    message: commitMessage,
    content: encodeUtf8Base64(JSON.stringify(newEntries, null, 2)),
  };
  if (config.branch) body.branch = config.branch;
  if (currentSha) body.sha = currentSha;

  const res = await fetch(contentsApiUrl(), {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    throw new ConflictError();
  }
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.message || `GitHub APIエラー: ${res.status}`);
  }
  const json = await res.json();
  currentSha = json.content ? json.content.sha : null;
}

// --- settings panel ---
const cfgOwner = document.getElementById('cfgOwner');
const cfgRepo = document.getElementById('cfgRepo');
const cfgBranch = document.getElementById('cfgBranch');
const cfgToken = document.getElementById('cfgToken');
const cfgSaveBtn = document.getElementById('cfgSaveBtn');
const cfgClearBtn = document.getElementById('cfgClearBtn');

function fillConfigForm() {
  if (!config) return;
  cfgOwner.value = config.owner || '';
  cfgRepo.value = config.repo || '';
  cfgBranch.value = config.branch || '';
  cfgToken.value = config.token || '';
}

function setCfgStatus(msg, isError) {
  const el = document.getElementById('cfgStatus');
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
}

cfgSaveBtn.addEventListener('click', async () => {
  const owner = cfgOwner.value.trim();
  const repo = cfgRepo.value.trim();
  const branch = cfgBranch.value.trim();
  const token = cfgToken.value.trim();
  if (!owner || !repo || !token) {
    setCfgStatus('リポジトリ所有者・リポジトリ名・トークンは必須です。', true);
    return;
  }
  config = { owner, repo, branch, token };
  persistConfig(config);
  setCfgStatus('保存しました。読み込んでいます…');
  await loadEntries();
  setCfgStatus('接続しました。');
});

cfgClearBtn.addEventListener('click', () => {
  config = null;
  clearStoredConfig();
  cfgOwner.value = '';
  cfgRepo.value = '';
  cfgBranch.value = '';
  cfgToken.value = '';
  allEntries = [];
  currentSha = null;
  renderEntries();
  setCfgStatus('設定を消去しました。');
});

document.getElementById('refreshBtn').addEventListener('click', () => loadEntries());

function addFactorLine(listId, name, level) {
  const list = document.getElementById(listId);
  const row = document.createElement('div');
  row.className = 'factor-row';
  row.innerHTML = `
    <input type="text" class="fname" placeholder="因子名" value="${escapeAttr(name||'')}">
    <input type="number" class="flevel" min="0" max="3" placeholder="Lv" value="${level||''}">
    <button type="button" class="remove-line" aria-label="削除">×</button>
  `;
  row.querySelector('.remove-line').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

document.querySelectorAll('.add-line').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.add === 'red' ? 'redList' : 'whiteList';
    addFactorLine(target, '', '');
  });
});

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function readListFactors(listId) {
  const rows = document.querySelectorAll('#' + listId + ' .factor-row');
  const out = [];
  rows.forEach(r => {
    const name = r.querySelector('.fname').value.trim();
    const level = r.querySelector('.flevel').value;
    if (name) out.push({ name, level: level ? Number(level) : null });
  });
  return out;
}

function setStatus(msg, isError) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
}
function setListStatus(msg, isError) {
  const el = document.getElementById('listStatus');
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
}

// --- image intake ---
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const dropzoneInner = document.getElementById('dropzoneInner');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag');
  if (e.dataTransfer.files && e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleImageFile(fileInput.files[0]);
});

document.addEventListener('paste', e => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) handleImageFile(file);
      break;
    }
  }
});

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const [meta, b64] = dataUrl.split(',');
    currentImageBase64 = b64;
    currentImageMediaType = meta.match(/data:(.*);base64/)[1];
    dropzoneInner.innerHTML = '';
    const img = document.createElement('img');
    img.src = dataUrl;
    dropzoneInner.appendChild(img);
    const label = document.createElement('div');
    label.textContent = '画像を読み込みました（クリックで変更）';
    dropzoneInner.appendChild(label);
    analyzeBtn.disabled = false;
    setStatus('');
  };
  reader.readAsDataURL(file);
}

analyzeBtn.addEventListener('click', async () => {
  if (!currentImageBase64) return;
  analyzeBtn.disabled = true;
  setStatus('画像を解析しています…');
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaType: currentImageMediaType,
        data: currentImageBase64,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `解析APIエラー: ${response.status}`);
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) throw new Error('応答にテキストがありませんでした');
    const clean = textBlock.text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    fillForm(parsed);
    setStatus('読み取り完了。内容を確認して保存してください。');
  } catch (err) {
    console.error(err);
    setStatus('読み取りに失敗しました。手入力で修正・登録できます。', true);
  } finally {
    analyzeBtn.disabled = false;
  }
});

function fillForm(parsed) {
  document.getElementById('fCharacter').value = parsed.character || '';
  document.getElementById('fBlueName').value = (parsed.blue_factor && parsed.blue_factor.name) || '';
  document.getElementById('fBlueLevel').value = (parsed.blue_factor && parsed.blue_factor.level) || '';

  document.getElementById('redList').innerHTML = '';
  (parsed.red_factors || []).forEach(f => addFactorLine('redList', f.name, f.level));
  if (!(parsed.red_factors || []).length) addFactorLine('redList', '', '');

  document.getElementById('whiteList').innerHTML = '';
  (parsed.white_factors || []).forEach(f => addFactorLine('whiteList', f.name, f.level));
  if (!(parsed.white_factors || []).length) addFactorLine('whiteList', '', '');
}

document.getElementById('clearBtn').addEventListener('click', resetForm);

function resetForm() {
  document.getElementById('entryForm').reset();
  document.getElementById('redList').innerHTML = '';
  document.getElementById('whiteList').innerHTML = '';
  addFactorLine('redList', '', '');
  addFactorLine('whiteList', '', '');
  currentImageBase64 = null;
  currentImageMediaType = null;
  dropzoneInner.innerHTML = '画像を貼り付け（Ctrl+V）<br>またはクリックして選択';
  analyzeBtn.disabled = true;
  setStatus('');
}

// --- save / storage (GitHub Contents API) ---
document.getElementById('entryForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!config) { setStatus('先にGitHub連携設定を保存してください。', true); return; }
  const character = document.getElementById('fCharacter').value.trim();
  if (!character) { setStatus('キャラ名を入力してください。', true); return; }

  const entry = {
    id: 'factor_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    character,
    blue: {
      name: document.getElementById('fBlueName').value.trim(),
      level: document.getElementById('fBlueLevel').value ? Number(document.getElementById('fBlueLevel').value) : null
    },
    red: readListFactors('redList'),
    white: readListFactors('whiteList'),
    notes: document.getElementById('fNotes').value.trim(),
    savedAt: new Date().toISOString()
  };

  const updated = [entry, ...allEntries];
  setStatus('保存しています…');
  try {
    await saveEntriesToGitHub(updated, `因子登録: ${character}`);
    allEntries = updated;
    renderEntries();
    resetForm();
    setStatus('保存しました。');
  } catch (err) {
    console.error(err);
    if (err instanceof ConflictError) {
      setStatus('他の端末で更新されています。「更新」ボタンで最新を取得してからもう一度保存してください。', true);
    } else {
      setStatus('保存中にエラーが発生しました: ' + err.message, true);
    }
  }
});

async function loadEntries() {
  if (!config) { renderEntries(); return; }
  setListStatus('読み込み中…');
  try {
    const { sha, entries } = await fetchFactorsRaw();
    currentSha = sha;
    allEntries = entries.slice().sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    setListStatus('');
  } catch (err) {
    console.error(err);
    setListStatus('読み込みに失敗しました: ' + err.message, true);
  }
  renderEntries();
}

async function deleteEntry(id) {
  const target = allEntries.find(e => e.id === id);
  const updated = allEntries.filter(e => e.id !== id);
  setListStatus('削除しています…');
  try {
    await saveEntriesToGitHub(updated, `因子削除: ${target ? target.character : id}`);
    allEntries = updated;
    setListStatus('');
    renderEntries();
  } catch (err) {
    console.error(err);
    if (err instanceof ConflictError) {
      setListStatus('他の端末で更新されています。「更新」ボタンで最新を取得してからもう一度削除してください。', true);
    } else {
      setListStatus('削除中にエラーが発生しました: ' + err.message, true);
    }
  }
}

function renderEntries() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const container = document.getElementById('entries');
  const emptyMsg = document.getElementById('emptyMsg');
  container.innerHTML = '';

  const filtered = allEntries.filter(e => {
    if (!q) return true;
    const hay = [e.character, e.blue && e.blue.name, e.notes,
      ...(e.red || []).map(f => f.name), ...(e.white || []).map(f => f.name)]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });

  document.getElementById('countLabel').textContent = allEntries.length + ' 頭 登録';

  if (!filtered.length) {
    emptyMsg.style.display = 'block';
    emptyMsg.textContent = allEntries.length ? '該当する登録が見つかりません。' : 'まだ登録がありません。左で画像を読み込むか、手入力して保存してください。';
    return;
  }
  emptyMsg.style.display = 'none';

  filtered.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'entry';

    const chips = [];
    if (entry.blue && entry.blue.name) {
      chips.push(`<span class="chip blue">${escapeHtml(entry.blue.name)}${entry.blue.level ? ' ×' + entry.blue.level : ''}</span>`);
    }
    (entry.red || []).forEach(f => chips.push(`<span class="chip red">${escapeHtml(f.name)}${f.level ? ' ×' + f.level : ''}</span>`));
    (entry.white || []).forEach(f => chips.push(`<span class="chip white">${escapeHtml(f.name)}${f.level ? ' ×' + f.level : ''}</span>`));

    row.innerHTML = `
      <div>
        <div class="entry-name">${escapeHtml(entry.character)}</div>
        <div class="chips">${chips.join('') || '<span style="color:var(--ink-soft);font-size:12px;">因子未登録</span>'}</div>
        ${entry.notes ? `<div class="entry-notes">${escapeHtml(entry.notes)}</div>` : ''}
      </div>
      <button class="entry-del" data-id="${entry.id}">削除</button>
    `;
    row.querySelector('.entry-del').addEventListener('click', () => deleteEntry(entry.id));
    container.appendChild(row);
  });
}

document.getElementById('searchInput').addEventListener('input', renderEntries);

fillConfigForm();
resetForm();
loadEntries();
