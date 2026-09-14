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

const CLAUDE_PROMPT = 'この画像はウマ娘プリティーダービーの因子継承画面のスクリーンショットです。書かれている因子情報を読み取って、次のJSON形式だけを出力してください（説明や前置き、コードフェンスは不要です）。\n\n画面には「本人」「継承元1」「継承元2」の3つの因子ブロックが縦に並んでいます。青因子・赤（ピンク）因子・緑因子（固有）・白因子のすべてについて、3ブロック分を読み取ってください。\n\n同じ名前の因子が本人・継承元1・継承元2のいずれかに重複して存在する場合は1つのエントリにまとめ、それぞれの星の数をself(本人)/parent1(継承元1)/parent2(継承元2)に対応させてください。存在しない生成の値はnullにしてください。\n\n各ブロックの青因子列・赤因子列は、一番上の色付き見出し（例:「根性」「逃げ」）もその列の1項目として含めてください。そこから下に続く項目も同じ列の色として全て含めてください（青列はblue_factors、ピンク/赤列はred_factorsに）。緑色で強調された項目は、その列の色分類ではなくgreen_factorsに入れてください。\n\n{"character": string, "blue_factors": [{"name": string, "self": number, "parent1": number, "parent2": number}], "red_factors": [同じ形式], "green_factors": [同じ形式], "white_factors": [同じ形式]}\n\nself/parent1/parent2は星の数(1〜3程度)。読み取れない・存在しない値はnullにしてください。characterは本人のキャラ名のみ（継承元のキャラ名は含めない）。項目は省略せず全て出力してください。';

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

function addFactorLine(listId, name, self, parent1, parent2) {
  const list = document.getElementById(listId);
  const row = document.createElement('div');
  row.className = 'stack-factor-row';
  row.innerHTML = `
    <input type="text" class="fname" placeholder="因子名" value="${escapeAttr(name||'')}">
    <input type="number" class="flevel-self" min="0" max="3" placeholder="本体" value="${self||''}">
    <input type="number" class="flevel-p1" min="0" max="3" placeholder="親1" value="${parent1||''}">
    <input type="number" class="flevel-p2" min="0" max="3" placeholder="親2" value="${parent2||''}">
    <button type="button" class="remove-line" aria-label="削除">×</button>
  `;
  row.querySelector('.remove-line').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

const FACTOR_LIST_IDS = { blue: 'blueList', red: 'redList', green: 'greenList', white: 'whiteList' };

document.querySelectorAll('.add-line[data-add]').forEach(btn => {
  btn.addEventListener('click', () => {
    addFactorLine(FACTOR_LIST_IDS[btn.dataset.add], '', '', '', '');
  });
});

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function readListFactors(listId) {
  const rows = document.querySelectorAll('#' + listId + ' .stack-factor-row');
  const out = [];
  rows.forEach(r => {
    const name = r.querySelector('.fname').value.trim();
    if (!name) return;
    const self = r.querySelector('.flevel-self').value;
    const parent1 = r.querySelector('.flevel-p1').value;
    const parent2 = r.querySelector('.flevel-p2').value;
    out.push({
      name,
      self: self ? Number(self) : null,
      parent1: parent1 ? Number(parent1) : null,
      parent2: parent2 ? Number(parent2) : null,
    });
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

// --- Claude出力の貼り付け読み込み ---
document.getElementById('copyPromptBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(CLAUDE_PROMPT);
    setStatus('プロンプトをコピーしました。Claudeにスクリーンショットと一緒に貼り付けてください。');
  } catch (err) {
    console.error(err);
    setStatus('コピーに失敗しました。手動で選択してコピーしてください。', true);
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
  list.forEach(f => addFactorLine(listId, f.name, f.self, f.parent1, f.parent2));
  if (!list.length) addFactorLine(listId, '', '', '', '');
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
    addFactorLine(listId, '', '', '', '');
  });
  document.getElementById('pasteJson').value = '';
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
    const hay = [e.character, e.parent1, e.parent2, e.notes,
      ...(e.blue || []).map(f => f.name), ...(e.red || []).map(f => f.name),
      ...(e.green || []).map(f => f.name), ...(e.white || []).map(f => f.name)]
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
    const stackLabel = f => [f.self, f.parent1, f.parent2].map(n => (n === null || n === undefined) ? '' : n).join(',');
    (entry.blue || []).forEach(f => chips.push(`<span class="chip blue">${escapeHtml(f.name)}${stackLabel(f)}</span>`));
    (entry.red || []).forEach(f => chips.push(`<span class="chip red">${escapeHtml(f.name)}${stackLabel(f)}</span>`));
    (entry.green || []).forEach(f => chips.push(`<span class="chip green">${escapeHtml(f.name)}${stackLabel(f)}</span>`));
    (entry.white || []).forEach(f => chips.push(`<span class="chip white">${escapeHtml(f.name)}${stackLabel(f)}</span>`));

    const parents = [entry.parent1, entry.parent2].filter(Boolean).join(' × ');

    row.innerHTML = `
      <div>
        <div class="entry-name">${escapeHtml(entry.character)}</div>
        ${parents ? `<div class="entry-parents">継承元: ${escapeHtml(parents)}</div>` : ''}
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
