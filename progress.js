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
  renderCharts();

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

// --- グラフ(タブレット横画面で数値一覧の右側に表示する、月間の増加数の棒グラフ) ---
// 総数を積み上げる折れ線ではなく、前回記録からの増分だけを月ごとの棒で見せる。
const CHART_VIEW_W = 480;
const CHART_VIEW_H = 190;
const CHART_PAD_TOP = 10;
const CHART_PAD_BOTTOM = 32;
const CHART_PAD_LEFT = 56;
const CHART_PAD_RIGHT = 10;

// 0/最大値のグリッド線をキリのいい数値(1/2/5×10^n)に丸める
function niceMax(value) {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const n = value / base;
  let niceN;
  if (n <= 1) niceN = 1;
  else if (n <= 2) niceN = 2;
  else if (n <= 5) niceN = 5;
  else niceN = 10;
  return niceN * base;
}

function measureTextWidth(text, fontSize, fontWeight) {
  if (!measureTextWidth._ctx) measureTextWidth._ctx = document.createElement('canvas').getContext('2d');
  const ctx = measureTextWidth._ctx;
  ctx.font = `${fontWeight || 400} ${fontSize}px 'M PLUS Rounded 1c', sans-serif`;
  return ctx.measureText(text).width;
}

// 上端だけ角丸・ベースライン側は直角の棒のpath(SVGのrxは四隅均等にしか
// 丸められないため、pathで上2角だけ丸める)
function roundedTopBarPath(x, y, w, h, r) {
  if (h <= 0) return '';
  const radius = Math.min(r, w / 2, h);
  return `M ${x} ${y + h} L ${x} ${y + radius} Q ${x} ${y} ${x + radius} ${y} `
    + `L ${x + w - radius} ${y} Q ${x + w} ${y} ${x + w} ${y + radius} L ${x + w} ${y + h} Z`;
}

// 年をまたいだ時だけ先頭に年を付ける(「26年8月」→「9月」「10月」→年が変わったら「27年1月」)
function monthLabelFor(dateStr, prevBarDateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return '?';
  const year = m[1];
  const month = Number(m[2]);
  const prevYear = prevBarDateStr ? (/^(\d{4})-/.exec(prevBarDateStr) || [])[1] : null;
  if (prevBarDateStr == null || prevYear !== year) return `${year.slice(2)}年${month}月`;
  return `${month}月`;
}

// 指定した項目の「1つ前の記録からの増分」を記録日の昇順(古い順)で並べる
function buildDiffSeries(key) {
  const ascending = allEntries.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const series = [];
  for (let i = 1; i < ascending.length; i++) {
    const cur = ascending[i];
    const prev = ascending[i - 1];
    if (cur[key] == null || prev[key] == null) continue;
    series.push({
      date: cur.date,
      label: monthLabelFor(cur.date, series.length ? series[series.length - 1].date : null),
      value: cur[key] - prev[key],
    });
  }
  return series;
}

const chartTooltipEl = document.getElementById('chartTooltip');
function showChartTooltip(targetEl, title, label, value) {
  const sign = value >= 0 ? '+' : '';
  chartTooltipEl.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = sign + formatNumber(value);
  chartTooltipEl.appendChild(strong);
  chartTooltipEl.appendChild(document.createTextNode(`${title} ／ ${label}`));
  chartTooltipEl.hidden = false;
  const rect = targetEl.getBoundingClientRect();
  chartTooltipEl.style.left = (rect.left + rect.width / 2) + 'px';
  chartTooltipEl.style.top = (rect.top - 6) + 'px';
  chartTooltipEl.style.transform = 'translate(-50%, -100%)';
}
function hideChartTooltip() {
  chartTooltipEl.hidden = true;
}

