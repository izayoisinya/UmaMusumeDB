const DATA_PATH = 'data/factors.json';

class ConflictError extends Error {
  constructor() {
    super('conflict');
    this.name = 'ConflictError';
  }
}

let currentSha = null;
let allEntries = [];
let editingEntryId = null;

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

async function fetchFactorsRaw() {
  const res = await fetch(contentsApiUrlForGet(), { headers: authHeaders(), cache: 'no-store' });
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

// common.jsのGitHub連携設定フォーム(保存/消去)から呼ばれるフック
function onGithubConfigChanged() {
  allEntries = [];
  currentSha = null;
  return loadEntries();
}

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

// --- モーダル(因子登録) ---
// openModal/closeModal/GitHub連携設定/プロンプトはcommon.jsで定義

function setRegisterModalMode(isEditing) {
  editingEntryId = isEditing;
  document.getElementById('registerModalTitle').textContent = isEditing ? '因子を編集' : '因子を登録';
  document.getElementById('saveEntryBtn').textContent = isEditing ? 'この内容で更新' : 'この内容を保存';
}

document.getElementById('openRegisterModalBtn').addEventListener('click', () => {
  resetForm();
  setRegisterModalMode(null);
  openModal('registerModal');
});

function startEditEntry(id) {
  const entry = allEntries.find(e => e.id === id);
  if (!entry) return;
  resetForm();
  setRegisterModalMode(id);
  document.getElementById('fCharacter').value = entry.character || '';
  document.getElementById('fParent1').value = entry.parent1 || '';
  document.getElementById('fParent2').value = entry.parent2 || '';
  fillFactorList('blueList', entry.blue);
  fillFactorList('redList', entry.red);
  fillFactorList('greenList', entry.green);
  fillFactorList('whiteList', entry.white);
  document.getElementById('fNotes').value = entry.notes || '';
  if (entry.imagePath) {
    currentImagePath = entry.imagePath;
    showImagePreview(imageRawUrl(entry.imagePath));
  }
  openModal('registerModal');
}
let pendingDeleteId = null;
let pendingDeleteBtn = null;

function askDeleteConfirm(entry, btn) {
  pendingDeleteId = entry.id;
  pendingDeleteBtn = btn;
  document.getElementById('confirmDeleteMessage').textContent = `「${entry.character}」を削除します。この操作は取り消せません。よろしいですか？`;
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

// --- Claude出力の貼り付け読み込み ---
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

// --- 画像添付 ---
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
    pendingImageDataUrl = await resizeImageFile(file, 1400, 0.75);
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
  document.getElementById('entryForm').reset();
  Object.values(FACTOR_LIST_IDS).forEach(listId => {
    document.getElementById(listId).innerHTML = '';
    addFactorLine(listId, '', false, false, false);
  });
  document.getElementById('pasteJson').value = '';
  pendingImageDataUrl = null;
  currentImagePath = null;
  removeImageFlag = false;
  hideImagePreview();
  setStatus('');
  setRegisterModalMode(null);
}

// --- save / storage (GitHub Contents API) ---
document.getElementById('entryForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!config || !config.token) { setStatus('保存にはPATが必要です。GitHub連携設定でPATを入力してください。', true); return; }
  const character = document.getElementById('fCharacter').value.trim();
  if (!character) { setStatus('キャラ名を入力してください。', true); return; }

  const entryId = editingEntryId || ('factor_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const entry = {
    id: entryId,
    character,
    parent1: document.getElementById('fParent1').value.trim(),
    parent2: document.getElementById('fParent2').value.trim(),
    blue: readListFactors('blueList'),
    red: readListFactors('redList'),
    green: readListFactors('greenList'),
    white: readListFactors('whiteList'),
    notes: document.getElementById('fNotes').value.trim(),
    imagePath: removeImageFlag ? null : (currentImagePath || null),
    savedAt: new Date().toISOString()
  };

  const isEditing = !!editingEntryId;
  const updated = isEditing
    ? allEntries.map(e => e.id === editingEntryId ? entry : e)
    : [entry, ...allEntries];
  setStatus(isEditing ? '更新しています…' : '保存しています…');
  const saveBtn = document.getElementById('saveEntryBtn');
  saveBtn.disabled = true;
  try {
    if (pendingImageDataUrl) {
      setStatus('画像をアップロードしています…');
      const imagePath = `images/${entryId}.jpg`;
      await uploadImageToGitHub(imagePath, pendingImageDataUrl, `因子画像アップロード: ${character}`);
      entry.imagePath = imagePath;
    } else if (removeImageFlag && currentImagePath) {
      setStatus('画像を削除しています…');
      await deleteImageFromGitHub(currentImagePath, `因子画像削除: ${character}`);
      entry.imagePath = null;
    }
    setStatus(isEditing ? '更新しています…' : '保存しています…');
    await saveEntriesToGitHub(updated, `${isEditing ? '因子編集' : '因子登録'}: ${character}`);
    allEntries = sortBySavedAtDesc(updated);
    renderEntries();
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

function sortBySavedAtDesc(list) {
  return list.slice().sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
}

async function loadEntries() {
  setListStatus('読み込み中…');
  try {
    const { sha, entries } = await fetchFactorsRaw();
    currentSha = sha;
    allEntries = sortBySavedAtDesc(entries);
    setListStatus('');
  } catch (err) {
    console.error(err);
    setListStatus('読み込みに失敗しました: ' + err.message, true);
  }
  renderEntries();
}

async function deleteEntry(id, btn) {
  if (!config || !config.token) { setListStatus('削除にはPATが必要です。GitHub連携設定でPATを入力してください。', true); return; }
  const target = allEntries.find(e => e.id === id);
  const updated = allEntries.filter(e => e.id !== id);
  setListStatus('削除しています…');
  if (btn) btn.disabled = true;
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
    if (btn) btn.disabled = false;
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

function matchesAnyTerm(text, terms) {
  if (!terms || !terms.length) return false;
  const lowerStr = String(text == null ? '' : text).toLowerCase();
  return terms.some(t => t && lowerStr.includes(t));
}

// --- 検索欄のタグ入力(必須/任意/本体のみ) ---
const requiredTags = [];
const optionalTags = [];
const selfTags = [];

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
      renderEntries();
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
    renderEntries();
  };
  input.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      tags.pop();
      renderTagBox(boxId, tags, chipClass);
      renderEntries();
    }
  });
  input.addEventListener('blur', () => { if (input.value.trim()) commit(); });
  input.addEventListener('input', renderEntries);
}

