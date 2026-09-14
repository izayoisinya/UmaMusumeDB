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

const THEME_KEY = 'umaFactorLedger:theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️ ライト' : '🌙 ダーク';
}

function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const theme = stored || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(theme);
}

document.getElementById('themeToggleBtn').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

initTheme();

const CLAUDE_PROMPT = 'この画像はウマ娘プリティーダービーの因子継承画面のスクリーンショットです。書かれている因子情報を読み取って、次のJSON形式だけを出力してください（説明や前置き、コードフェンスは不要です）。\n\n画面には「本人」「継承元1」「継承元2」の3つの因子ブロックが縦に並んでいます。青因子・赤（ピンク）因子・緑因子（固有）・白因子のすべてについて、3ブロック分を読み取ってください。\n\n同じ名前の因子が本人・継承元1・継承元2のいずれかに存在する場合は1つのエントリにまとめ、その因子が各ブロックに存在するかどうかをself(本人)/parent1(継承元1)/parent2(継承元2)にtrue/falseで入れてください。星の数を数える必要はありません。存在すればtrue、存在しなければfalseだけで構いません。\n\n各ブロックの青因子列・赤因子列は、一番上の色付き見出し（例:「根性」「逃げ」）もその列の1項目として含めてください。そこから下に続く項目も同じ列の色として全て含めてください（青列はblue_factors、ピンク/赤列はred_factorsに）。緑色で強調された項目は、その列の色分類ではなくgreen_factorsに入れてください。\n\n{"character": string, "blue_factors": [{"name": string, "self": boolean, "parent1": boolean, "parent2": boolean}], "red_factors": [同じ形式], "green_factors": [同じ形式], "white_factors": [同じ形式]}\n\ncharacterは本人のキャラ名のみ（継承元のキャラ名は含めない）。項目は省略せず全て出力してください。';

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
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (config.token) headers['Authorization'] = `Bearer ${config.token}`;
  return headers;
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
  if (!owner || !repo) {
    setCfgStatus('リポジトリ所有者・リポジトリ名は必須です。', true);
    return;
  }
  config = { owner, repo, branch, token };
  persistConfig(config);
  setCfgStatus('保存しました。読み込んでいます…');
  await loadEntries();
  setCfgStatus(token ? '接続しました。' : '接続しました（閲覧のみ。保存・削除にはPATが必要です）。');
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

function addFactorLine(listId, name, self, parent1, parent2) {
  const list = document.getElementById(listId);
  const row = document.createElement('div');
  row.className = 'stack-factor-row';
  row.innerHTML = `
    <input type="text" class="fname" placeholder="因子名" value="${escapeAttr(name||'')}">
    <input type="checkbox" class="fself" ${self ? 'checked' : ''}>
    <input type="checkbox" class="fp1" ${parent1 ? 'checked' : ''}>
    <input type="checkbox" class="fp2" ${parent2 ? 'checked' : ''}>
    <button type="button" class="remove-line" aria-label="削除">×</button>
  `;
  row.querySelector('.remove-line').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

const FACTOR_LIST_IDS = { blue: 'blueList', red: 'redList', green: 'greenList', white: 'whiteList' };

document.querySelectorAll('.add-line[data-add]').forEach(btn => {
  btn.addEventListener('click', () => {
    addFactorLine(FACTOR_LIST_IDS[btn.dataset.add], '', false, false, false);
  });
});

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function dedupeFactors(factors) {
  const map = new Map();
  factors.forEach(f => {
    const existing = map.get(f.name);
    if (existing) {
      existing.self = existing.self || f.self;
      existing.parent1 = existing.parent1 || f.parent1;
      existing.parent2 = existing.parent2 || f.parent2;
    } else {
      map.set(f.name, { ...f });
    }
  });
  return Array.from(map.values());
}

function readListFactors(listId) {
  const rows = document.querySelectorAll('#' + listId + ' .stack-factor-row');
  const out = [];
  rows.forEach(r => {
    const name = r.querySelector('.fname').value.trim();
    if (!name) return;
    out.push({
      name,
      self: r.querySelector('.fself').checked,
      parent1: r.querySelector('.fp1').checked,
      parent2: r.querySelector('.fp2').checked,
    });
  });
  return dedupeFactors(out);
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

// --- モーダル(GitHub連携設定 / Claudeプロンプト) ---
const modalOverlay = document.getElementById('modalOverlay');

function openModal(id) {
  document.querySelectorAll('.modal').forEach(m => { m.hidden = m.id !== id; });
  modalOverlay.hidden = false;
}
function closeModal() {
  modalOverlay.hidden = true;
  document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
}

document.getElementById('openRegisterModalBtn').addEventListener('click', () => openModal('registerModal'));
document.getElementById('openGithubModalBtn').addEventListener('click', () => openModal('githubModal'));
document.getElementById('openPromptModalBtn').addEventListener('click', () => openModal('promptModal'));
document.querySelectorAll('.modal-close-btn').forEach(btn => btn.addEventListener('click', closeModal));
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modalOverlay.hidden) closeModal(); });

