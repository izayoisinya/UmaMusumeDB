// uma.js — ウマ娘図鑑ページ固有ロジック

const DATA_PATH = 'data/uma_musume.json';

class ConflictError extends Error {
  constructor() {
    super('conflict');
    this.name = 'ConflictError';
  }
}

let currentSha = null;
let allUmas = [];
let editingUmaId = null;

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

async function fetchUmasRaw() {
  const res = await fetch(contentsApiUrlForGet(), { headers: authHeaders() });
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

async function saveUmasToGitHub(newEntries, commitMessage) {
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

function sortByName(list) {
  return list.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
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

async function loadUmas() {
  setListStatus('読み込み中…');
  try {
    const { sha, entries } = await fetchUmasRaw();
    currentSha = sha;
    allUmas = sortByName(entries);
    setListStatus('');
  } catch (err) {
    console.error(err);
    setListStatus('読み込みに失敗しました: ' + err.message, true);
  }
  renderUmas();
}

// common.jsのGitHub連携設定フォーム(保存/消去)から呼ばれるフック
function onGithubConfigChanged() {
  allUmas = [];
  currentSha = null;
  return loadUmas();
}

// --- 所持スキルのタグ入力 ---
const skillTags = [];

function renderSkillTags() {
  const box = document.getElementById('skillTagBox');
  box.querySelectorAll('.tag-chip').forEach(el => el.remove());
  const input = box.querySelector('input');
  skillTags.forEach((tag, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${escapeHtml(tag)}<button type="button" class="tag-remove" aria-label="削除">×</button>`;
    chip.querySelector('.tag-remove').addEventListener('click', () => {
      skillTags.splice(i, 1);
      renderSkillTags();
    });
    box.insertBefore(chip, input);
  });
}

const skillTagInput = document.getElementById('skillTagInput');
const commitSkillTag = () => {
  const val = skillTagInput.value.trim();
  if (val) {
    skillTags.push(val);
    skillTagInput.value = '';
    renderSkillTags();
  }
};
skillTagInput.addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === 'Enter' || e.key === ',' || e.key === '、') {
    e.preventDefault();
    commitSkillTag();
  } else if (e.key === 'Backspace' && !skillTagInput.value && skillTags.length) {
    skillTags.pop();
    renderSkillTags();
  }
});
skillTagInput.addEventListener('blur', () => { if (skillTagInput.value.trim()) commitSkillTag(); });

// --- フォーム操作 ---
function setUmaModalMode(isEditing) {
  editingUmaId = isEditing;
  document.getElementById('umaModalTitle').textContent = isEditing ? 'ウマ娘を編集' : 'ウマ娘を登録';
  document.getElementById('saveUmaBtn').textContent = isEditing ? 'この内容で更新' : 'この内容を保存';
}

function resetForm() {
  document.getElementById('umaForm').reset();
  skillTags.length = 0;
  renderSkillTags();
  document.getElementById('pasteJson').value = '';
  setStatus('');
  setUmaModalMode(null);
}

document.getElementById('openRegisterModalBtn').addEventListener('click', () => {
  resetForm();
  setUmaModalMode(null);
  openModal('umaModal');
});

function setSelectValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || '';
}

function fillForm(parsed) {
  document.getElementById('fName').value = parsed.name || '';
  skillTags.length = 0;
  (parsed.skills || []).forEach(s => skillTags.push(s));
  renderSkillTags();
  const track = parsed.track || {};
  const distance = parsed.distance || {};
  const style = parsed.style || {};
  const growth = parsed.growth || {};
  setSelectValue('fTurf', track.turf);
  setSelectValue('fDirt', track.dirt);
  setSelectValue('fShort', distance.short);
  setSelectValue('fMile', distance.mile);
  setSelectValue('fMedium', distance.medium);
  setSelectValue('fLong', distance.long);
  setSelectValue('fNige', style.nige);
  setSelectValue('fSenko', style.senko);
  setSelectValue('fSashi', style.sashi);
  setSelectValue('fOikomi', style.oikomi);
  document.getElementById('fGrowthSpeed').value = growth.speed || 0;
  document.getElementById('fGrowthStamina').value = growth.stamina || 0;
  document.getElementById('fGrowthPower').value = growth.power || 0;
  document.getElementById('fGrowthGuts').value = growth.guts || 0;
  document.getElementById('fGrowthWisdom').value = growth.wisdom || 0;
}

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

document.getElementById('clearBtn').addEventListener('click', resetForm);

function startEditUma(id) {
  const uma = allUmas.find(u => u.id === id);
  if (!uma) return;
  resetForm();
  setUmaModalMode(id);
  fillForm(uma);
  document.getElementById('fNotes').value = uma.notes || '';
  openModal('umaModal');
}

// --- 保存 ---
document.getElementById('umaForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!config || !config.token) { setStatus('保存にはPATが必要です。設定でPATを入力してください。', true); return; }
  const name = document.getElementById('fName').value.trim();
  if (!name) { setStatus('名前を入力してください。', true); return; }

  const uma = {
    id: editingUmaId || ('uma_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
    name,
    skills: skillTags.slice(),
    track: {
      turf: document.getElementById('fTurf').value,
      dirt: document.getElementById('fDirt').value,
    },
    distance: {
      short: document.getElementById('fShort').value,
      mile: document.getElementById('fMile').value,
      medium: document.getElementById('fMedium').value,
      long: document.getElementById('fLong').value,
    },
    style: {
      nige: document.getElementById('fNige').value,
      senko: document.getElementById('fSenko').value,
      sashi: document.getElementById('fSashi').value,
      oikomi: document.getElementById('fOikomi').value,
    },
    growth: {
      speed: Number(document.getElementById('fGrowthSpeed').value) || 0,
      stamina: Number(document.getElementById('fGrowthStamina').value) || 0,
      power: Number(document.getElementById('fGrowthPower').value) || 0,
      guts: Number(document.getElementById('fGrowthGuts').value) || 0,
      wisdom: Number(document.getElementById('fGrowthWisdom').value) || 0,
    },
    notes: document.getElementById('fNotes').value.trim(),
    savedAt: new Date().toISOString(),
  };

  const isEditing = !!editingUmaId;
  const updated = isEditing
    ? allUmas.map(u => u.id === editingUmaId ? uma : u)
    : [uma, ...allUmas];
  setStatus(isEditing ? '更新しています…' : '保存しています…');
  const saveBtn = document.getElementById('saveUmaBtn');
  saveBtn.disabled = true;
  try {
    await saveUmasToGitHub(updated, `${isEditing ? 'ウマ娘編集' : 'ウマ娘登録'}: ${name}`);
    allUmas = sortByName(updated);
    renderUmas();
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

function askDeleteConfirm(uma, btn) {
  pendingDeleteId = uma.id;
  pendingDeleteBtn = btn;
  document.getElementById('confirmDeleteMessage').textContent = `「${uma.name}」を削除します。この操作は取り消せません。よろしいですか？`;
  openModal('confirmDeleteModal');
}

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
  const id = pendingDeleteId;
  const btn = pendingDeleteBtn;
  pendingDeleteId = null;
  pendingDeleteBtn = null;
  closeModal();
  deleteUma(id, btn);
});

async function deleteUma(id, btn) {
  if (!config || !config.token) { setListStatus('削除にはPATが必要です。設定でPATを入力してください。', true); return; }
  const target = allUmas.find(u => u.id === id);
  const updated = allUmas.filter(u => u.id !== id);
  setListStatus('削除しています…');
  if (btn) btn.disabled = true;
  try {
    await saveUmasToGitHub(updated, `ウマ娘削除: ${target ? target.name : id}`);
    allUmas = updated;
    setListStatus('');
    renderUmas();
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

document.getElementById('refreshBtn').addEventListener('click', () => loadUmas());

// --- 一覧表示 ---
function aptLabel(v) { return v ? v : '-'; }

function renderUmas() {
  const container = document.getElementById('entries');
  const emptyMsg = document.getElementById('emptyMsg');
  container.innerHTML = '';

  document.getElementById('countLabel').textContent = allUmas.length + ' 頭 登録';

  if (!allUmas.length) {
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';

  allUmas.forEach(uma => {
    const row = document.createElement('div');
    row.className = 'entry';
    const skillChips = (uma.skills || []).map(s => `<span class="chip white">${escapeHtml(s)}</span>`).join('');
    row.innerHTML = `
      <div class="entry-main">
        <div class="entry-name-row">
          <div class="entry-name">${escapeHtml(uma.name)}</div>
        </div>
        <div class="apt-row">
          <span class="apt-badge">芝${aptLabel(uma.track.turf)}</span>
          <span class="apt-badge">ダ${aptLabel(uma.track.dirt)}</span>
          <span class="apt-badge">短${aptLabel(uma.distance.short)}</span>
          <span class="apt-badge">マ${aptLabel(uma.distance.mile)}</span>
          <span class="apt-badge">中${aptLabel(uma.distance.medium)}</span>
          <span class="apt-badge">長${aptLabel(uma.distance.long)}</span>
          <span class="apt-badge">逃${aptLabel(uma.style.nige)}</span>
          <span class="apt-badge">先${aptLabel(uma.style.senko)}</span>
          <span class="apt-badge">差${aptLabel(uma.style.sashi)}</span>
          <span class="apt-badge">追${aptLabel(uma.style.oikomi)}</span>
        </div>
        <div class="growth-row">成長率: スピ+${uma.growth.speed}% スタ+${uma.growth.stamina}% パワ+${uma.growth.power}% 根性+${uma.growth.guts}% 賢さ+${uma.growth.wisdom}%</div>
        <div class="chips">${skillChips || '<span style="color:var(--ink-soft);font-size:12px;">スキル未登録</span>'}</div>
        ${uma.notes ? `<div class="entry-notes">${escapeHtml(uma.notes)}</div>` : ''}
      </div>
      <div class="entry-side">
        <div class="entry-actions">
          <button class="entry-edit" data-id="${uma.id}">編集</button>
          <button class="entry-del" data-id="${uma.id}">削除</button>
        </div>
      </div>
    `;
    row.querySelector('.entry-edit').addEventListener('click', () => startEditUma(uma.id));
    row.querySelector('.entry-del').addEventListener('click', e => askDeleteConfirm(uma, e.currentTarget));
    container.appendChild(row);
  });
}

resetForm();
loadUmas();
