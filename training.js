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
let cachedUmas = [];
let cachedSupportCards = [];

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

async function fetchJsonFile(path) {
  const owner = (config && config.owner) || DEFAULT_OWNER;
  const repo = (config && config.repo) || DEFAULT_REPO;
  const branch = config && config.branch;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`
    + (branch ? `?ref=${encodeURIComponent(branch)}` : '');
  const res = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
  if (res.status === 404) return [];
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.message || `GitHub APIエラー: ${res.status}`);
  }
  const json = await res.json();
  try {
    const arr = JSON.parse(decodeBase64Utf8(json.content));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function loadCachedUmas() {
  try {
    cachedUmas = await fetchJsonFile('data/uma_musume.json');
  } catch (err) {
    console.error('所持ウマ娘一覧の取得に失敗:', err);
    cachedUmas = [];
  }
}

async function loadCachedSupportCards() {
  try {
    cachedSupportCards = await fetchJsonFile('data/support_cards.json');
  } catch (err) {
    console.error('所持サポートカード一覧の取得に失敗:', err);
    cachedSupportCards = [];
  }
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

function formatMonthLabel(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  return m ? `${m[1]}年${Number(m[2])}月` : '';
}

function planLabel(plan) {
  if (plan.title) return plan.title;
  const names = (plan.characters || []).map(c => c.name).filter(Boolean).join('・');
  return names || '無題';
}

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
async function onGithubConfigChanged() {
  allPlans = [];
  currentSha = null;
  cachedUmas = [];
  cachedSupportCards = [];
  await Promise.all([loadPlans(), loadCachedUmas(), loadCachedSupportCards()]);
  renderPlans();
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

// --- 育成予定ウマ娘の選択(所持ウマ娘一覧からアイコン付きで選ぶ) ---
let charSelections = [null, null, null];
let pickerTargetIndex = null;

function updateCharSelectBox(index) {
  const sel = charSelections[index - 1];
  const box = document.getElementById('charSelectBox' + index);
  const emptyEl = document.getElementById('charSelectEmpty' + index);
  const filledEl = document.getElementById('charSelectFilled' + index);
  const iconEl = document.getElementById('charSelectIcon' + index);
  const nameEl = document.getElementById('charSelectName' + index);
  const clearBtn = document.getElementById('charSelectClearBtn' + index);
  if (sel) {
    box.classList.add('filled');
    emptyEl.hidden = true;
    filledEl.hidden = false;
    if (sel.imagePath) {
      iconEl.src = imageRawUrl(sel.imagePath);
      iconEl.hidden = false;
    } else {
      iconEl.hidden = true;
    }
    nameEl.textContent = sel.name;
    clearBtn.hidden = false;
  } else {
    box.classList.remove('filled');
    emptyEl.hidden = false;
    filledEl.hidden = true;
    clearBtn.hidden = true;
  }
}

function openCharacterPicker(index) {
  pickerTargetIndex = index;
  document.getElementById('characterPickerSearch').value = '';
  renderCharacterPickerGrid('');
  document.getElementById('trainingModal').hidden = true;
  document.getElementById('characterPickerModal').hidden = false;
}

function closeCharacterPicker() {
  document.getElementById('characterPickerModal').hidden = true;
  document.getElementById('trainingModal').hidden = false;
}
document.getElementById('characterPickerCloseBtn').addEventListener('click', closeCharacterPicker);

function renderCharacterPickerGrid(keyword) {
  const grid = document.getElementById('characterPickerGrid');
  const kw = keyword.trim().toLowerCase();
  const filtered = kw ? cachedUmas.filter(u => (u.name || '').toLowerCase().includes(kw)) : cachedUmas;
  grid.innerHTML = '';
  const fragment = document.createDocumentFragment();
  filtered.forEach(u => {
    const tile = document.createElement('div');
    tile.className = 'character-picker-tile';
    const imageUrl = u.imagePath ? imageRawUrl(u.imagePath) : '';
    tile.innerHTML = `
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(u.name)}" loading="lazy">` : ''}
      <span>${escapeHtml(u.name)}</span>
    `;
    tile.addEventListener('click', () => selectCharacter(u));
    fragment.appendChild(tile);
  });
  grid.appendChild(fragment);
  document.getElementById('characterPickerStatus').textContent = cachedUmas.length
    ? (filtered.length ? '' : '該当するウマ娘が見つかりません。')
    : 'ウマ娘図鑑にまだ登録がありません。';
}

function selectCharacter(u) {
  if (pickerTargetIndex == null) return;
  charSelections[pickerTargetIndex - 1] = { id: u.id, name: u.name, imagePath: u.imagePath || null };
  updateCharSelectBox(pickerTargetIndex);
  closeCharacterPicker();
}

[1, 2, 3].forEach(i => {
  document.getElementById('charSelectBox' + i).addEventListener('click', () => openCharacterPicker(i));
  document.getElementById('charSelectClearBtn' + i).addEventListener('click', e => {
    e.stopPropagation();
    charSelections[i - 1] = null;
    updateCharSelectBox(i);
  });
});

document.getElementById('characterPickerSearch').addEventListener('input', debounce(e => {
  renderCharacterPickerGrid(document.getElementById('characterPickerSearch').value);
}, 150));

function resetForm() {
  document.getElementById('trainingForm').reset();
  setRadioValue('fStatus', 'not_started', 'not_started');
  setRadioValue('fEventType', 'champions', 'champions');
  charSelections = [null, null, null];
  [1, 2, 3].forEach(updateCharSelectBox);
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
  document.getElementById('fMonth').value = plan.month || '';
  document.getElementById('fTitle').value = plan.title || '';
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
  charSelections = [1, 2, 3].map(i => {
    const c = characters[i - 1];
    if (!c) return null;
    const uma = c.id ? cachedUmas.find(u => u.id === c.id) : cachedUmas.find(u => u.name === c.name);
    return uma
      ? { id: uma.id, name: uma.name, imagePath: uma.imagePath || null }
      : { id: c.id || null, name: c.name, imagePath: null };
  });
  [1, 2, 3].forEach(updateCharSelectBox);

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
  return charSelections
    .filter(Boolean)
    .map(c => ({ id: c.id || null, name: c.name }));
}

// --- 保存 ---
document.getElementById('trainingForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!config || !config.token) { setStatus('保存にはPATが必要です。設定でPATを入力してください。', true); return; }

  const planId = editingPlanId || ('training_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const distanceRaw = document.getElementById('fDistance').value;
  const plan = {
    id: planId,
    month: document.getElementById('fMonth').value,
    title: document.getElementById('fTitle').value.trim(),
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
    await savePlansToGitHub(updated, `${isEditing ? '育成計画編集' : '育成計画追加'}: ${planLabel(plan)}`);
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
  document.getElementById('confirmDeleteMessage').textContent = `「${planLabel(plan)}」の育成計画を削除します。この操作は取り消せません。よろしいですか？`;
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
    await savePlansToGitHub(updated, `育成計画削除: ${target ? planLabel(target) : id}`);
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
    return;
  }
  const icon = e.target.closest('.plan-char-icon');
  if (icon) { openLightbox(icon.src); return; }
  const row = e.target.closest('.entry');
  if (row && row.dataset.id) openPlanDetail(row.dataset.id);
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
      row.className = 'entry entry-clickable';
      row.dataset.id = plan.id;
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

      const charChipsHtml = (plan.characters || []).map(c => {
        const uma = c.id ? cachedUmas.find(u => u.id === c.id) : cachedUmas.find(u => u.name === c.name);
        const imageUrl = uma && uma.imagePath ? imageRawUrl(uma.imagePath) : null;
        return `
          <div class="plan-char-chip">
            ${imageUrl ? `<img class="uma-icon plan-char-icon" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(c.name)}" loading="lazy">` : ''}
            <span>${escapeHtml(c.name)}</span>
          </div>
        `;
      }).join('');
      const monthLabel = formatMonthLabel(plan.month);

      row.innerHTML = `
        <div class="entry-main">
          <div class="entry-name-row">
            ${monthLabel ? `<span class="apt-badge">${escapeHtml(monthLabel)}</span>` : ''}
            <div class="entry-name">${plan.title ? escapeHtml(plan.title) : '（タイトル未設定）'}</div>
          </div>
          <div class="apt-row">
            <span class="apt-badge">${eventTypeLabel}</span>
          </div>
          ${raceConditionLabel ? `<div class="entry-notes">${escapeHtml(raceConditionLabel)}</div>` : ''}
          ${charChipsHtml ? `<div class="apt-group owner-group"><span class="apt-group-label">育成予定</span><div class="plan-char-row">${charChipsHtml}</div></div>` : ''}
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

