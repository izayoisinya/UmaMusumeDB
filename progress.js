// progress.js — 進行状況ログページ固有ロジック
// 毎月のゲーム内ステータス(育成回数・レース成績・コレクション進行度・ファン数など)を
// スナップショットとして記録する。前回記録からの増分(前月比)を自動計算して表示する。

const DATA_PATH = 'data/progress_log.json';

class ConflictError extends Error {
  constructor() {
    super('conflict');
    this.name = 'ConflictError';
  }
}

let currentSha = null;
let allEntries = [];
let editingEntryId = null;

// 項目一覧。フォームのinput id・一覧の表示グループ・保存先のキーをここで一元管理する
const FIELD_GROUPS = [
  { title: '育成', fields: [
    { key: 'trainingCount', label: '育成回数' },
    { key: 'goodEndCount', label: 'グッドエンド' },
    { key: 'bestScore', label: '歴代最高評価点' },
    { key: 'raisedUma', label: '育成ウマ娘' },
  ] },
  { title: '重賞勝利数', fields: [
    { key: 'g1Wins', label: 'GI' },
    { key: 'g2Wins', label: 'GII' },
    { key: 'g3Wins', label: 'GIII' },
    { key: 'exWins', label: 'EX' },
  ] },
  { title: 'チーム戦', fields: [
    { key: 'teamClass', label: 'CLASS' },
    { key: 'teamBestScore', label: 'チーム最高スコア' },
    { key: 'teamWins', label: '勝利数' },
  ] },
  { title: '進行度', fields: [
    { key: 'mainStory', label: 'メインストーリー' },
    { key: 'umaStory', label: 'ウマ娘ストーリー' },
    { key: 'supportCards', label: 'サポートカード' },
    { key: 'songs', label: '楽曲' },
    { key: 'staging', label: '演出' },
    { key: 'gallery', label: 'ギャラリー' },
    { key: 'voice', label: 'ボイス' },
  ] },
  { title: 'ファン', fields: [
    { key: 'totalFans', label: 'ファン総獲得数' },
  ] },
];
const ALL_FIELDS = FIELD_GROUPS.flatMap(g => g.fields);

function fieldInputId(key) {
  return 'f' + key[0].toUpperCase() + key.slice(1);
}

