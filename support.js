// support.js — サポカ図鑑ページ固有ロジック

const DATA_PATH = 'data/support_cards.json';

class ConflictError extends Error {
  constructor() {
    super('conflict');
    this.name = 'ConflictError';
  }
}

let currentSha = null;
let allCards = [];
let editingCardId = null;
let skillCategoryIndex = new Map(); // スキル名 -> categories配列（スキルブックより）

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

// --- スキル名 -> スキルブック上の種別カラー索引 ---
const CHIP_COLOR_CATEGORIES = new Set(['green', 'heal', 'debuff']);
async function loadSkillCategoryIndex() {
  try {
    const skills = await fetchJsonFile('data/skills.json');
    const index = new Map();
    skills.forEach(s => {
      if (s && s.name) index.set(s.name, s.categories || []);
    });
    skillCategoryIndex = index;
    renderCards();
  } catch (err) {
    console.error('スキル種別の索引作成に失敗:', err);
  }
}
function skillChipCategoryClass(skillName) {
  const categories = skillCategoryIndex.get(skillName) || [];
  return categories.filter(c => CHIP_COLOR_CATEGORIES.has(c)).map(c => `cat-${c}`).join(' ');
}

async function fetchCardsRaw() {
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

async function saveCardsToGitHub(newEntries, commitMessage) {
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

async function loadCards() {
  setListStatus('読み込み中…');
  try {
    const { sha, entries } = await fetchCardsRaw();
    currentSha = sha;
    allCards = sortByName(entries);
    setListStatus('');
  } catch (err) {
    console.error(err);
    setListStatus('読み込みに失敗しました: ' + err.message, true);
  }
  renderCards();
}

// common.jsのGitHub連携設定フォーム(保存/消去)から呼ばれるフック
function onGithubConfigChanged() {
  allCards = [];
  currentSha = null;
  return loadCards();
}

// --- スキルのタグ入力(所持スキル・育成イベントスキル共通) ---
function normalizeSkill(s) {
  return typeof s === 'string' ? { name: s, type: 'normal' } : { name: s.name || '', type: s.type || 'normal' };
}
function nextSkillType(type) {
  return type === 'gold' ? 'normal' : 'gold';
}

function createSkillTagManager(boxId, inputId) {
  const tags = [];
  function render() {
    const box = document.getElementById(boxId);
    box.querySelectorAll('.tag-chip').forEach(el => el.remove());
    const input = box.querySelector('input');
    tags.forEach((skill, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip skill-chip skill-' + (skill.type || 'normal');
      chip.innerHTML = `${escapeHtml(skill.name)}<button type="button" class="tag-remove" aria-label="削除">×</button>`;
      chip.addEventListener('click', e => {
        if (e.target.closest('.tag-remove')) return;
        skill.type = nextSkillType(skill.type);
        render();
      });
      chip.querySelector('.tag-remove').addEventListener('click', e => {
        e.stopPropagation();
        tags.splice(i, 1);
        render();
      });
      box.insertBefore(chip, input);
    });
  }
  const input = document.getElementById(inputId);
  const commit = () => {
    const val = input.value.trim();
    if (val) {
      tags.push({ name: val, type: 'normal' });
      input.value = '';
      render();
    }
  };
  input.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter' || e.key === ',' || e.key === '、') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      tags.pop();
      render();
    }
  });
  input.addEventListener('blur', () => { if (input.value.trim()) commit(); });
  return {
    render,
    reset() { tags.length = 0; render(); },
    set(list) { tags.length = 0; (list || []).forEach(s => tags.push(normalizeSkill(s))); render(); },
    get() { return tags.map(s => ({ name: s.name, type: s.type || 'normal' })); },
  };
}

const skillManager = createSkillTagManager('skillTagBox', 'skillTagInput');
const eventSkillManager = createSkillTagManager('eventSkillTagBox', 'eventSkillTagInput');

