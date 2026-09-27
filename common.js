// common.js — 全ページ共通: GitHub連携設定・テーマ・プロンプト・設定モーダル・汎用モーダル制御

const CONFIG_KEY = 'umaFactorLedger:githubConfig';
const DEFAULT_OWNER = 'izayoisinya';
const DEFAULT_REPO = 'UmaMusumeDB';

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

let config = loadConfig();

function authHeaders() {
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (config && config.token) headers['Authorization'] = `Bearer ${config.token}`;
  return headers;
}

// --- テーマ ---
const THEME_KEY = 'umaFactorLedger:theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️ ライトモードに切り替え' : '🌙 ダークモードに切り替え';
}
function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const theme = stored || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(theme);
}
initTheme();

const themeToggleBtn = document.getElementById('themeToggleBtn');
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

// --- Claude用プロンプト（各ページで window.PAGE_PROMPT を定義すればそちらを優先） ---
const DEFAULT_CLAUDE_PROMPT = 'この画像はウマ娘プリティーダービーの因子継承画面のスクリーンショットです。書かれている因子情報を読み取って、次のJSON形式だけを出力してください（説明や前置き、コードフェンスは不要です）。\n\n画面には「本人」「継承元1」「継承元2」の3つの因子ブロックが縦に並んでいます。青因子・赤（ピンク）因子・緑因子（固有）・白因子のすべてについて、3ブロック分を読み取ってください。\n\n同じ名前の因子が本人・継承元1・継承元2のいずれかに存在する場合は1つのエントリにまとめ、その因子が各ブロックに存在するかどうかをself(本人)/parent1(継承元1)/parent2(継承元2)にtrue/falseで入れてください。星の数を数える必要はありません。存在すればtrue、存在しなければfalseだけで構いません。\n\n各ブロックの青因子列・赤因子列は、一番上の色付き見出し（例:「根性」「逃げ」）もその列の1項目として含めてください。そこから下に続く項目も同じ列の色として全て含めてください（青列はblue_factors、ピンク/赤列はred_factorsに）。緑色で強調された項目は、その列の色分類ではなくgreen_factorsに入れてください。\n\n{"character": string, "blue_factors": [{"name": string, "self": boolean, "parent1": boolean, "parent2": boolean}], "red_factors": [同じ形式], "green_factors": [同じ形式], "white_factors": [同じ形式]}\n\ncharacterは本人のキャラ名のみ（継承元のキャラ名は含めない）。項目は省略せず全て出力してください。';
const CLAUDE_PROMPT = window.PAGE_PROMPT || DEFAULT_CLAUDE_PROMPT;

const promptTextEl = document.getElementById('promptText');
if (promptTextEl) promptTextEl.value = CLAUDE_PROMPT;

