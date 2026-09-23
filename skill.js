// skill.js — スキルブックページ固有ロジック

const DATA_PATH = 'data/skills.json';

class ConflictError extends Error {
  constructor() {
    super('conflict');
    this.name = 'ConflictError';
  }
}

let currentSha = null;
let allSkills = [];
let editingSkillId = null;
let ownershipIndex = new Map(); // スキル名 -> { umas: [{name,type}], supports: [{name,type}] }
let cachedUmas = [];
let cachedCards = [];

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

async function fetchSkillsRaw() {
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

async function saveSkillsToGitHub(newEntries, commitMessage) {
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

async function loadSkills() {
  setListStatus('読み込み中…');
  try {
    const { sha, entries } = await fetchSkillsRaw();
    currentSha = sha;
    allSkills = sortByName(entries);
    setListStatus('');
  } catch (err) {
    console.error(err);
    setListStatus('読み込みに失敗しました: ' + err.message, true);
  }
  renderSkills();
}

// common.jsのGitHub連携設定フォーム(保存/消去)から呼ばれるフック
function onGithubConfigChanged() {
  allSkills = [];
  currentSha = null;
  return loadSkills();
}

// --- ウマ娘・サポカのスキルからの抽出 ---
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

function normalizeSkillLike(s) {
  return typeof s === 'string' ? { name: s, type: 'normal' } : { name: s.name || '', type: s.type || 'normal' };
}

const SKILL_TYPE_TO_RARITY = { normal: 'R', gold: 'SR' };
const SKILL_TYPE_LABELS = { normal: '通常', gold: '金', unique: '固有' };

// --- スキル名 -> 所持ウマ娘・対応サポカの索引 ---
async function loadOwnershipIndex() {
  try {
    const [umas, cards] = await Promise.all([
      fetchJsonFile('data/uma_musume.json'),
      fetchJsonFile('data/support_cards.json'),
    ]);
    cachedUmas = umas;
    cachedCards = cards;
    const index = new Map();
    const addTo = (name, kind, entry) => {
      if (!name) return;
      if (!index.has(name)) index.set(name, { umas: [], supports: [] });
      index.get(name)[kind].push(entry);
    };
    umas.forEach(u => {
      (u.skills || []).forEach(s => {
        const skill = normalizeSkillLike(s);
        addTo(skill.name, 'umas', { name: u.name, type: skill.type, id: u.id });
      });
    });
    cards.forEach(c => {
      [...(c.skills || []), ...(c.eventSkills || [])].forEach(s => {
        const skill = normalizeSkillLike(s);
        addTo(skill.name, 'supports', { name: c.name, type: skill.type, id: c.id });
      });
    });
    ownershipIndex = index;
    renderSkills();
  } catch (err) {
    console.error('所持ウマ娘・サポカの索引作成に失敗:', err);
  }
}

// --- 所持ウマ娘・サポカの詳細ポップアップ ---
const CHIP_COLOR_CATEGORIES = new Set(['green', 'heal', 'debuff']);
function categoryClassFor(skillName) {
  const entry = allSkills.find(sk => sk.name === skillName);
  const categories = (entry && entry.categories) || [];
  return categories.filter(c => CHIP_COLOR_CATEGORIES.has(c)).map(c => `cat-${c}`).join(' ');
}
function detailSkillChip(s) {
  const skill = normalizeSkillLike(s);
  const catClass = categoryClassFor(skill.name);
  return `<span class="chip white skill-chip skill-${skill.type}${catClass ? ' ' + catClass : ''}">${escapeHtml(skill.name)}</span>`;
}

function aptBadge(prefix, v) {
  const rankClass = v ? 'rank-' + v : 'rank-none';
  return `<span class="apt-badge ${rankClass}">${prefix}${v || '-'}</span>`;
}
const GROWTH_LABELS = { speed: 'スピ', stamina: 'スタ', power: 'パワ', guts: '根性', wisdom: '賢さ' };

function renderUmaDetailHtml(uma) {
  const imageUrl = uma.imagePath ? imageRawUrl(uma.imagePath) : null;
  const track = uma.track || {};
  const distance = uma.distance || {};
  const style = uma.style || {};
  const growth = uma.growth || {};
  const skillChips = (uma.skills || []).map(detailSkillChip).join('');
  const growthItemsHtml = Object.entries(GROWTH_LABELS)
    .filter(([key]) => growth[key])
    .map(([key, label]) => `<span class="growth-item">${label}+${growth[key]}%</span>`)
    .join('');
  return `
    <div class="entry-name-row">
      ${imageUrl ? `<img class="uma-icon" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(uma.name)}" loading="lazy">` : ''}
      <div class="entry-name">${escapeHtml(uma.name)}</div>
    </div>
    <div class="apt-group">
      <span class="apt-group-label">コース</span>
      <div class="apt-row">${aptBadge('芝', track.turf)}${aptBadge('ダ', track.dirt)}</div>
    </div>
    <div class="apt-group">
      <span class="apt-group-label">距離</span>
      <div class="apt-row">${aptBadge('短', distance.short)}${aptBadge('マ', distance.mile)}${aptBadge('中', distance.medium)}${aptBadge('長', distance.long)}</div>
    </div>
    <div class="apt-group">
      <span class="apt-group-label">脚質</span>
      <div class="apt-row">${aptBadge('逃', style.nige)}${aptBadge('先', style.senko)}${aptBadge('差', style.sashi)}${aptBadge('追', style.oikomi)}</div>
    </div>
    ${growthItemsHtml ? `<div class="growth-row"><span class="growth-item">成長率:</span>${growthItemsHtml}</div>` : ''}
    <div class="chips">${skillChips || '<span style="color:var(--ink-soft);font-size:12px;">スキル未登録</span>'}</div>
    ${uma.notes ? `<div class="entry-notes">${escapeHtml(uma.notes)}</div>` : ''}
  `;
}

const SUPPORT_TYPE_LABELS = { speed: 'スピード', stamina: 'スタミナ', power: 'パワー', guts: '根性', wisdom: '賢さ' };
function renderCardDetailHtml(card) {
  const imageUrl = card.imagePath ? imageRawUrl(card.imagePath) : null;
  const typeChips = (card.types || []).map(t => `<span class="apt-badge type-badge-${t}">${SUPPORT_TYPE_LABELS[t] || t}</span>`).join('');
  const skillChips = (card.skills || []).map(detailSkillChip).join('');
  const eventSkillChips = (card.eventSkills || []).map(detailSkillChip).join('');
  return `
    <div class="entry" style="border:none;padding:0;">
      <div class="entry-main">
        <div class="entry-name-row"><div class="entry-name">${escapeHtml(card.name)}</div></div>
        ${typeChips ? `<div class="apt-row">${typeChips}</div>` : ''}
        <div class="skill-section">
          <div class="skill-group-label">所持スキル</div>
          <div class="chips">${skillChips || '<span style="color:var(--ink-soft);font-size:12px;">スキル未登録</span>'}</div>
        </div>
        <div class="skill-section">
          <div class="skill-group-label">育成イベントスキル</div>
          <div class="chips">${eventSkillChips || '<span style="color:var(--ink-soft);font-size:12px;">スキル未登録</span>'}</div>
        </div>
        ${card.notes ? `<div class="entry-notes">${escapeHtml(card.notes)}</div>` : ''}
      </div>
      ${imageUrl ? `<div class="entry-side"><div class="entry-image"><img class="entry-thumb" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(card.name)}のイラスト" loading="lazy"></div></div>` : ''}
    </div>
  `;
}

function openOwnerDetail(kind, name, id, dupIndex, skillName) {
  const titleEl = document.getElementById('ownerDetailTitle');
  const bodyEl = document.getElementById('ownerDetailBody');
  const suffix = dupIndex ? ` [${dupIndex}]` : '';
  titleEl.textContent = skillName || (name + suffix);
  let imageUrl = null;
  if (kind === 'uma') {
    const uma = (id && cachedUmas.find(u => u.id === id)) || cachedUmas.find(u => u.name === name);
    if (!uma) return;
    imageUrl = uma.imagePath ? imageRawUrl(uma.imagePath) : null;
    bodyEl.innerHTML = renderUmaDetailHtml(uma);
  } else {
    const card = (id && cachedCards.find(c => c.id === id)) || cachedCards.find(c => c.name === name);
    if (!card) return;
    imageUrl = card.imagePath ? imageRawUrl(card.imagePath) : null;
    bodyEl.innerHTML = renderCardDetailHtml(card);
  }
  const thumb = bodyEl.querySelector('.uma-icon, .entry-thumb');
  if (thumb && imageUrl) thumb.addEventListener('click', () => openLightbox(imageUrl));
  openModal('ownerDetailModal');
}

function renderSkillDetailHtml(skill) {
  const categoryBadge = (skill.categories || [])
    .map(c => `<span class="apt-badge category-badge-${c}">${CATEGORY_LABELS[c] || c}</span>`)
    .join('');
  const styleChips = (skill.styles && skill.styles.length)
    ? skill.styles.map(s => `<span class="apt-badge">${STYLE_LABELS[s] || s}</span>`).join('')
    : '';
  const distanceChips = (skill.distances && skill.distances.length)
    ? skill.distances.map(d => `<span class="apt-badge">${DISTANCE_LABELS[d] || d}</span>`).join('')
    : '';
  return `
    <div class="apt-row">${categoryBadge}${styleChips}${distanceChips}</div>
    ${skill.effect ? `<div class="entry-notes">${escapeHtml(skill.effect)}</div>` : ''}
    ${skill.notes ? `<div class="entry-notes">${escapeHtml(skill.notes)}</div>` : ''}
    ${skill.upperSkill ? `<div class="entry-notes">上位スキル: ${escapeHtml(skill.upperSkill)}</div>` : ''}
    ${skill.lowerSkill ? `<div class="entry-notes">下位スキル: ${escapeHtml(skill.lowerSkill)}</div>` : ''}
  `;
}

function openSkillDetail(name) {
  const titleEl = document.getElementById('ownerDetailTitle');
  const bodyEl = document.getElementById('ownerDetailBody');
  const skill = allSkills.find(s => s.name === name);
  titleEl.textContent = name;
  bodyEl.innerHTML = skill
    ? renderSkillDetailHtml(skill)
    : `<p class="hint">このスキルはスキルブックに登録されていません。</p>`;
  openModal('ownerDetailModal');
}

document.getElementById('entries').addEventListener('click', e => {
  const refLink = e.target.closest('.skill-ref-link');
  if (refLink) { openSkillDetail(refLink.dataset.name); return; }
  const link = e.target.closest('.owner-link');
  if (!link) return;
  openOwnerDetail(link.dataset.kind, link.dataset.name, link.dataset.id, link.dataset.dup, link.dataset.skill);
});

document.getElementById('extractSkillsBtn').addEventListener('click', async () => {
  if (!config || !config.token) { setListStatus('抽出・保存にはPATが必要です。設定でPATを入力してください。', true); return; }
  const btn = document.getElementById('extractSkillsBtn');
  btn.disabled = true;
  setListStatus('ウマ娘・サポカのスキルを読み込んでいます…');
  try {
    const [umas, cards] = await Promise.all([
      fetchJsonFile('data/uma_musume.json'),
      fetchJsonFile('data/support_cards.json'),
    ]);

    const found = new Map();
    const collect = s => {
      const skill = normalizeSkillLike(s);
      const rarity = SKILL_TYPE_TO_RARITY[skill.type];
      if (!rarity || !skill.name) return;
      if (!found.has(skill.name)) found.set(skill.name, new Set());
      found.get(skill.name).add(rarity);
    };
    umas.forEach(u => (u.skills || []).forEach(collect));
    cards.forEach(c => {
      (c.skills || []).forEach(collect);
      (c.eventSkills || []).forEach(collect);
    });

    const updated = allSkills.slice();
    let addedCount = 0;
    let updatedCount = 0;
    found.forEach((raritySet, name) => {
      const existing = updated.find(sk => sk.name === name);
      if (existing) {
        const rarities = new Set(existing.rarities || []);
        const before = rarities.size;
        raritySet.forEach(r => rarities.add(r));
        if (rarities.size !== before) {
          existing.rarities = Array.from(rarities);
          updatedCount++;
        }
      } else {
        updated.push({
          id: 'skill_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          name,
          effect: '',
          categories: [],
          rarities: Array.from(raritySet),
          styles: [],
          distances: [],
          notes: '',
          savedAt: new Date().toISOString(),
        });
        addedCount++;
      }
    });

    if (!addedCount && !updatedCount) {
      setListStatus('新しく抽出できるスキルはありませんでした。');
      return;
    }

    setListStatus('保存しています…');
    await saveSkillsToGitHub(updated, `スキル自動抽出: 新規${addedCount}件・レアリティ更新${updatedCount}件`);
    allSkills = sortByName(updated);
    renderSkills();
    setListStatus(`抽出完了: 新規${addedCount}件・レアリティ更新${updatedCount}件`);
  } catch (err) {
    console.error(err);
    if (err instanceof ConflictError) {
      setListStatus('他の端末で更新されています。「更新」ボタンで最新を取得してからもう一度お試しください。', true);
    } else {
      setListStatus('抽出中にエラーが発生しました: ' + err.message, true);
    }
  } finally {
    btn.disabled = false;
  }
});

// --- 種別・属性の選択取得/反映 ---
function getCheckedValues(selector) {
  return Array.from(document.querySelectorAll(selector + ':checked')).map(el => el.value);
}
function setCheckedValues(selector, values) {
  const set = new Set(values || []);
  document.querySelectorAll(selector).forEach(el => { el.checked = set.has(el.value); });
}

// --- フォーム操作 ---
function setSkillModalMode(isEditing) {
  editingSkillId = isEditing;
  document.getElementById('skillModalTitle').textContent = isEditing ? 'スキルを編集' : 'スキルを登録';
  document.getElementById('saveSkillBtn').textContent = isEditing ? 'この内容で更新' : 'この内容を保存';
}

function resetForm() {
  document.getElementById('skillForm').reset();
  document.getElementById('pasteJson').value = '';
  setStatus('');
  setSkillModalMode(null);
}

document.getElementById('openRegisterModalBtn').addEventListener('click', () => {
  resetForm();
  setSkillModalMode(null);
  openModal('skillModal');
});

function fillForm(parsed) {
  document.getElementById('fName').value = parsed.name || '';
  document.getElementById('fEffect').value = parsed.effect || '';
  document.getElementById('fUpperSkill').value = parsed.upperSkill || '';
  document.getElementById('fLowerSkill').value = parsed.lowerSkill || '';
}

document.getElementById('loadJsonBtn').addEventListener('click', () => {
  const raw = document.getElementById('pasteJson').value.trim();
  if (!raw) { setStatus('Claudeの出力を貼り付けてください。', true); return; }
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    fillForm(parsed);
    setStatus('読み込み完了。種別・レアリティ・脚質・距離を選んで保存してください。');
  } catch (err) {
    console.error(err);
    setStatus('JSONの解析に失敗しました。Claudeの出力をそのまま貼り付けているか確認してください。', true);
  }
});

document.getElementById('clearBtn').addEventListener('click', resetForm);

function startEditSkill(id) {
  const skill = allSkills.find(s => s.id === id);
  if (!skill) return;
  resetForm();
  setSkillModalMode(id);
  fillForm(skill);
  setCheckedValues('.fCategory', skill.categories);
  setCheckedValues('.fRarity', skill.rarities);
  setCheckedValues('.fStyle', (skill.styles && skill.styles.length) ? skill.styles : ['__general__']);
  setCheckedValues('.fDistance', (skill.distances && skill.distances.length) ? skill.distances : ['__general__']);
  document.getElementById('fNotes').value = skill.notes || '';
  openModal('skillModal');
}

// --- 保存 ---
document.getElementById('skillForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!config || !config.token) { setStatus('保存にはPATが必要です。設定でPATを入力してください。', true); return; }
  const name = document.getElementById('fName').value.trim();
  if (!name) { setStatus('名前を入力してください。', true); return; }

  const skillId = editingSkillId || ('skill_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const skill = {
    id: skillId,
    name,
    effect: document.getElementById('fEffect').value.trim(),
    upperSkill: document.getElementById('fUpperSkill').value.trim(),
    lowerSkill: document.getElementById('fLowerSkill').value.trim(),
    categories: getCheckedValues('.fCategory'),
    rarities: getCheckedValues('.fRarity'),
    styles: getCheckedValues('.fStyle').filter(v => v !== '__general__'),
    distances: getCheckedValues('.fDistance').filter(v => v !== '__general__'),
    notes: document.getElementById('fNotes').value.trim(),
    savedAt: new Date().toISOString(),
  };

  const isEditing = !!editingSkillId;
  const updated = isEditing
    ? allSkills.map(s => s.id === editingSkillId ? skill : s)
    : [skill, ...allSkills];
  setStatus(isEditing ? '更新しています…' : '保存しています…');
  const saveBtn = document.getElementById('saveSkillBtn');
  saveBtn.disabled = true;
  try {
    await saveSkillsToGitHub(updated, `${isEditing ? 'スキル編集' : 'スキル登録'}: ${name}`);
    allSkills = sortByName(updated);
    renderSkills();
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

function askDeleteConfirm(skill, btn) {
  pendingDeleteId = skill.id;
  pendingDeleteBtn = btn;
  document.getElementById('confirmDeleteMessage').textContent = `「${skill.name}」を削除します。この操作は取り消せません。よろしいですか？`;
  openModal('confirmDeleteModal');
}

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
  const id = pendingDeleteId;
  const btn = pendingDeleteBtn;
  pendingDeleteId = null;
  pendingDeleteBtn = null;
  closeModal();
  deleteSkill(id, btn);
});

async function deleteSkill(id, btn) {
  if (!config || !config.token) { setListStatus('削除にはPATが必要です。設定でPATを入力してください。', true); return; }
  const target = allSkills.find(s => s.id === id);
  const updated = allSkills.filter(s => s.id !== id);
  setListStatus('削除しています…');
  if (btn) btn.disabled = true;
  try {
    await saveSkillsToGitHub(updated, `スキル削除: ${target ? target.name : id}`);
    allSkills = updated;
    setListStatus('');
    renderSkills();
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

document.getElementById('refreshBtn').addEventListener('click', () => { loadSkills(); loadOwnershipIndex(); });

// --- 検索・絞り込み ---
document.getElementById('searchNameInput').addEventListener('input', renderSkills);
document.querySelectorAll('.categoryFilter, .rarityFilter, .styleFilter, .distanceFilter').forEach(el => el.addEventListener('change', renderSkills));

document.getElementById('resetSearchBtn').addEventListener('click', () => {
  document.getElementById('searchNameInput').value = '';
  document.querySelectorAll('.categoryFilter, .rarityFilter, .styleFilter, .distanceFilter').forEach(el => { el.checked = false; });
  renderSkills();
});

// --- 一覧表示 ---
const CATEGORY_LABELS = { green: '緑スキル', heal: '回復スキル', debuff: 'デバフスキル', speed: '速度スキル（目標速度）', current_speed: '速度スキル（現在速度上昇）', accel: '加速スキル', lateral: '横移動速度スキル', vision: '視野スキル', start: 'スタートスキル' };
const STYLE_LABELS = { nige: '逃げ', senko: '先行', sashi: '差し', oikomi: '追込' };
const DISTANCE_LABELS = { short: '短距離', mile: 'マイル', medium: '中距離', long: '長距離' };

function renderSkills() {
  const container = document.getElementById('entries');
  const emptyMsg = document.getElementById('emptyMsg');
  container.innerHTML = '';

  document.getElementById('countLabel').textContent = allSkills.length + ' 件 登録';

  const keyword = document.getElementById('searchNameInput').value.trim().toLowerCase();
  const categoryFilters = getCheckedValues('.categoryFilter');
  const rarityFilters = getCheckedValues('.rarityFilter');
  const styleFilters = getCheckedValues('.styleFilter');
  const distanceFilters = getCheckedValues('.distanceFilter');

  const filtered = allSkills.filter(skill => {
    if (keyword) {
      const hay = [skill.name, skill.effect].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    if (categoryFilters.length) {
      const cats = skill.categories || [];
      const matches = categoryFilters.some(f => f === '__none__' ? cats.length === 0 : cats.includes(f));
      if (!matches) return false;
    }
    if (rarityFilters.length && !(skill.rarities || []).some(r => rarityFilters.includes(r))) return false;
    if (styleFilters.length) {
      const styles = skill.styles || [];
      const matches = styleFilters.some(f => f === '__general__' ? styles.length === 0 : styles.includes(f));
      if (!matches) return false;
    }
    if (distanceFilters.length) {
      const distances = skill.distances || [];
      const matches = distanceFilters.some(f => f === '__general__' ? distances.length === 0 : distances.includes(f));
      if (!matches) return false;
    }
    return true;
  });

  if (!filtered.length) {
    emptyMsg.style.display = 'block';
    emptyMsg.textContent = allSkills.length ? '該当する登録が見つかりません。' : 'まだ登録がありません。「＋ スキル登録」からClaudeの出力を貼り付けるか、手入力して保存してください。';
    return;
  }
  emptyMsg.style.display = 'none';

  filtered.forEach(skill => {
    const row = document.createElement('div');
    row.className = 'entry';
    const categoryBadge = (skill.categories || [])
      .map(c => `<span class="apt-badge category-badge-${c}">${CATEGORY_LABELS[c] || c}</span>`)
      .join('');
    const styleChips = (skill.styles && skill.styles.length)
      ? skill.styles.map(s => `<span class="apt-badge">${STYLE_LABELS[s] || s}</span>`).join('')
      : '';
    const distanceChips = (skill.distances && skill.distances.length)
      ? skill.distances.map(d => `<span class="apt-badge">${DISTANCE_LABELS[d] || d}</span>`).join('')
      : '';
    const owned = ownershipIndex.get(skill.name);
    const withDupIndex = list => {
      const counts = {};
      list.forEach(u => { counts[u.name] = (counts[u.name] || 0) + 1; });
      const seen = {};
      return list.map(u => {
        if (counts[u.name] <= 1) return { ...u, dupIndex: null };
        seen[u.name] = (seen[u.name] || 0) + 1;
        return { ...u, dupIndex: seen[u.name] };
      });
    };
    const ownerLink = (u, kind) => {
      const label = `${escapeHtml(u.name)}${u.type && u.type !== 'normal' ? `(${SKILL_TYPE_LABELS[u.type] || u.type})` : ''}${u.dupIndex ? `[${u.dupIndex}]` : ''}`;
      let typeClass = '';
      if (kind === 'support') {
        const card = cachedCards.find(c => c.id === u.id);
        const primaryType = card && card.types && card.types[0];
        if (primaryType) typeClass = ` apt-badge type-badge-${primaryType}`;
      }
      return `<span class="owner-link${typeClass}" data-kind="${kind}" data-id="${escapeHtml(u.id || '')}" data-name="${escapeHtml(u.name)}" data-dup="${u.dupIndex || ''}" data-skill="${escapeHtml(skill.name)}">${label}</span>`;
    };
    const ownerUmasLine = (owned && owned.umas.length)
      ? `<div class="apt-group owner-group"><span class="apt-group-label">所持ウマ娘</span><div class="apt-row">${withDupIndex(owned.umas).map(u => ownerLink(u, 'uma')).join('')}</div></div>`
      : '';
    const ownerCardsLine = (owned && owned.supports.length)
      ? `<div class="apt-group owner-group"><span class="apt-group-label">対応サポカ</span><div class="apt-row">${withDupIndex(owned.supports).map(u => ownerLink(u, 'support')).join('')}</div></div>`
      : '';
    const skillRefLink = (skillName) => `<span class="owner-link skill-ref-link" data-name="${escapeHtml(skillName)}">${escapeHtml(skillName)}</span>`;
    const upperSkillLine = skill.upperSkill
      ? `<div class="apt-group owner-group"><span class="apt-group-label">上位スキル</span><div class="apt-row">${skillRefLink(skill.upperSkill)}</div></div>`
      : '';
    const lowerSkillLine = skill.lowerSkill
      ? `<div class="apt-group owner-group"><span class="apt-group-label">下位スキル</span><div class="apt-row">${skillRefLink(skill.lowerSkill)}</div></div>`
      : '';
    row.innerHTML = `
      <div class="entry-main">
        <div class="entry-name-row">
          <div class="entry-name">${escapeHtml(skill.name)}</div>
          ${categoryBadge}
        </div>
        <div class="apt-row">${styleChips}${distanceChips}</div>
        ${skill.effect ? `<div class="entry-notes">${escapeHtml(skill.effect)}</div>` : ''}
        ${skill.notes ? `<div class="entry-notes">${escapeHtml(skill.notes)}</div>` : ''}
        ${upperSkillLine}
        ${lowerSkillLine}
        ${ownerUmasLine}
        ${ownerCardsLine}
      </div>
      <div class="entry-side">
        <div class="entry-actions">
          <button class="entry-edit" data-id="${skill.id}">編集</button>
          <button class="entry-del" data-id="${skill.id}">削除</button>
        </div>
      </div>
    `;
    row.querySelector('.entry-edit').addEventListener('click', () => startEditSkill(skill.id));
    row.querySelector('.entry-del').addEventListener('click', e => askDeleteConfirm(skill, e.currentTarget));
    container.appendChild(row);
  });
}

resetForm();
loadSkills();
loadOwnershipIndex();