// --- タイプ(複数選択) ---
function getSelectedTypes() {
  return Array.from(document.querySelectorAll('.fType:checked')).map(el => el.value);
}
function setSelectedTypes(types) {
  const set = new Set(types || []);
  document.querySelectorAll('.fType').forEach(el => { el.checked = set.has(el.value); });
}

// --- フォーム操作 ---
function setSupportModalMode(isEditing) {
  editingCardId = isEditing;
  document.getElementById('supportModalTitle').textContent = isEditing ? 'サポカを編集' : 'サポカを登録';
  document.getElementById('saveSupportBtn').textContent = isEditing ? 'この内容で更新' : 'この内容を保存';
}

// --- 画像添付(サポカイラスト) ---
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
    pendingImageDataUrl = await resizeImageFile(file, 1000, 0.8);
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

function resetForm() {
  document.getElementById('supportForm').reset();
  skillManager.reset();
  eventSkillManager.reset();
  setSelectedTypes([]);
  document.getElementById('pasteJson').value = '';
  pendingImageDataUrl = null;
  currentImagePath = null;
  removeImageFlag = false;
  hideImagePreview();
  setStatus('');
  setSupportModalMode(null);
}

document.getElementById('openRegisterModalBtn').addEventListener('click', () => {
  resetForm();
  setSupportModalMode(null);
  openModal('supportModal');
});

function fillForm(parsed) {
  document.getElementById('fName').value = parsed.name || '';
  setSelectedTypes(parsed.types);
  skillManager.set(parsed.skills);
  eventSkillManager.set(parsed.eventSkills);
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

function startEditCard(id) {
  const card = allCards.find(c => c.id === id);
  if (!card) return;
  resetForm();
  setSupportModalMode(id);
  fillForm(card);
  document.getElementById('fNotes').value = card.notes || '';
  if (card.imagePath) {
    currentImagePath = card.imagePath;
    showImagePreview(imageRawUrl(card.imagePath));
  }
  openModal('supportModal');
}

// --- 保存 ---
document.getElementById('supportForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!config || !config.token) { setStatus('保存にはPATが必要です。設定でPATを入力してください。', true); return; }
  const name = document.getElementById('fName').value.trim();
  if (!name) { setStatus('名前を入力してください。', true); return; }

  const cardId = editingCardId || ('support_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const card = {
    id: cardId,
    name,
    imagePath: removeImageFlag ? null : (currentImagePath || null),
    types: getSelectedTypes(),
    skills: skillManager.get(),
    eventSkills: eventSkillManager.get(),
    notes: document.getElementById('fNotes').value.trim(),
    savedAt: new Date().toISOString(),
  };

  const isEditing = !!editingCardId;
  const updated = isEditing
    ? allCards.map(c => c.id === editingCardId ? card : c)
    : [card, ...allCards];
  setStatus(isEditing ? '更新しています…' : '保存しています…');
  const saveBtn = document.getElementById('saveSupportBtn');
  saveBtn.disabled = true;
  try {
    if (pendingImageDataUrl) {
      setStatus('画像をアップロードしています…');
      const imagePath = `images/${cardId}.jpg`;
      await uploadImageToGitHub(imagePath, pendingImageDataUrl, `サポカ画像アップロード: ${name}`);
      card.imagePath = imagePath;
    } else if (removeImageFlag && currentImagePath) {
      setStatus('画像を削除しています…');
      await deleteImageFromGitHub(currentImagePath, `サポカ画像削除: ${name}`);
      card.imagePath = null;
    }
    setStatus(isEditing ? '更新しています…' : '保存しています…');
    await saveCardsToGitHub(updated, `${isEditing ? 'サポカ編集' : 'サポカ登録'}: ${name}`);
    allCards = sortByName(updated);
    renderCards();
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

function askDeleteConfirm(card, btn) {
  pendingDeleteId = card.id;
  pendingDeleteBtn = btn;
  document.getElementById('confirmDeleteMessage').textContent = `「${card.name}」を削除します。この操作は取り消せません。よろしいですか？`;
  openModal('confirmDeleteModal');
}

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
  const id = pendingDeleteId;
  const btn = pendingDeleteBtn;
  pendingDeleteId = null;
  pendingDeleteBtn = null;
  closeModal();
  deleteCard(id, btn);
});

async function deleteCard(id, btn) {
  if (!config || !config.token) { setListStatus('削除にはPATが必要です。設定でPATを入力してください。', true); return; }
  const target = allCards.find(c => c.id === id);
  const updated = allCards.filter(c => c.id !== id);
  setListStatus('削除しています…');
  if (btn) btn.disabled = true;
  try {
    await saveCardsToGitHub(updated, `サポカ削除: ${target ? target.name : id}`);
    allCards = updated;
    setListStatus('');
    renderCards();
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

document.getElementById('refreshBtn').addEventListener('click', () => { loadCards(); loadSkillCategoryIndex(); });

// --- 検索欄のタグ入力(必須/任意) ---
const requiredTags = [];
const optionalTags = [];

function renderTagBox(boxId, tags, chipClass) {
  const box = document.getElementById(boxId);
  box.querySelectorAll('.tag-chip').forEach(el => el.remove());
  const input = box.querySelector('input');
  tags.forEach((tag, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip' + (chipClass ? ' ' + chipClass : '');
    chip.innerHTML = `${escapeHtml(tag)}<button type="button" class="tag-remove" aria-label="削除">×</button>`;
    chip.querySelector('.tag-remove').addEventListener('click', () => {
      tags.splice(i, 1);
      renderTagBox(boxId, tags, chipClass);
      renderCards();
    });
    box.insertBefore(chip, input);
  });
}

function setupTagInput(boxId, inputId, tags, chipClass) {
  const input = document.getElementById(inputId);
  const commit = () => {
    const val = input.value.trim();
    if (val) {
      tags.push(val);
      input.value = '';
      renderTagBox(boxId, tags, chipClass);
    }
    renderCards();
  };
  input.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      tags.pop();
      renderTagBox(boxId, tags, chipClass);
      renderCards();
    }
  });
  input.addEventListener('blur', () => { if (input.value.trim()) commit(); });
  input.addEventListener('input', renderCards);
}