// --- 育成計画詳細ポップアップ(タップで開く) ---
function openPlanDetail(id) {
  const plan = allPlans.find(p => p.id === id);
  if (!plan) return;
  const body = document.getElementById('planDetailBody');
  body.innerHTML = renderPlanDetailHtml(plan);
  body.querySelectorAll('.plan-detail-char').forEach(el => {
    el.addEventListener('click', () => openCharacterConfig(plan.id, Number(el.dataset.index)));
  });
  openModal('planDetailModal');
}

function renderPlanDetailHtml(plan) {
  const monthLabel = formatMonthLabel(plan.month);
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

  const charCardsHtml = (plan.characters || []).map((c, idx) => {
    const uma = c.id ? cachedUmas.find(u => u.id === c.id) : cachedUmas.find(u => u.name === c.name);
    const imageUrl = uma && uma.imagePath ? imageRawUrl(uma.imagePath) : null;
    const deckCount = (c.supportDeck || []).filter(Boolean).length;
    return `
      <div class="plan-char-chip plan-detail-char" data-index="${idx}">
        ${imageUrl ? `<img class="uma-icon" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(c.name)}" loading="lazy">` : ''}
        <span>${escapeHtml(c.name)}${deckCount ? `<br><small>サポカ${deckCount}/6</small>` : ''}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="entry-name-row">
      ${monthLabel ? `<span class="apt-badge">${escapeHtml(monthLabel)}</span>` : ''}
      <div class="entry-name">${plan.title ? escapeHtml(plan.title) : '（タイトル未設定）'}</div>
    </div>
    <div class="apt-row"><span class="apt-badge">${eventTypeLabel}</span></div>
    ${raceConditionLabel ? `<div class="entry-notes">${escapeHtml(raceConditionLabel)}</div>` : ''}
    ${charCardsHtml ? `<div class="apt-group owner-group"><span class="apt-group-label">育成予定(タップして編成を設定)</span><div class="plan-char-row">${charCardsHtml}</div></div>` : ''}
    ${plan.notes ? `<div class="entry-notes">${escapeHtml(plan.notes)}</div>` : ''}
  `;
}

// --- キャラ編成ポップアップ(サポカ編成6枚) ---
let configTargetPlanId = null;
let configTargetCharIndex = null;
let configDeckSelections = [null, null, null, null, null, null];

function openCharacterConfig(planId, charIndex) {
  const plan = allPlans.find(p => p.id === planId);
  if (!plan) return;
  const character = (plan.characters || [])[charIndex];
  if (!character) return;
  configTargetPlanId = planId;
  configTargetCharIndex = charIndex;
  configDeckSelections = [0, 1, 2, 3, 4, 5].map(i => {
    const d = (character.supportDeck || [])[i];
    if (!d) return null;
    const card = d.id ? cachedSupportCards.find(c => c.id === d.id) : cachedSupportCards.find(c => c.name === d.name);
    return card
      ? { id: card.id, name: card.name, imagePath: card.imagePath || null }
      : { id: d.id || null, name: d.name, imagePath: null };
  });
  document.getElementById('characterConfigTitle').textContent = `${character.name}の編成`;
  renderCharacterConfigBody();
  const statusEl = document.getElementById('characterConfigStatus');
  statusEl.textContent = '';
  statusEl.className = 'status';
  document.getElementById('planDetailModal').hidden = true;
  document.getElementById('characterConfigModal').hidden = false;
}

function closeCharacterConfig() {
  document.getElementById('characterConfigModal').hidden = true;
  document.getElementById('planDetailModal').hidden = false;
}
document.getElementById('characterConfigBackBtn').addEventListener('click', closeCharacterConfig);

function renderCharacterConfigBody() {
  const body = document.getElementById('characterConfigBody');
  body.innerHTML = `
    <label>サポカ編成（6枚）</label>
    <div class="support-deck-grid">
      ${[0, 1, 2, 3, 4, 5].map(i => `
        <div class="team-slot">
          <div class="char-select-box" id="deckSlotBox${i}">
            <div id="deckSlotEmpty${i}">タップして選択</div>
            <div class="char-select-filled-inner" id="deckSlotFilled${i}" hidden>
              <img class="uma-icon" id="deckSlotIcon${i}" alt="">
              <span id="deckSlotName${i}"></span>
            </div>
          </div>
          <button type="button" class="btn secondary btn-inline" id="deckSlotClearBtn${i}" hidden>選択を解除</button>
        </div>
      `).join('')}
    </div>
  `;
  [0, 1, 2, 3, 4, 5].forEach(i => {
    updateDeckSlotBox(i);
    document.getElementById('deckSlotBox' + i).addEventListener('click', () => openSupportCardPicker(i));
    document.getElementById('deckSlotClearBtn' + i).addEventListener('click', e => {
      e.stopPropagation();
      configDeckSelections[i] = null;
      updateDeckSlotBox(i);
    });
  });
}

function updateDeckSlotBox(i) {
  const sel = configDeckSelections[i];
  const box = document.getElementById('deckSlotBox' + i);
  const emptyEl = document.getElementById('deckSlotEmpty' + i);
  const filledEl = document.getElementById('deckSlotFilled' + i);
  const iconEl = document.getElementById('deckSlotIcon' + i);
  const nameEl = document.getElementById('deckSlotName' + i);
  const clearBtn = document.getElementById('deckSlotClearBtn' + i);
  if (sel) {
    box.classList.add('filled');
    emptyEl.hidden = true;
    filledEl.hidden = false;
    if (sel.imagePath) {
      iconEl.src = imageRawUrl(sel.imagePath);
      iconEl.hidden = false;
    } else {
      iconEl.hidden = true;
    }
    nameEl.textContent = sel.name;
    clearBtn.hidden = false;
  } else {
    box.classList.remove('filled');
    emptyEl.hidden = false;
    filledEl.hidden = true;
    clearBtn.hidden = true;
  }
}

document.getElementById('characterConfigSaveBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('characterConfigStatus');
  if (!config || !config.token) {
    statusEl.textContent = '保存にはPATが必要です。設定でPATを入力してください。';
    statusEl.className = 'status error';
    return;
  }
  const plan = allPlans.find(p => p.id === configTargetPlanId);
  if (!plan) return;
  const character = (plan.characters || [])[configTargetCharIndex];
  if (!character) return;
  character.supportDeck = configDeckSelections.map(sel => sel ? { id: sel.id, name: sel.name } : null);
  const updated = allPlans.map(p => p.id === plan.id ? plan : p);
  statusEl.textContent = '保存しています…';
  statusEl.className = 'status';
  const saveBtn = document.getElementById('characterConfigSaveBtn');
  saveBtn.disabled = true;
  try {
    await savePlansToGitHub(updated, `育成計画サポカ編成更新: ${character.name}`);
    allPlans = sortPlans(updated);
    statusEl.textContent = '保存しました。';
    renderPlans();
  } catch (err) {
    console.error(err);
    if (err instanceof ConflictError) {
      statusEl.textContent = '他の端末で更新されています。「更新」ボタンで最新を取得してからもう一度保存してください。';
    } else {
      statusEl.textContent = '保存中にエラーが発生しました: ' + err.message;
    }
    statusEl.className = 'status error';
  } finally {
    saveBtn.disabled = false;
  }
});

// --- サポートカード選択ピッカー ---
let deckPickerTargetSlot = null;

function openSupportCardPicker(slot) {
  deckPickerTargetSlot = slot;
  document.getElementById('supportCardPickerSearch').value = '';
  renderSupportCardPickerGrid('');
  document.getElementById('characterConfigModal').hidden = true;
  document.getElementById('supportCardPickerModal').hidden = false;
}

function closeSupportCardPicker() {
  document.getElementById('supportCardPickerModal').hidden = true;
  document.getElementById('characterConfigModal').hidden = false;
}
document.getElementById('supportCardPickerCloseBtn').addEventListener('click', closeSupportCardPicker);

function renderSupportCardPickerGrid(keyword) {
  const grid = document.getElementById('supportCardPickerGrid');
  const kw = keyword.trim().toLowerCase();
  const filtered = kw ? cachedSupportCards.filter(c => (c.name || '').toLowerCase().includes(kw)) : cachedSupportCards;
  grid.innerHTML = '';
  const fragment = document.createDocumentFragment();
  filtered.forEach(c => {
    const tile = document.createElement('div');
    tile.className = 'character-picker-tile';
    const imageUrl = c.imagePath ? imageRawUrl(c.imagePath) : '';
    tile.innerHTML = `
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(c.name)}" loading="lazy">` : ''}
      <span>${escapeHtml(c.name)}</span>
    `;
    tile.addEventListener('click', () => selectSupportCard(c));
    fragment.appendChild(tile);
  });
  grid.appendChild(fragment);
  document.getElementById('supportCardPickerStatus').textContent = cachedSupportCards.length
    ? (filtered.length ? '' : '該当するサポートカードが見つかりません。')
    : 'サポカ図鑑にまだ登録がありません。';
}

function selectSupportCard(c) {
  if (deckPickerTargetSlot == null) return;
  configDeckSelections[deckPickerTargetSlot] = { id: c.id, name: c.name, imagePath: c.imagePath || null };
  updateDeckSlotBox(deckPickerTargetSlot);
  closeSupportCardPicker();
}

document.getElementById('supportCardPickerSearch').addEventListener('input', debounce(() => {
  renderSupportCardPickerGrid(document.getElementById('supportCardPickerSearch').value);
}, 150));

resetForm();
loadPlans();
loadCachedUmas().then(renderPlans);
loadCachedSupportCards();
