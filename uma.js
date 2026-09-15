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
// 各要素は { name: string, type: 'unique' | 'gold' | 'normal' }
const skillTags = [];

function nextSkillType(type) {
  if (type === 'gold') return 'unique';
  if (type === 'unique') return 'normal';
  return 'gold';
}

function normalizeSkill(s) {
  return typeof s === 'string' ? { name: s, type: 'normal' } : { name: s.name || '', type: s.type || 'normal' };
}

function renderSkillTags() {
  const box = document.getElementById('skillTagBox');
  box.querySelectorAll('.tag-chip').forEach(el => el.remove());
  const input = box.querySelector('input');
  skillTags.forEach((skill, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip skill-chip skill-' + (skill.type || 'normal');
    chip.innerHTML = `${escapeHtml(skill.name)}<button type="button" class="tag-remove" aria-label="削除">×</button>`;
    chip.addEventListener('click', e => {
      if (e.target.closest('.tag-remove')) return;
      skill.type = nextSkillType(skill.type);
      renderSkillTags();
    });
    chip.querySelector('.tag-remove').addEventListener('click', e => {
      e.stopPropagation();
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
    skillTags.push({ name: val, type: 'normal' });
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

// --- 画像添付(キャラアイコン) ---
const imageDropzone = document.getElementById('imageDropzone');
const fImage = document.getElementById('fImage');
const imagePreview = document.getElementById('imagePreview');
const imagePreviewWrap = document.getElementById('imagePreviewWrap');
const imageDropzoneHint = document.getElementById('imageDropzoneHint');
const removeImageBtn = document.getElementById('removeImageBtn');

let pendingImageDataUrl = null;
let currentImagePath = null;
let removeImageFlag = false;

function showImagePreview(src) {
  imagePreview.src = src;
  imagePreviewWrap.hidden = false;
  imageDropzoneHint.hidden = true;
  removeImageBtn.hidden = false;
}
function hideImagePreview() {
  imagePreview.src = '';
  imagePreviewWrap.hidden = true;
  imageDropzoneHint.hidden = false;
  removeImageBtn.hidden = true;
}

imageDropzone.addEventListener('click', () => fImage.click());

fImage.addEventListener('change', async () => {
  const file = fImage.files[0];
  if (!file) return;
  try {
    setStatus('画像を処理しています…');
    pendingImageDataUrl = await resizeImageFile(file, 600, 0.85);
    removeImageFlag = false;
    showImagePreview(pendingImageDataUrl);
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus('画像の処理に失敗しました: ' + err.message, true);
  }
});

removeImageBtn.addEventListener('click', e => {
  e.stopPropagation();
  pendingImageDataUrl = null;
  fImage.value = '';
  if (currentImagePath) removeImageFlag = true;
  hideImagePreview();
});

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
  pendingImageDataUrl = null;
  currentImagePath = null;
  removeImageFlag = false;
  hideImagePreview();
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
  (parsed.skills || []).forEach(s => skillTags.push(normalizeSkill(s)));
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
  if (uma.imagePath) {
    currentImagePath = uma.imagePath;
    showImagePreview(imageRawUrl(uma.imagePath));
  }
  openModal('umaModal');
}

// --- 保存 ---
document.getElementById('umaForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!config || !config.token) { setStatus('保存にはPATが必要です。設定でPATを入力してください。', true); return; }
  const name = document.getElementById('fName').value.trim();
  if (!name) { setStatus('名前を入力してください。', true); return; }

  const umaId = editingUmaId || ('uma_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const uma = {
    id: umaId,
    name,
    imagePath: removeImageFlag ? null : (currentImagePath || null),
    skills: skillTags.map(s => ({ name: s.name, type: s.type || 'normal' })),
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
    if (pendingImageDataUrl) {
      setStatus('画像をアップロードしています…');
      const imagePath = `images/${umaId}.jpg`;
      await uploadImageToGitHub(imagePath, pendingImageDataUrl, `ウマ娘画像アップロード: ${name}`);
      uma.imagePath = imagePath;
    } else if (removeImageFlag && currentImagePath) {
      setStatus('画像を削除しています…');
      await deleteImageFromGitHub(currentImagePath, `ウマ娘画像削除: ${name}`);
      uma.imagePath = null;
    }
    setStatus(isEditing ? '更新しています…' : '保存しています…');
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
function aptBadge(prefix, v) {
  const rankClass = v ? 'rank-' + v : 'rank-none';
  return `<span class="apt-badge ${rankClass}">${prefix}${aptLabel(v)}</span>`;
}

const RANK_ORDER = { S: 8, A: 7, B: 6, C: 5, D: 4, E: 3, F: 2, G: 1 };
function rankValue(v) { return RANK_ORDER[v] || 0; }

function getAptValue(uma, path) {
  const [group, key] = path.split('.');
  return uma[group] && uma[group][key];
}

const APT_FILTER_FIELDS = [
  { id: 'filterTurf', path: 'track.turf' },
  { id: 'filterDirt', path: 'track.dirt' },
  { id: 'filterShort', path: 'distance.short' },
  { id: 'filterMile', path: 'distance.mile' },
  { id: 'filterMedium', path: 'distance.medium' },
  { id: 'filterLong', path: 'distance.long' },
  { id: 'filterNige', path: 'style.nige' },
  { id: 'filterSenko', path: 'style.senko' },
  { id: 'filterSashi', path: 'style.sashi' },
  { id: 'filterOikomi', path: 'style.oikomi' },
];
const aptSearchLte = document.getElementById('aptSearchLte');
APT_FILTER_FIELDS.forEach(f => document.getElementById(f.id).addEventListener('change', renderUmas));
aptSearchLte.addEventListener('change', renderUmas);

function renderUmas() {
  const container = document.getElementById('entries');
  const emptyMsg = document.getElementById('emptyMsg');
  container.innerHTML = '';

  document.getElementById('countLabel').textContent = allUmas.length + ' 頭 登録';

  const activeFilters = APT_FILTER_FIELDS
    .map(f => ({ path: f.path, rank: document.getElementById(f.id).value }))
    .filter(f => f.rank);
  const lte = aptSearchLte.checked;
  const filtered = allUmas.filter(uma => {
    return activeFilters.every(f => {
      const val = getAptValue(uma, f.path);
      if (!val) return false;
      return lte ? rankValue(val) <= rankValue(f.rank) : rankValue(val) >= rankValue(f.rank);
    });
  });

  if (!filtered.length) {
    emptyMsg.style.display = 'block';
    emptyMsg.textContent = allUmas.length ? '該当する登録が見つかりません。' : 'まだ登録がありません。「＋ ウマ娘登録」からClaudeの出力を貼り付けるか、手入力して保存してください。';
    return;
  }
  emptyMsg.style.display = 'none';

  filtered.forEach(uma => {
    const row = document.createElement('div');
    row.className = 'entry';
    const skillChips = (uma.skills || []).map(s => {
      const skill = normalizeSkill(s);
      return `<span class="chip white skill-chip skill-${skill.type}">${escapeHtml(skill.name)}</span>`;
    }).join('');
    const growthLabels = { speed: 'スピ', stamina: 'スタ', power: 'パワ', guts: '根性', wisdom: '賢さ' };
    const growthItemsHtml = Object.entries(growthLabels)
      .filter(([key]) => uma.growth[key])
      .map(([key, label]) => `<span class="growth-item">${label}+${uma.growth[key]}%</span>`)
      .join('');
    const growthText = growthItemsHtml ? `<span class="growth-item">成長率:</span>${growthItemsHtml}` : '';
    const imageUrl = uma.imagePath ? imageRawUrl(uma.imagePath) : null;
    row.innerHTML = `
      <div class="entry-main">
        <div class="entry-name-row">
          <div class="entry-name">${escapeHtml(uma.name)}</div>
        </div>
        ${imageUrl ? `<img class="uma-icon" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(uma.name)}" loading="lazy">` : ''}
        <div class="apt-group">
          <span class="apt-group-label">コース</span>
          <div class="apt-row">
            ${aptBadge('芝', uma.track.turf)}
            ${aptBadge('ダ', uma.track.dirt)}
          </div>
        </div>
        <div class="apt-group">
          <span class="apt-group-label">距離</span>
          <div class="apt-row">
            ${aptBadge('短', uma.distance.short)}
            ${aptBadge('マ', uma.distance.mile)}
            ${aptBadge('中', uma.distance.medium)}
            ${aptBadge('長', uma.distance.long)}
          </div>
        </div>
        <div class="apt-group">
          <span class="apt-group-label">脚質</span>
          <div class="apt-row">
            ${aptBadge('逃', uma.style.nige)}
            ${aptBadge('先', uma.style.senko)}
            ${aptBadge('差', uma.style.sashi)}
            ${aptBadge('追', uma.style.oikomi)}
          </div>
        </div>
        ${growthText ? `<div class="growth-row">${growthText}</div>` : ''}
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
    const icon = row.querySelector('.uma-icon');
    if (icon) icon.addEventListener('click', () => openLightbox(imageUrl));
    container.appendChild(row);
  });
}

resetForm();
loadUmas();