function getFieldTerms(inputId, tags) {
  const partial = document.getElementById(inputId).value.trim().toLowerCase();
  const committed = tags.map(t => t.toLowerCase());
  return partial ? [...committed, partial] : committed;
}

setupTagInput('searchRequiredBox', 'searchRequiredInput', requiredTags, 'required');
setupTagInput('searchOptionalBox', 'searchOptionalInput', optionalTags, 'optional');

// --- 名前検索 ---
const searchNameInput = document.getElementById('searchNameInput');
searchNameInput.addEventListener('input', renderCards);

// --- タイプ絞り込み ---
document.querySelectorAll('.typeFilter').forEach(el => el.addEventListener('change', renderCards));

document.getElementById('resetSearchBtn').addEventListener('click', () => {
  searchNameInput.value = '';
  document.querySelectorAll('.typeFilter').forEach(el => { el.checked = false; });
  requiredTags.length = 0;
  optionalTags.length = 0;
  renderTagBox('searchRequiredBox', requiredTags, 'required');
  renderTagBox('searchOptionalBox', optionalTags, 'optional');
  document.getElementById('searchRequiredInput').value = '';
  document.getElementById('searchOptionalInput').value = '';
  renderCards();
});
function getSelectedTypeFilters() {
  return Array.from(document.querySelectorAll('.typeFilter:checked')).map(el => el.value);
}

// --- 一覧表示 ---
const TYPE_LABELS = { speed: 'スピード', stamina: 'スタミナ', power: 'パワー', guts: '根性', wisdom: '賢さ' };

function cardSkillNames(card) {
  return [...(card.skills || []), ...(card.eventSkills || [])].map(s => normalizeSkill(s).name);
}