document.getElementById('promptText').value = CLAUDE_PROMPT;

// --- Claude出力の貼り付け読み込み ---
document.getElementById('copyPromptBtn').addEventListener('click', async () => {
  const el = document.getElementById('promptStatus');
  try {
    await navigator.clipboard.writeText(CLAUDE_PROMPT);
    el.textContent = 'プロンプトをコピーしました。Claudeにスクリーンショットと一緒に貼り付けてください。';
    el.className = 'status';
  } catch (err) {
    console.error(err);
    el.textContent = 'コピーに失敗しました。上のテキストを手動で選択してコピーしてください。';
    el.className = 'status error';
  }
});

document.getElementById('loadJsonBtn').addEventListener('click', () => {
  const raw = document.getElementById('pasteJson').value.trim();
  if (!raw) { setStatus('Claudeの出力を貼り付けてください。', true); return; }
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    fillForm(parsed);
    setStatus('読み込み完了。内容を確認して保存してください。');
  } catch (err) {
    console.error(err);
    setStatus('JSONの解析に失敗しました。Claudeの出力をそのまま貼り付けているか確認してください。', true);
  }
});

function fillFactorList(listId, factors) {
  document.getElementById(listId).innerHTML = '';
  const list = factors || [];
  list.forEach(f => addFactorLine(listId, f.name, !!f.self, !!f.parent1, !!f.parent2));
  if (!list.length) addFactorLine(listId, '', false, false, false);
}

function fillForm(parsed) {
  document.getElementById('fCharacter').value = parsed.character || '';
  fillFactorList('blueList', parsed.blue_factors);
  fillFactorList('redList', parsed.red_factors);
  fillFactorList('greenList', parsed.green_factors);
  fillFactorList('whiteList', parsed.white_factors);
}

document.getElementById('clearBtn').addEventListener('click', resetForm);

function resetForm() {
  document.getElementById('entryForm').reset();
  Object.values(FACTOR_LIST_IDS).forEach(listId => {
    document.getElementById(listId).innerHTML = '';
    addFactorLine(listId, '', false, false, false);
  });
  document.getElementById('pasteJson').value = '';
  setStatus('');
}