function getFieldTerms(inputId, tags) {
  const partial = document.getElementById(inputId).value.trim().toLowerCase();
  const committed = tags.map(t => t.toLowerCase());
  return partial ? [...committed, partial] : committed;
}

setupTagInput('searchRequiredBox', 'searchRequiredInput', requiredTags, 'required');
setupTagInput('searchOptionalBox', 'searchOptionalInput', optionalTags, 'optional');
setupTagInput('searchSelfBox', 'searchSelfInput', selfTags, 'self');

function getSelfFactorNames(entry) {
  return [...(entry.blue || []), ...(entry.red || []), ...(entry.green || []), ...(entry.white || [])]
    .filter(f => f.self)
    .map(f => f.name);
}

function getWhiteSelfCount(entry) {
  return (entry.white || []).filter(f => f.self).length;
}

const whiteCountSelfOnly = document.getElementById('whiteCountSelfOnly');
const whiteCountLte = document.getElementById('whiteCountLte');
const whiteCountInput = document.getElementById('whiteCountInput');
[whiteCountSelfOnly, whiteCountLte, whiteCountInput].forEach(el => {
  el.addEventListener('input', renderEntries);
  el.addEventListener('change', renderEntries);
});

function renderEntries() {
  const requiredTerms = getFieldTerms('searchRequiredInput', requiredTags);
  const optionalTerms = getFieldTerms('searchOptionalInput', optionalTags);
  const selfTerms = getFieldTerms('searchSelfInput', selfTags);
  const terms = [...requiredTerms, ...optionalTerms, ...selfTerms];
  const container = document.getElementById('entries');
  const emptyMsg = document.getElementById('emptyMsg');
  container.innerHTML = '';

  const countValRaw = whiteCountInput.value.trim();
  const countFilterActive = countValRaw !== '' && !Number.isNaN(Number(countValRaw));
  const countNum = countFilterActive ? Number(countValRaw) : null;

  const filtered = allEntries.filter(e => {
    let ok = true;
    if (terms.length) {
      const hay = [e.character, e.parent1, e.parent2, e.notes,
        ...(e.blue || []).map(f => f.name), ...(e.red || []).map(f => f.name),
        ...(e.green || []).map(f => f.name), ...(e.white || []).map(f => f.name)]
        .filter(Boolean).join(' ').toLowerCase();
      const requiredOk = requiredTerms.every(t => hay.includes(t));
      const optionalOk = !optionalTerms.length || optionalTerms.some(t => hay.includes(t));
      const selfHay = getSelfFactorNames(e).join(' ').toLowerCase();
      const selfOk = selfTerms.every(t => selfHay.includes(t));
      ok = ok && requiredOk && optionalOk && selfOk;
    }
    if (countFilterActive) {
      const value = whiteCountSelfOnly.checked ? getWhiteSelfCount(e) : (e.white || []).length;
      const countOk = whiteCountLte.checked ? value <= countNum : value >= countNum;
      ok = ok && countOk;
    }
    return ok;
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
    const pushChip = (color, f) => {
      const matchClass = matchesAnyTerm(f.name, terms) ? ' search-match' : '';
      chips.push(`<span class="chip ${color}${f.self ? '' : ' muted'}${matchClass}">${stackLabel(f)}</span>`);
    };
    (entry.blue || []).forEach(f => pushChip('blue', f));
    (entry.red || []).forEach(f => pushChip('red', f));
    (entry.green || []).forEach(f => pushChip('green', f));
    (entry.white || []).forEach(f => pushChip('white', f));

    const parents = [entry.parent1, entry.parent2].filter(Boolean).map(p => highlightMatches(p, terms)).join(' × ');

    const imageUrl = entry.imagePath ? imageRawUrl(entry.imagePath) : null;
    const whiteCount = (entry.white || []).length;
    const whiteSelfCount = getWhiteSelfCount(entry);

    row.innerHTML = `
      <div class="entry-main">
        <div class="entry-name-row">
          <div class="entry-name">${highlightMatches(entry.character, terms)}</div>
          <span class="white-count-badge">白因子 ${whiteCount}（本体${whiteSelfCount}）</span>
        </div>
        ${parents ? `<div class="entry-parents">継承元: ${parents}</div>` : ''}
        <div class="chips">${chips.join('') || '<span style="color:var(--ink-soft);font-size:12px;">因子未登録</span>'}</div>
        ${entry.notes ? `<div class="entry-notes">${highlightMatches(entry.notes, terms)}</div>` : ''}
      </div>
      <div class="entry-side">
        <div class="entry-actions">
          <button class="entry-edit" data-id="${entry.id}">編集</button>
          <button class="entry-del" data-id="${entry.id}">削除</button>
        </div>
        ${imageUrl ? `<div class="entry-image"><img class="entry-thumb" src="${escapeAttr(imageUrl)}" alt="${escapeAttr(entry.character)}の継承画面" loading="lazy"></div>` : ''}
      </div>
    `;
    row.querySelector('.entry-edit').addEventListener('click', () => startEditEntry(entry.id));
    row.querySelector('.entry-del').addEventListener('click', e => askDeleteConfirm(entry, e.currentTarget));
    const thumb = row.querySelector('.entry-thumb');
    if (thumb) thumb.addEventListener('click', () => openLightbox(imageUrl));
    container.appendChild(row);
  });
}

resetForm();
loadEntries();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.error('SW登録失敗:', err));
  });
}