function contentsApiUrl() {
  const owner = (config && config.owner) || DEFAULT_OWNER;
  const repo = (config && config.repo) || DEFAULT_REPO;
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${DATA_PATH}`;
}
function contentsApiUrlForGet() {
  const url = contentsApiUrl();
  const branch = config && config.branch;
  return branch ? `${url}?ref=${encodeURIComponent(branch)}` : url;
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

async function fetchEntriesRaw() {
  const res = await fetch(contentsApiUrlForGet(), { headers: authHeaders(), cache: 'no-store' });
  if (res.status === 404) return { sha: null, entries: [] };
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
  const body = {
    message: commitMessage,
    content: encodeUtf8Base64(JSON.stringify(newEntries, null, 2)),
  };
  if (config && config.branch) body.branch = config.branch;
  if (currentSha) body.sha = currentSha;

  const res = await fetch(contentsApiUrl(), {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 409) throw new ConflictError();
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.message || `GitHub APIエラー: ${res.status}`);
  }
  const json = await res.json();
  currentSha = json.content ? json.content.sha : null;
}

// 新しい記録日が上に来るよう降順ソート(同日なら保存順)
function sortEntries(list) {
  return list.slice().sort((a, b) => {
    const dateDiff = (b.date || '').localeCompare(a.date || '');
    if (dateDiff !== 0) return dateDiff;
    return (b.savedAt || '').localeCompare(a.savedAt || '');
  });
}

function setListStatus(msg, isError) {
  const el = document.getElementById('listStatus');
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
}
function setStatus(msg, isError) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadEntries() {
  setListStatus('読み込み中…');
  try {
    const { sha, entries } = await fetchEntriesRaw();
    currentSha = sha;
    allEntries = sortEntries(entries);
    setListStatus('');
  } catch (err) {
    console.error(err);
    setListStatus('読み込みに失敗しました: ' + err.message, true);
  }
  renderEntries();
}

// common.jsのGitHub連携設定フォーム(保存/消去)から呼ばれるフック
async function onGithubConfigChanged() {
  allEntries = [];
  currentSha = null;
  await loadEntries();
}

function setProgressModalMode(isEditing) {
  editingEntryId = isEditing;
  document.getElementById('progressModalTitle').textContent = isEditing ? '進行状況ログを編集' : '進行状況ログを追加';
  document.getElementById('saveProgressBtn').textContent = isEditing ? 'この内容で更新' : 'この内容を保存';
}

function resetForm() {
  document.getElementById('progressForm').reset();
  setStatus('');
  setProgressModalMode(null);
}

document.getElementById('openRegisterModalBtn').addEventListener('click', () => {
  resetForm();
  openModal('progressModal');
});
document.getElementById('clearBtn').addEventListener('click', resetForm);

function fillForm(entry) {
  document.getElementById('fDate').value = entry.date || '';
  ALL_FIELDS.forEach(({ key }) => {
    const el = document.getElementById(fieldInputId(key));
    el.value = entry[key] != null ? entry[key] : '';
  });
}

function startEditEntry(id) {
  const entry = allEntries.find(e => e.id === id);
  if (!entry) return;
  resetForm();
  setProgressModalMode(id);
  fillForm(entry);
  openModal('progressModal');
}

// --- 保存 ---
document.getElementById('progressForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!config || !config.token) { setStatus('保存にはPATが必要です。設定でPATを入力してください。', true); return; }
  const date = document.getElementById('fDate').value;
  if (!date) { setStatus('記録日を入力してください。', true); return; }

  const entryId = editingEntryId || ('progress_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const entry = { id: entryId, date, savedAt: new Date().toISOString() };
  ALL_FIELDS.forEach(({ key }) => {
    const raw = document.getElementById(fieldInputId(key)).value;
    entry[key] = raw === '' ? null : Number(raw);
  });

  const isEditing = !!editingEntryId;
  const updated = isEditing
    ? allEntries.map(e => e.id === editingEntryId ? entry : e)
    : [entry, ...allEntries];
  setStatus(isEditing ? '更新しています…' : '保存しています…');
  const saveBtn = document.getElementById('saveProgressBtn');
  saveBtn.disabled = true;
  try {
    await saveEntriesToGitHub(updated, `${isEditing ? '進行状況ログ編集' : '進行状況ログ追加'}: ${date}`);
    allEntries = sortEntries(updated);
    renderEntries();
    resetForm();
    setStatus(isEditing ? '更新しました。' : '保存しました。');
    showToast(isEditing ? '更新しました' : '保存しました');
    setTimeout(closeModal, 700);
  } catch (err) {
    console.error(err);
    if (err instanceof ConflictError) {
      setStatus('他の端末で更新されています。「更新」ボタンで最新を取得してからもう一度保存してください。', true);
    } else {
      setStatus('保存中にエラーが発生しました: ' + err.message, true);
    }
  } finally {
    saveBtn.disabled = false;
  }
});

let pendingDeleteId = null;
let pendingDeleteBtn = null;

function askDeleteConfirm(entry, btn) {
  pendingDeleteId = entry.id;
  pendingDeleteBtn = btn;
  document.getElementById('confirmDeleteMessage').textContent = `「${formatDateLabel(entry.date)}」の記録を削除します。この操作は取り消せません。よろしいですか？`;
  openModal('confirmDeleteModal');
}
document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
  const id = pendingDeleteId;
  const btn = pendingDeleteBtn;
  pendingDeleteId = null;
  pendingDeleteBtn = null;
  closeModal();
  deleteEntry(id, btn);
});

async function deleteEntry(id, btn) {
  if (!config || !config.token) { setListStatus('削除にはPATが必要です。設定でPATを入力してください。', true); return; }
  const target = allEntries.find(e => e.id === id);
  const updated = allEntries.filter(e => e.id !== id);
  setListStatus('削除しています…');
  if (btn) btn.disabled = true;
  try {
    await saveEntriesToGitHub(updated, `進行状況ログ削除: ${target ? target.date : id}`);
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
    if (btn) btn.disabled = false;
  }
}

document.getElementById('refreshBtn').addEventListener('click', loadEntries);

// --- 一覧表示 ---
function formatDateLabel(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : (date || '日付不明');
}
function formatNumber(n) {
  return n.toLocaleString('ja-JP');
}
function formatDiff(diff) {
  if (diff > 0) return `<span class="progress-stat-diff">(前回比 +${formatNumber(diff)})</span>`;
  if (diff < 0) return `<span class="progress-stat-diff negative">(前回比 ${formatNumber(diff)})</span>`;
  return '';
}

function renderEntries() {
  const container = document.getElementById('entries');
  const emptyMsg = document.getElementById('emptyMsg');
  container.innerHTML = '';

  document.getElementById('countLabel').textContent = allEntries.length + ' 件記録';

  if (!allEntries.length) {
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';

  // allEntriesは記録日の降順なので、1つ後ろの要素が「前回の記録」になる
  allEntries.forEach((entry, i) => {
    const prev = allEntries[i + 1] || null;
    const row = document.createElement('div');
    row.className = 'entry';

    const groupsHtml = FIELD_GROUPS.map(group => {
      const statsHtml = group.fields.map(({ key, label }) => {
        const value = entry[key];
        if (value == null) return '';
        const diff = (prev && prev[key] != null) ? value - prev[key] : null;
        return `
          <div class="progress-stat">
            <div class="progress-stat-label">${escapeHtml(label)}</div>
            <div class="progress-stat-value">${formatNumber(value)}</div>
            ${diff != null ? formatDiff(diff) : ''}
          </div>
        `;
      }).join('');
      if (!statsHtml) return '';
      return `
        <div class="progress-stat-group">
          <div class="progress-stat-group-title">${escapeHtml(group.title)}</div>
          <div class="progress-stat-grid">${statsHtml}</div>
        </div>
      `;
    }).join('');

    row.innerHTML = `
      <div class="entry-main">
        <div class="entry-name-row"><div class="entry-name progress-date">${escapeHtml(formatDateLabel(entry.date))}</div></div>
        ${groupsHtml}
      </div>
      <div class="entry-side">
        <div class="entry-actions">
          <button class="entry-edit" data-id="${entry.id}">編集</button>
          <button class="entry-del" data-id="${entry.id}">削除</button>
        </div>
      </div>
    `;
    row.querySelector('.entry-edit').addEventListener('click', e => { e.stopPropagation(); startEditEntry(entry.id); });
    row.querySelector('.entry-del').addEventListener('click', e => { e.stopPropagation(); askDeleteConfirm(entry, e.currentTarget); });
    container.appendChild(row);
  });
}

resetForm();
loadEntries();
