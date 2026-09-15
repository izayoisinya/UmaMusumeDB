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

const modalOverlay = document.getElementById('modalOverlay');
if (modalOverlay) {
  document.querySelectorAll('.modal-close-btn').forEach(btn => btn.addEventListener('click', closeModal));
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modalOverlay.hidden) closeModal(); });
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