const copyPromptBtn = document.getElementById('copyPromptBtn');
if (copyPromptBtn) {
  copyPromptBtn.addEventListener('click', async () => {
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
}

// --- 画像アップロード共通(GitHub Contents API) ---
function imageRawUrl(path) {
  const owner = (config && config.owner) || DEFAULT_OWNER;
  const repo = (config && config.repo) || DEFAULT_REPO;
  const branch = (config && config.branch) || 'main';
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${path}`;
}

async function uploadImageToGitHub(path, dataUrl, commitMessage) {
  const base64 = dataUrl.split(',')[1];
  const owner = (config && config.owner) || DEFAULT_OWNER;
  const repo = (config && config.repo) || DEFAULT_REPO;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
  const getUrl = (config && config.branch) ? `${url}?ref=${encodeURIComponent(config.branch)}` : url;

  let sha;
  const existing = await fetch(getUrl, { headers: authHeaders(), cache: 'no-store' });
  if (existing.ok) {
    sha = (await existing.json()).sha;
  }

  const body = { message: commitMessage, content: base64 };
  if (config && config.branch) body.branch = config.branch;
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.message || `画像アップロードエラー: ${res.status}`);
  }
}

async function deleteImageFromGitHub(path, commitMessage) {
  const owner = (config && config.owner) || DEFAULT_OWNER;
  const repo = (config && config.repo) || DEFAULT_REPO;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
  const getUrl = (config && config.branch) ? `${url}?ref=${encodeURIComponent(config.branch)}` : url;
  const existing = await fetch(getUrl, { headers: authHeaders(), cache: 'no-store' });
  if (!existing.ok) return;
  const sha = (await existing.json()).sha;
  const body = { message: commitMessage, sha };
  if (config && config.branch) body.branch = config.branch;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.message || `画像削除エラー: ${res.status}`);
  }
}

function resizeImageFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round(height * maxDim / width);
            width = maxDim;
          } else {
            width = Math.round(width * maxDim / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

// リサイズせずファイルをそのままdata URL化する(動画など画像以外のファイル用)
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// --- ライトボックス(画像拡大表示) ---
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
function openLightbox(src) {
  if (!lightbox || !lightboxImg) return;
  lightboxImg.src = src;
  lightbox.hidden = false;
}
function closeLightbox() {
  if (!lightbox || !lightboxImg) return;
  lightbox.hidden = true;
  lightboxImg.src = '';
}
if (lightbox) {
  lightbox.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !lightbox.hidden) closeLightbox(); });
}

// --- 検索ポップアップ・スクロールFAB(一覧が長いページ用) ---
const searchPanel = document.getElementById('searchPanel');
const searchPanelAnchor = document.getElementById('searchPanelAnchor');
const searchPopupOverlay = document.getElementById('searchPopupOverlay');
const searchPopupBody = document.getElementById('searchPopupBody');

function openSearchPopup() {
  if (!searchPanel || !searchPopupBody || !searchPopupOverlay) return;
  searchPopupBody.appendChild(searchPanel);
  searchPopupOverlay.hidden = false;
}
function closeSearchPopup() {
  if (!searchPanel || !searchPanelAnchor || !searchPopupOverlay) return;
  searchPanelAnchor.parentNode.insertBefore(searchPanel, searchPanelAnchor);
  searchPopupOverlay.hidden = true;
}
const searchToggleBtn = document.getElementById('searchToggleBtn');
if (searchToggleBtn) searchToggleBtn.addEventListener('click', openSearchPopup);
const searchPopupCloseBtn = document.getElementById('searchPopupCloseBtn');
if (searchPopupCloseBtn) searchPopupCloseBtn.addEventListener('click', closeSearchPopup);
if (searchPopupOverlay) {
  searchPopupOverlay.addEventListener('click', e => { if (e.target === searchPopupOverlay) closeSearchPopup(); });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && searchPopupOverlay && !searchPopupOverlay.hidden) closeSearchPopup();
});

const scrollTopBtn = document.getElementById('scrollTopBtn');
const scrollBottomBtn = document.getElementById('scrollBottomBtn');
if (scrollTopBtn) scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
if (scrollBottomBtn) scrollBottomBtn.addEventListener('click', () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));

// --- 汎用モーダル制御 ---
function openModal(id) {
  document.querySelectorAll('.modal').forEach(m => { m.hidden = m.id !== id; });
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.hidden = false;
}
function closeModal() {
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.hidden = true;
  document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
}
// character-config.js等の各ウィジェットが「戻り先が無い」時のフォールバックで使う。
// closeModal()と違い他の開いているモーダルには触れず、
// 他に開いているモーダルが無い時だけオーバーレイごと非表示にする
// (縮小表示で複数ポップアップが同時に開いている時、片方の×でもう片方まで
// 一緒に閉じてしまわないようにするため)。
function hideOverlayIfNoModalOpen() {
  const overlay = document.getElementById('modalOverlay');
  if (!overlay) return;
  const stillOpen = Array.from(document.querySelectorAll('.modal')).some(m => !m.hidden);
  if (!stillOpen) overlay.hidden = true;
}

const modalOverlay = document.getElementById('modalOverlay');
if (modalOverlay) {
  document.querySelectorAll('.modal-close-btn').forEach(btn => btn.addEventListener('click', closeModal));
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modalOverlay.hidden) closeModal(); });
}

// --- ポップアップ縮小表示(裏のメイン画面を見ながら操作したい場合用) ---
// モーダルごとに個別に'compact'クラスを持たせ、それぞれ独立して縮小⇔通常を
// 切り替え・移動できるようにする(縮小ポップアップを複数同時に出しておき、
// 特定の1つだけ通常サイズに戻す、という使い方に対応するため)。
// #modalOverlay自体の背景(透過してクリック貫通させるか、通常通り塞ぐか)は
// 「今表示中の全モーダルがcompactかどうか」から都度再計算する(updateOverlayBackdropState)。
const MODAL_COMPACT_KEY = 'umaFactorLedger:modalCompact';
function isModalCompact() {
  try {
    return localStorage.getItem(MODAL_COMPACT_KEY) === '1';
  } catch {
    return false;
  }
}
let modalCompactZCounter = 200;
function bringModalToFront(modal) {
  modalCompactZCounter += 1;
  modal.style.zIndex = String(modalCompactZCounter);
}
function updateOverlayBackdropState() {
  if (!modalOverlay) return;
  const visible = Array.from(document.querySelectorAll('.modal')).filter(m => !m.hidden);
  const allCompact = visible.length > 0 && visible.every(m => m.classList.contains('compact-eligible') && m.classList.contains('compact'));
  modalOverlay.classList.toggle('all-compact', allCompact);
}
function updateModalCompactToggleBtn(modal, on) {
  const btn = modal.querySelector('.modal-compact-toggle');
  if (!btn) return;
  btn.textContent = on ? '⤢' : '⤡';
  btn.title = on ? 'ポップアップを元のサイズに戻す' : 'ポップアップを小さくして裏の画面を見る';
}
// modalを指定: そのモーダルだけ縮小on/offする。省略時は今表示中の
// 縮小対応モーダル全部に一括適用する(後方互換用)。
function setModalCompact(on, modal) {
  const targets = modal ? [modal] : Array.from(document.querySelectorAll('.modal.compact-eligible'));
  targets.forEach(m => {
    m.classList.toggle('compact', on);
    updateModalCompactToggleBtn(m, on);
    if (on) {
      applyModalCompactPos(m);
      bringModalToFront(m);
    } else {
      m.style.left = '';
      m.style.top = '';
      m.style.right = '';
      m.style.bottom = '';
    }
  });
  try { localStorage.setItem(MODAL_COMPACT_KEY, on ? '1' : '0'); } catch {}
  updateOverlayBackdropState();
}
// ページ内で新規にモーダルを開く時、縮小状態を初期化するためのヘルパー。
// keepState=true(ピン留めタブ経由の復元など)なら前回の既定(縮小/通常)を
// 引き継ぎ、falseなら常に通常サイズで開く。
function applyDefaultCompactOnOpen(modal, keepState) {
  if (!modal) return;
  setModalCompact(keepState ? isModalCompact() : false, modal);
}

// --- 縮小表示中、ヘッダーをドラッグしてポップアップを移動できるようにする ---
// 位置はモーダルごと(data-pos-keyで識別)に個別保存し、次回そのモーダルを
// 縮小表示した時に同じ場所へ復元する。保存位置が無い場合は、既に表示中の
// 他の縮小ポップアップの数だけ右下からずらした位置を初期値にする(複数同時に
// 開いても重ならないようにするため)。画面外に完全にはみ出さないよう、
// 各辺は自身の幅/高さの70%まではみ出し可(30%は必ず画面内に残す)に制限する。
const MODAL_COMPACT_POS_KEY = 'umaFactorLedger:modalCompactPos';
function loadModalCompactPosMap() {
  try {
    const raw = localStorage.getItem(MODAL_COMPACT_POS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}
function saveModalCompactPosForKey(key, pos) {
  if (!key) return;
  const map = loadModalCompactPosMap();
  map[key] = pos;
  try { localStorage.setItem(MODAL_COMPACT_POS_KEY, JSON.stringify(map)); } catch {}
}
function applyModalCompactPos(modal) {
  if (!modal.classList.contains('compact-eligible')) return;
  const key = modal.dataset.posKey || null;
  const saved = key ? loadModalCompactPosMap()[key] : null;
  if (saved) {
    modal.style.left = saved.left + 'px';
    modal.style.top = saved.top + 'px';
    modal.style.right = 'auto';
    modal.style.bottom = 'auto';
    return;
  }
  // 保存位置がまだ無い場合: transform-originがtop leftなので、CSSの
  // right/bottom指定のままだと縮小するほど右下の角から離れてしまう。
  // 表示中の(縮小後の)実測サイズから右下寄せの座標を計算して明示指定する。
  // 他に既に縮小表示中のモーダルがあれば、その数だけ左上へずらして重なりを避ける。
  const rect = modal.getBoundingClientRect();
  if (!rect.width || !rect.height) return; // 非表示中は測れないので何もしない
  const margin = 12;
  const othersOpen = Array.from(document.querySelectorAll('.modal.compact-eligible.compact')).filter(m => m !== modal).length;
  const cascade = Math.min(othersOpen, 6) * 26;
  modal.style.left = Math.max(margin, window.innerWidth - margin - rect.width - cascade) + 'px';
  modal.style.top = Math.max(margin, window.innerHeight - margin - rect.height - cascade) + 'px';
  modal.style.right = 'auto';
  modal.style.bottom = 'auto';
}
if (modalOverlay) {
  let dragState = null;
  modalOverlay.addEventListener('pointerdown', e => {
    const modal = e.target.closest('.modal');
    if (modal) bringModalToFront(modal);
    const header = e.target.closest('.modal-header-row');
    if (!header || e.target.closest('.modal-header-actions')) return;
    if (!modal || !modal.classList.contains('compact')) return;
    const rect = modal.getBoundingClientRect();
    dragState = {
      modal,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
    };
    header.setPointerCapture(e.pointerId);
  });
  modalOverlay.addEventListener('pointermove', e => {
    if (!dragState) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = dragState.width;
    const h = dragState.height;
    let left = dragState.startLeft + (e.clientX - dragState.startX);
    let top = dragState.startTop + (e.clientY - dragState.startY);
    left = Math.max(-w * 0.7, Math.min(vw - w * 0.3, left));
    top = Math.max(-h * 0.7, Math.min(vh - h * 0.3, top));
    dragState.modal.style.left = left + 'px';
    dragState.modal.style.top = top + 'px';
    dragState.modal.style.right = 'auto';
    dragState.modal.style.bottom = 'auto';
  });
  const endModalDrag = () => {
    if (!dragState) return;
    const rect = dragState.modal.getBoundingClientRect();
    saveModalCompactPosForKey(dragState.modal.dataset.posKey, { left: rect.left, top: rect.top });
    dragState = null;
  };
  modalOverlay.addEventListener('pointerup', endModalDrag);
  modalOverlay.addEventListener('pointercancel', endModalDrag);

  // character-config.js等が後からポップアップを追加/表示するケースにも
  // 対応するため、hidden属性の変化を監視して表示された瞬間に前面へ出し、
  // 縮小状態ならその位置を適用する。オーバーレイの背景状態も都度再計算する。
  const modalVisibilityObserver = new MutationObserver(mutations => {
    let changed = false;
    mutations.forEach(m => {
      const target = m.target;
      if (m.attributeName === 'hidden' && target.classList && target.classList.contains('modal')) {
        changed = true;
        if (!target.hidden) {
          bringModalToFront(target);
          if (target.classList.contains('compact')) applyModalCompactPos(target);
        }
      }
    });
    if (changed) updateOverlayBackdropState();
  });
  modalVisibilityObserver.observe(modalOverlay, { attributes: true, attributeFilter: ['hidden'], subtree: true });
}

const openSettingsModalBtn = document.getElementById('openSettingsModalBtn');
if (openSettingsModalBtn) {
  openSettingsModalBtn.addEventListener('click', () => openModal('settingsModal'));
}

// --- 設定モーダル内のタブ切り替え ---
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.querySelectorAll('.settings-pane').forEach(p => { p.hidden = p.dataset.pane !== target; });
  });
});

// --- GitHub連携設定フォーム ---
const cfgOwner = document.getElementById('cfgOwner');
const cfgRepo = document.getElementById('cfgRepo');
const cfgBranch = document.getElementById('cfgBranch');
const cfgToken = document.getElementById('cfgToken');
const cfgSaveBtn = document.getElementById('cfgSaveBtn');
const cfgClearBtn = document.getElementById('cfgClearBtn');

function fillConfigForm() {
  if (!cfgOwner) return;
  cfgOwner.value = (config && config.owner) || DEFAULT_OWNER;
  cfgRepo.value = (config && config.repo) || DEFAULT_REPO;
  cfgBranch.value = (config && config.branch) || '';
  cfgToken.value = (config && config.token) || '';
}

function setCfgStatus(msg, isError) {
  const el = document.getElementById('cfgStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
}

if (cfgSaveBtn) {
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
    if (typeof onGithubConfigChanged === 'function') await onGithubConfigChanged();
    setCfgStatus(token ? '接続しました。' : '接続しました（閲覧のみ。保存・削除にはPATが必要です）。');
  });
}

if (cfgClearBtn) {
  cfgClearBtn.addEventListener('click', () => {
    config = null;
    clearStoredConfig();
    fillConfigForm();
    if (typeof onGithubConfigChanged === 'function') onGithubConfigChanged();
    setCfgStatus('設定を消去しました。');
  });
}

fillConfigForm();

// --- ヘッダーナビゲーションの現在地ハイライト ---
const currentPage = location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('.masthead-nav').forEach(a => {
  if (a.getAttribute('href') === currentPage) a.classList.add('active');
});

// --- ポップアップのタブ登録(擬似タスクバー。ページを跨いで特定のポップアップに素早く戻れるようにする) ---
const PINNED_TABS_KEY = 'umaFactorLedger:pinnedTabs';

function escapeHtmlCommon(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadPinnedTabs() {
  try {
    const raw = localStorage.getItem(PINNED_TABS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function savePinnedTabsList(tabs) {
  localStorage.setItem(PINNED_TABS_KEY, JSON.stringify(tabs));
}
function isPinnedTab(key) {
  return loadPinnedTabs().some(t => t.key === key);
}
function addPinnedTab(tab) {
  const tabs = loadPinnedTabs().filter(t => t.key !== tab.key);
  tabs.push(tab);
  savePinnedTabsList(tabs);
  renderPinnedTabsBar();
}
function removePinnedTab(key) {
  savePinnedTabsList(loadPinnedTabs().filter(t => t.key !== key));
  renderPinnedTabsBar();
}

function renderPinnedTabsBar() {
  const bar = document.getElementById('pinnedTabsBar');
  if (!bar) return;
  const tabs = loadPinnedTabs();
  if (!tabs.length) {
    bar.innerHTML = '';
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.innerHTML = tabs.map(t => `
    <span class="pinned-tab" data-key="${escapeHtmlCommon(t.key)}">
      <span class="pinned-tab-icon">${escapeHtmlCommon(t.label.slice(0, 1))}</span>
      <span class="pinned-tab-label">${escapeHtmlCommon(t.label)}</span>
      <button type="button" class="pinned-tab-close" data-key="${escapeHtmlCommon(t.key)}">×</button>
    </span>
  `).join('');
  bar.querySelectorAll('.pinned-tab').forEach(el => {
    // マウスhoverの時だけ自動で全文表示する(タッチでもpointerenterは
    // 発火するが、pointerTypeで見分けてタッチでは反応させない。
    // タッチは代わりにclickの1回目で全文表示、2回目でポップアップを開く)
    el.addEventListener('pointerenter', e => {
      if (e.pointerType === 'mouse') el.classList.add('expanded');
    });
    el.addEventListener('pointerleave', e => {
      if (e.pointerType === 'mouse') el.classList.remove('expanded');
    });
    el.addEventListener('click', e => {
      if (e.target.closest('.pinned-tab-close')) return;
      if (!el.classList.contains('expanded')) {
        el.classList.add('expanded');
        return;
      }
      openPinnedTab(el.dataset.key);
    });
  });
  bar.querySelectorAll('.pinned-tab-close').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removePinnedTab(btn.dataset.key);
    });
  });
  positionPinnedTabsBar();
}

// マウスhover/タップで一時的に全文表示した登録タブを、
// タブ以外の場所を押したら通常の小さい表示に戻す
document.addEventListener('click', e => {
  if (e.target.closest('.pinned-tab')) return;
  document.querySelectorAll('.pinned-tab.expanded').forEach(el => el.classList.remove('expanded'));
});

// 登録タブの縦積みを、右下の＋/↑/↓ボタン群のすぐ上に来るように
// 都度位置合わせする(ページごとにボタン数が違い高さが変わるため)
function positionPinnedTabsBar() {
  const bar = document.getElementById('pinnedTabsBar');
  const fabGroup = document.getElementById('scrollFabGroup');
  if (!bar || !fabGroup || bar.hidden) return;
  const fabRect = fabGroup.getBoundingClientRect();
  bar.style.bottom = (window.innerHeight - fabRect.top + 10) + 'px';
}
window.addEventListener('resize', positionPinnedTabsBar);

function openPinnedTab(key) {
  const tab = loadPinnedTabs().find(t => t.key === key);
  if (!tab) return;
  // キャラ編成は複数キャラを同時に開けるようにしたいので、同じページを
  // 開いている時でもページ内蔵の単一モーダルではなく、常にcharacter-config.js
  // の複数インスタンス対応版を使う(training.html上でも他ページ経由でも
  // 挙動を揃えるため)。
  if (tab.type === 'characterConfig' && typeof window.openCharacterConfigWidget === 'function') {
    window.openCharacterConfigWidget(tab.params.plan, Number(tab.params.char), { keepCompactState: true });
    return;
  }
  if (tab.page === currentPage && typeof window.openPinnedTabTarget === 'function') {
    window.openPinnedTabTarget(tab);
    return;
  }
  // 育成計画詳細・イベント結果詳細はcharacter-config.js
  // を読み込んでいるどのページからでもポップアップとして開けるので、
  // 遷移せずその場で開く。
  if (tab.type === 'planDetail' && typeof window.openPlanDetailWidget === 'function') {
    window.openPlanDetailWidget(tab.params.plan);
    return;
  }
  if (tab.type === 'eventDetail' && typeof window.openEventDetailWidget === 'function') {
    window.openEventDetailWidget(tab.params.event);
    return;
  }
  const qs = new URLSearchParams(tab.params || {}).toString();
  location.href = tab.page + (qs ? '?' + qs : '');
}

renderPinnedTabsBar();

// --- トースト通知(左下に出て自動で消える) ---
let toastHideTimer = null;
let toastRemoveTimer = null;
function showToast(message) {
  let toast = document.getElementById('toastNotice');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toastNotice';
    toast.className = 'toast-notice';
    document.body.appendChild(toast);
  }
  clearTimeout(toastHideTimer);
  clearTimeout(toastRemoveTimer);
  toast.textContent = message;
  toast.classList.remove('hide');
  // 直前のトーストがフェードアウト中でも即座に再表示できるようreflowを挟む
  void toast.offsetWidth;
  toast.classList.add('show');
  toastHideTimer = setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hide');
    toastRemoveTimer = setTimeout(() => { toast.classList.remove('hide'); }, 300);
  }, 2200);
}