function renderCards() {
  const container = document.getElementById('entries');
  const emptyMsg = document.getElementById('emptyMsg');
  container.innerHTML = '';

  document.getElementById('countLabel').textContent = allCards.length + ' 枚 登録';

  const nameKeyword = searchNameInput.value.trim().toLowerCase();
  const requiredTerms = getFieldTerms('searchRequiredInput', requiredTags);
  const optionalTerms = getFieldTerms('searchOptionalInput', optionalTags);
  const typeFilters = getSelectedTypeFilters();

  const filtered = allCards.filter(card => {
    if (nameKeyword && !(card.name || '').toLowerCase().includes(nameKeyword)) return false;
    if (typeFilters.length && !(card.types || []).some(t => typeFilters.includes(t))) return false;
    if (requiredTerms.length || optionalTerms.length) {
      const hay = [card.name, ...cardSkillNames(card)].filter(Boolean).join(' ').toLowerCase();
      const requiredOk = requiredTerms.every(t => hay.includes(t));
      const optionalOk = !optionalTerms.length || optionalTerms.some(t => hay.includes(t));
      if (!requiredOk || !optionalOk) return false;
    }
    return true;
  });

  if (!filtered.length) {
    emptyMsg.style.display = 'block';
    emptyMsg.textContent = allCards.length ? '該当する登録が見つかりません。' : 'まだ登録がありません。「＋ サポカ登録」からClaudeの出力を貼り付けるか、手入力して保存してください。';
    return;
  }
  emptyMsg.style.display = 'none';

  filtered.forEach(card => {
    const row = document.createElement('div');
    row.className = 'entry';
    const typeChips = (card.types || [])
      .map(t => `<span class="apt-badge type-badge-${t}">${TYPE_LABELS[t] || t}</span>`)
      .join('');
    const skillChips = (card.skills || []).map(s => {
      const skill = normalizeSkill(s);
      const catClass = skillChipCategoryClass(skill.name);
      return `<span class="chip white skill-chip skill-${skill.type}${catClass ? ' ' + catClass : ''}">${escapeHtml(skill.name)}</span>`;
    }).join('');
    const eventSkillChips = (card.eventSkills || []).map(s => {
      const skill = normalizeSkill(s);
      const catClass = skillChipCategoryClass(skill.name);
      return `<span class="chip white skill-chip skill-${skill.type}${catClass ? ' ' + catClass : ''}">${escapeHtml(skill.name)}</span>`;
    }).join('');
    const imageUrl = card.imagePath ? imageRawUrl(card.imagePath) : null;
    row.innerHTML = `
      <div class="entry-main">
        <div class="entry-name-row">
          <div class="entry-name">${escapeHtml(card.name)}</div>
        </div>
        ${typeChips ? `<div class="apt-row">${typeChips}</div>` : ''}
        <div class="skill-group-label">所持スキル</div>
        <div class="chips">${skillChips || '<span style="color:var(--ink-soft);font-size:12px;">スキル未登録</span>'}</div>
        <div class="skill-group-label">育成イベントスキル</div>
        <div class="chips">${eventSkillChips || '<span style="color:var(--ink-soft);font-size:12px;">スキル未登録</span>'}</div>
        ${card.notes ? `<div class="entry-notes">${escapeHtml(card.notes)}</div>` : ''}
      </div>
      <div class="entry-side">
        <div class="entry-actions">
          <button class="entry-edit" data-id="${card.id}">編集</button>
          <button class="entry-del" data-id="${card.id}">削除</button>
        </div>
        ${imageUrl ? `<div class="entry-image"><img class="entry-thumb" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(card.name)}のイラスト" loading="lazy"></div>` : ''}
      </div>
    `;
    row.querySelector('.entry-edit').addEventListener('click', () => startEditCard(card.id));
    row.querySelector('.entry-del').addEventListener('click', e => askDeleteConfirm(card, e.currentTarget));
    const thumb = row.querySelector('.entry-thumb');
    if (thumb) thumb.addEventListener('click', () => openLightbox(imageUrl));
    container.appendChild(row);
  });
}

resetForm();
loadCards();
loadSkillCategoryIndex();