function renderBarChart(containerId, title, color, series) {
  const container = document.getElementById(containerId);
  if (!series.length) { container.innerHTML = ''; return; }

  const maxVal = niceMax(Math.max(...series.map(d => Math.abs(d.value)), 1));
  const plotW = CHART_VIEW_W - CHART_PAD_LEFT - CHART_PAD_RIGHT;
  const plotH = CHART_VIEW_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const baselineY = CHART_PAD_TOP + plotH;
  const slotW = plotW / series.length;
  const barW = Math.min(24, slotW * 0.6);

  let svg = `<svg viewBox="0 0 ${CHART_VIEW_W} ${CHART_VIEW_H}" role="img" aria-label="${escapeHtml(title)}の月間増加数">`;

  [0, maxVal].forEach(val => {
    const y = baselineY - (val / maxVal) * plotH;
    svg += `<line x1="${CHART_PAD_LEFT}" y1="${y}" x2="${CHART_VIEW_W - CHART_PAD_RIGHT}" y2="${y}" stroke="var(--panel-line)" stroke-width="1" />`;
    svg += `<text x="${CHART_PAD_LEFT - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--ink-soft)">${formatNumber(val)}</text>`;
  });

  series.forEach((d, i) => {
    const slotX = CHART_PAD_LEFT + i * slotW;
    const barX = slotX + (slotW - barW) / 2;
    const h = maxVal > 0 ? (Math.max(d.value, 0) / maxVal) * plotH : 0;
    const barY = baselineY - h;
    const path = roundedTopBarPath(barX, barY, barW, h, 4);

    svg += `<g class="progress-chart-bar-group" data-label="${escapeHtml(d.label)}" data-value="${d.value}">`;
    if (path) svg += `<path class="progress-chart-bar" d="${path}" fill="${color}" pointer-events="none" />`;
    svg += `<rect class="progress-chart-bar-hit" x="${slotX}" y="${CHART_PAD_TOP}" width="${slotW}" height="${plotH}" fill="transparent" tabindex="0" />`;

    const labelText = (d.value >= 0 ? '+' : '') + formatNumber(d.value);
    if (measureTextWidth(labelText, 9, 700) <= slotW - 4) {
      const labelY = Math.max(barY - 4, CHART_PAD_TOP + 8);
      svg += `<text x="${barX + barW / 2}" y="${labelY}" text-anchor="middle" font-size="9" font-weight="700" fill="var(--ink)" pointer-events="none">${escapeHtml(labelText)}</text>`;
    }
    svg += `<text x="${slotX + slotW / 2}" y="${baselineY + 14}" text-anchor="middle" font-size="9" fill="var(--ink-soft)" pointer-events="none">${escapeHtml(d.label)}</text>`;
    svg += `</g>`;
  });

  svg += `</svg>`;
  container.innerHTML = `<div class="progress-chart-title">${escapeHtml(title)}</div>${svg}`;

  container.querySelectorAll('.progress-chart-bar-group').forEach(g => {
    const hit = g.querySelector('.progress-chart-bar-hit');
    const bar = g.querySelector('.progress-chart-bar');
    const label = g.dataset.label;
    const value = Number(g.dataset.value);
    const onEnter = () => { if (bar) bar.style.opacity = '0.8'; showChartTooltip(hit, title, label, value); };
    const onLeave = () => { if (bar) bar.style.opacity = ''; hideChartTooltip(); };
    hit.addEventListener('pointerenter', onEnter);
    hit.addEventListener('pointerleave', onLeave);
    hit.addEventListener('focus', onEnter);
    hit.addEventListener('blur', onLeave);
  });
}

function renderCharts() {
  const chartEmptyMsg = document.getElementById('chartEmptyMsg');
  const trainingSeries = buildDiffSeries('trainingCount');
  const fansSeries = buildDiffSeries('totalFans');

  if (!trainingSeries.length && !fansSeries.length) {
    document.getElementById('trainingCountChart').innerHTML = '';
    document.getElementById('totalFansChart').innerHTML = '';
    chartEmptyMsg.style.display = 'block';
    return;
  }
  chartEmptyMsg.style.display = 'none';
  renderBarChart('trainingCountChart', '育成回数', 'var(--green-dim)', trainingSeries);
  renderBarChart('totalFansChart', 'ファン総獲得数', 'var(--blue)', fansSeries);
}

resetForm();
loadEntries();