// --- save / storage (GitHub Contents API) ---
document.getElementById('entryForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!config) { setStatus('先にGitHub連携設定を保存してください。', true); return; }
  if (!config.token) { setStatus('保存にはPATが必要です。GitHub連携設定でPATを入力してください。', true); return; }
  const character = document.getElementById('fCharacter').value.trim();
  if (!character) { setStatus('キャラ名を入力してください。', true); return; }

  const entry = {
    id: 'factor_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    character,
    parent1: document.getElementById('fParent1').value.trim(),
    parent2: document.getElementById('fParent2').value.trim(),
    blue: readListFactors('blueList'),
    red: readListFactors('redList'),
    green: readListFactors('greenList'),
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
    setTimeout(closeModal, 700);
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
  if (!config || !config.token) { setListStatus('削除にはPATが必要です。GitHub連携設定でPATを入力してください。', true); return; }
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

function highlightMatches(text, terms) {
  const str = text == null ? '' : String(text);
  if (!terms || !terms.length) return escapeHtml(str);
  const lowerStr = str.toLowerCase();
  const ranges = [];
  terms.forEach(term => {
    if (!term) return;
    let idx = lowerStr.indexOf(term);
    while (idx !== -1) {
      ranges.push([idx, idx + term.length]);
      idx = lowerStr.indexOf(term, idx + 1);
    }
  });
  if (!ranges.length) return escapeHtml(str);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    const cur = ranges[i];
    if (cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      merged.push(cur);
    }
  }
  let result = '';
  let cursor = 0;
  merged.forEach(([start, end]) => {
    result += escapeHtml(str.slice(cursor, start));
    result += `<mark class="search-hit">${escapeHtml(str.slice(start, end))}</mark>`;
    cursor = end;
  });
  result += escapeHtml(str.slice(cursor));
  return result;
}

function renderEntries() {
  const raw = document.getElementById('searchInput').value.trim().toLowerCase();
  const terms = raw.split(/\s+/).filter(Boolean);
  const modeInput = document.querySelector('input[name="searchMode"]:checked');
  const mode = modeInput ? modeInput.value : 'and';
  const container = document.getElementById('entries');
  const emptyMsg = document.getElementById('emptyMsg');
  container.innerHTML = '';

  const filtered = allEntries.filter(e => {
    if (!terms.length) return true;
    const hay = [e.character, e.parent1, e.parent2, e.notes,
      ...(e.blue || []).map(f => f.name), ...(e.red || []).map(f => f.name),
      ...(e.green || []).map(f => f.name), ...(e.white || []).map(f => f.name)]
      .filter(Boolean).join(' ').toLowerCase();
    return mode === 'or' ? terms.some(t => hay.includes(t)) : terms.every(t => hay.includes(t));
  });

  document.getElementById('countLabel').textContent = allEntries.length + ' 頭 登録';

  if (!filtered.length) {
    emptyMsg.style.display = 'block';
    emptyMsg.textContent = allEntries.length ? '該当する登録が見つかりません。' : 'まだ登録がありません。「＋ 因子登録」からClaudeの出力を貼り付けるか、手入力して保存してください。';
    return;
  }
  emptyMsg.style.display = 'none';

  filtered.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'entry';

    const chips = [];
    const mark = v => v ? '○' : '×';
    const stackLabel = f => `${highlightMatches(f.name, terms)}<${mark(f.self)},${mark(f.parent1)},${mark(f.parent2)}>`;
    const pushChip = (color, f) => chips.push(`<span class="chip ${color}${f.self ? '' : ' muted'}">${stackLabel(f)}</span>`);
    (entry.blue || []).forEach(f => pushChip('blue', f));
    (entry.red || []).forEach(f => pushChip('red', f));
    (entry.green || []).forEach(f => pushChip('green', f));
    (entry.white || []).forEach(f => pushChip('white', f));

    const parents = [entry.parent1, entry.parent2].filter(Boolean).map(p => highlightMatches(p, terms)).join(' × ');

    row.innerHTML = `
      <div>
        <div class="entry-name">${highlightMatches(entry.character, terms)}</div>
        ${parents ? `<div class="entry-parents">継承元: ${parents}</div>` : ''}
        <div class="chips">${chips.join('') || '<span style="color:var(--ink-soft);font-size:12px;">因子未登録</span>'}</div>
        ${entry.notes ? `<div class="entry-notes">${highlightMatches(entry.notes, terms)}</div>` : ''}
      </div>
      <button class="entry-del" data-id="${entry.id}">削除</button>
    `;
    row.querySelector('.entry-del').addEventListener('click', () => deleteEntry(entry.id));
    container.appendChild(row);
  });
}

document.getElementById('searchInput').addEventListener('input', renderEntries);
document.querySelectorAll('input[name="searchMode"]').forEach(r => r.addEventListener('change', renderEntries));

fillConfigForm();
resetForm();
loadEntries();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.error('SW登録失敗:', err));
  });
}
