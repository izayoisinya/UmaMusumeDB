// training.js — 育成計画ページ固有ロジック

const DATA_PATH = 'data/training_plans.json';

class ConflictError extends Error {
  constructor() {
    super('conflict');
    this.name = 'ConflictError';
  }
}

let currentSha = null;
let allPlans = [];
let editingPlanId = null;

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

async function fetchPlansRaw() {
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

async function savePlansToGitHub(newEntries, commitMessage) {
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

const STATUS_ORDER = ['in_progress', 'not_started', 'done'];
const STATUS_LABELS = { not_started: '未着手', in_progress: '育成中', done: '完了' };

function sortPlans(list) {
  return list.slice().sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
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

async function loadPlans() {
  setListStatus('読み込み中…');
  try {
    const { sha, entries } = await fetchPlansRaw();
    currentSha = sha;
    allPlans = sortPlans(entries);
    setListStatus('');
  } catch (err) {
    console.error(err);
    setListStatus('読み込みに失敗しました: ' + err.message, true);
  }
  renderPlans();
}

// common.jsのGitHub連携設定フォーム(保存/消去)から呼ばれるフック
function onGithubConfigChanged() {
  allPlans = [];
  currentSha = null;
  return loadPlans();
}

function getRadioValue(name, fallback) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : fallback;
}
function setRadioValue(name, value, fallback) {
  const el = document.querySelector(`input[name="${name}"][value="${value || fallback}"]`);
  if (el) el.checked = true;
}

// --- フォーム操作 ---
function setTrainingModalMode(isEditing) {
  editingPlanId = isEditing;
  document.getElementById('trainingModalTitle').textContent = isEditing ? '育成計画を編集' : '育成計画を追加';
  document.getElementById('saveTrainingBtn').textContent = isEditing ? 'この内容で更新' : 'この内容を保存';
}

function resetForm() {
  document.getElementById('trainingForm').reset();
  setRadioValue('fStatus', 'not_started', 'not_started');
  setRadioValue('fEventType', 'champions', 'champions');
  setStatus('');
  setTrainingModalMode(null);
}

document.getElementById('openRegisterModalBtn').addEventListener('click', () => {
  resetForm();
  setTrainingModalMode(null);
  openModal('trainingModal');
});

document.getElementById('clearBtn').addEventListener('click', resetForm);

function fillForm(plan) {
  setRadioValue('fStatus', plan.status, 'not_started');
  setRadioValue('fEventType', plan.eventType, 'champions');

  const rc = plan.raceCondition || {};
  document.getElementById('fLocation').value = rc.location || '';
  document.getElementById('fDistance').value = rc.distance != null ? rc.distance : '';
  setRadioValue('fSurface', rc.surface, '芝');
  setRadioValue('fTrackDirection', rc.direction, '右回り');
  setRadioValue('fSeason', rc.season, '春');
  setRadioValue('fWeather', rc.weather, '晴');
  setRadioValue('fGoing', rc.going, '良');

  const characters = plan.characters || [];
  [1, 2, 3].forEach(i => {
    document.getElementById('fCharName' + i).value = (characters[i - 1] && characters[i - 1].name) || '';
  });

  document.getElementById('fNotes').value = plan.notes || '';
}

function startEditPlan(id) {
  const plan = allPlans.find(p => p.id === id);
  if (!plan) return;
  resetForm();
  setTrainingModalMode(id);
  fillForm(plan);
  openModal('trainingModal');
}

function readCharactersFromForm() {
  return [1, 2, 3]
    .map(i => ({ name: document.getElementById('fCharName' + i).value.trim() }))
    .filter(c => c.name);
}

// --- 保存 ---
document.getElementById('trainingForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!config || !config.token) { setStatus('保存にはPATが必要です。設定でPATを入力してください。', true); return; }

  const planId = editingPlanId || ('training_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const distanceRaw = document.getElementById('fDistance').value;
  const plan = {
    id: planId,
    status: getRadioValue('fStatus', 'not_started'),
    eventType: getRadioValue('fEventType', 'champions'),
    raceCondition: {
      location: document.getElementById('fLocation').value,
      distance: distanceRaw === '' ? null : Number(distanceRaw),
      surface: getRadioValue('fSurface', '芝'),
      direction: getRadioValue('fTrackDirection', '右回り'),
      season: getRadioValue('fSeason', '春'),
      weather: getRadioValue('fWeather', '晴'),
      going: getRadioValue('fGoing', '良'),
    },
    characters: readCharactersFromForm(),
    notes: document.getElementById('fNotes').value.trim(),
    savedAt: new Date().toISOString(),
  };

  const isEditing = !!editingPlanId;
  const updated = isEditing
    ? allPlans.map(p => p.id === editingPlanId ? plan : p)
    : [plan, ...allPlans];
  setStatus(isEditing ? '更新しています…' : '保存しています…');
  const saveBtn = document.getElementById('saveTrainingBtn');
  saveBtn.disabled = true;
  try {
    await savePlansToGitHub(updated, `${isEditing ? '育成計画編集' : '育成計画追加'}: ${plan.characters.map(c => c.name).join('・') || planId}`);
    allPlans = sortPlans(updated);
    renderPlans();
    resetForm();
    setStatus(isEditing ? '更新しました。' : '保存しました。');
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

function askDeleteConfirm(plan, btn) {
  pendingDeleteId = plan.id;
  pendingDeleteBtn = btn;
  const label = (plan.characters || []).map(c => c.name).join('・') || '無題';
  document.getElementById('confirmDeleteMessage').textContent = `「${label}」の育成計画を削除します。この操作は取り消せません。よろしいですか？`;
  openModal('confirmDeleteModal');
}

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
  const id = pendingDeleteId;
  const btn = pendingDeleteBtn;
  pendingDeleteId = null;
  pendingDeleteBtn = null;
  closeModal();
  deletePlan(id, btn);
});

async function deletePlan(id, btn) {
  if (!config || !config.token) { setListStatus('削除にはPATが必要です。設定でPATを入力してください。', true); return; }
  const target = allPlans.find(p => p.id === id);
  const updated = allPlans.filter(p => p.id !== id);
  setListStatus('削除しています…');
  if (btn) btn.disabled = true;
  try {
    await savePlansToGitHub(updated, `育成計画削除: ${target ? (target.characters || []).map(c => c.name).join('・') || id : id}`);
    allPlans = updated;
    setListStatus('');
    renderPlans();
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

document.getElementById('refreshBtn').addEventListener('click', loadPlans);

// --- 一覧表示(進捗ごとにグルーピング) ---
document.getElementById('entries').addEventListener('click', e => {
  const editBtn = e.target.closest('.entry-edit');
  if (editBtn) { startEditPlan(editBtn.dataset.id); return; }
  const delBtn = e.target.closest('.entry-del');
  if (delBtn) {
    const plan = allPlans.find(p => p.id === delBtn.dataset.id);
    if (plan) askDeleteConfirm(plan, delBtn);
  }
});

function renderPlans() {
  const container = document.getElementById('entries');
  const emptyMsg = document.getElementById('emptyMsg');
  container.innerHTML = '';

  document.getElementById('countLabel').textContent = allPlans.length + ' 件記録';

  if (!allPlans.length) {
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';

  const fragment = document.createDocumentFragment();
  STATUS_ORDER.forEach(statusKey => {
    const plans = allPlans.filter(p => (p.status || 'not_started') === statusKey);
    if (!plans.length) return;

    const section = document.createElement('div');
    section.className = 'status-group';
    const heading = document.createElement('h3');
    heading.className = 'status-group-heading';
    heading.textContent = `${STATUS_LABELS[statusKey]}（${plans.length}件）`;
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'entries';
    plans.forEach(plan => {
      const row = document.createElement('div');
      row.className = 'entry';
      const isLoh = plan.eventType === 'loh';
      const eventTypeLabel = isLoh ? 'リーグオブヒーローズ' : 'チャンピオンズミーティング';

      const rc = plan.raceCondition || {};
      const raceConditionLabel = [
        rc.location,
        rc.distance != null ? `${rc.distance}m` : '',
        rc.surface,
        rc.direction,
        rc.season,
        rc.weather,
        rc.going,
      ].filter(Boolean).join(' ／ ');

      const charNames = (plan.characters || []).map(c => escapeHtml(c.name)).join('、');

      row.innerHTML = `
        <div class="entry-main">
          <div class="entry-name-row">
            <div class="entry-name">${charNames || '（キャラ未定）'}</div>
          </div>
          <div class="apt-row">
            <span class="apt-badge">${eventTypeLabel}</span>
          </div>
          ${raceConditionLabel ? `<div class="entry-notes">${escapeHtml(raceConditionLabel)}</div>` : ''}
          ${plan.notes ? `<div class="entry-notes">${escapeHtml(plan.notes)}</div>` : ''}
        </div>
        <div class="entry-side">
          <div class="entry-actions">
            <button class="entry-edit" data-id="${plan.id}">編集</button>
            <button class="entry-del" data-id="${plan.id}">削除</button>
          </div>
        </div>
      `;
      list.appendChild(row);
    });
    section.appendChild(list);
    fragment.appendChild(section);
  });
  container.appendChild(fragment);
}

resetForm();
loadPlans();
