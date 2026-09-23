// pvp.js — 対人イベント記録ページ固有ロジック

const DATA_PATH = 'data/pvp_events.json';

class ConflictError extends Error {
  constructor() {
    super('conflict');
    this.name = 'ConflictError';
  }
}

let currentSha = null;
let allEvents = [];
let editingEventId = null;

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

async function fetchEventsRaw() {
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

async function saveEventsToGitHub(newEntries, commitMessage) {
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

function sortEvents(list) {
  return list.slice().sort((a, b) => {
    const monthDiff = (b.month || '').localeCompare(a.month || '');
    if (monthDiff !== 0) return monthDiff;
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

async function loadEvents() {
  setListStatus('読み込み中…');
  try {
    const { sha, entries } = await fetchEventsRaw();
    currentSha = sha;
    allEvents = sortEvents(entries);
    setListStatus('');
  } catch (err) {
    console.error(err);
    setListStatus('読み込みに失敗しました: ' + err.message, true);
  }
  renderEvents();
}

// common.jsのGitHub連携設定フォーム(保存/消去)から呼ばれるフック
function onGithubConfigChanged() {
  allEvents = [];
  currentSha = null;
  return loadEvents();
}

// --- イベント種別に応じたフォーム項目の出し分け ---
function getEventType() {
  const el = document.querySelector('input[name="fEventType"]:checked');
  return el ? el.value : 'champions';
}
function setEventType(type) {
  const el = document.querySelector(`input[name="fEventType"][value="${type === 'loh' ? 'loh' : 'champions'}"]`);
  if (el) el.checked = true;
  updateEventSectionVisibility();
}
function updateEventSectionVisibility() {
  const isLoh = getEventType() === 'loh';
  document.getElementById('championsSection').hidden = isLoh;
  document.getElementById('lohSection').hidden = !isLoh;
  document.querySelectorAll('.loh-only').forEach(el => { el.hidden = !isLoh; });
  updateFinalStatsVisibility();
}
document.querySelectorAll('input[name="fEventType"]').forEach(el => el.addEventListener('change', updateEventSectionVisibility));

function isFinalReached() {
  const el = document.querySelector('input[name="fFinalStatus"]:checked');
  return el ? el.value === 'reached' : true;
}
function setFinalReached(reached) {
  const el = document.querySelector(`input[name="fFinalStatus"][value="${reached ? 'reached' : 'not'}"]`);
  if (el) el.checked = true;
  updateFinalStatsVisibility();
}
function updateFinalStatsVisibility() {
  const showFinalStats = getEventType() === 'champions' && isFinalReached();
  document.getElementById('finalDetailSection').hidden = !isFinalReached();
  document.querySelectorAll('.champions-final-only').forEach(el => { el.hidden = !showFinalStats; });
}
document.querySelectorAll('input[name="fFinalStatus"]').forEach(el => el.addEventListener('change', updateFinalStatsVisibility));

function getRadioValue(name, fallback) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : fallback;
}
function setRadioValue(name, value, fallback) {
  const el = document.querySelector(`input[name="${name}"][value="${value || fallback}"]`);
  if (el) el.checked = true;
}

// --- 出走ウマ娘の画像アップロード(3人分) ---
function createTeamImageManager(index) {
  const dropzone = document.getElementById('teamImageDropzone' + index);
  const fileInput = document.getElementById('fTeamImage' + index);
  const preview = document.getElementById('teamImagePreview' + index);
  const previewWrap = document.getElementById('teamImagePreviewWrap' + index);
  const hint = document.getElementById('teamImageDropzoneHint' + index);
  const removeBtn = document.getElementById('removeTeamImageBtn' + index);
  let pendingDataUrl = null;
  let currentPath = null;
  let removeFlag = false;

  function showPreview(src) {
    preview.src = src;
    previewWrap.hidden = false;
    hint.hidden = true;
    removeBtn.hidden = false;
  }
  function hidePreview() {
    preview.src = '';
    previewWrap.hidden = true;
    hint.hidden = false;
    removeBtn.hidden = true;
  }

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      setStatus('画像を処理しています…');
      pendingDataUrl = await resizeImageFile(file, 800, 0.8);
      removeFlag = false;
      showPreview(pendingDataUrl);
      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus('画像の処理に失敗しました: ' + err.message, true);
    }
  });
  removeBtn.addEventListener('click', e => {
    e.stopPropagation();
    pendingDataUrl = null;
    fileInput.value = '';
    if (currentPath) removeFlag = true;
    hidePreview();
  });

  return {
    reset() {
      pendingDataUrl = null;
      currentPath = null;
      removeFlag = false;
      fileInput.value = '';
      hidePreview();
    },
    setExisting(path) {
      pendingDataUrl = null;
      removeFlag = false;
      currentPath = path || null;
      if (path) showPreview(imageRawUrl(path)); else hidePreview();
    },
    hasPending() { return !!pendingDataUrl; },
    getPendingDataUrl() { return pendingDataUrl; },
    shouldRemove() { return removeFlag && !!currentPath; },
    getCurrentPath() { return currentPath; },
    setUploadedPath(path) { currentPath = path; },
  };
}

const teamImageManagers = [1, 2, 3].map(createTeamImageManager);

// --- フォーム操作 ---
function setPvpModalMode(isEditing) {
  editingEventId = isEditing;
  document.getElementById('pvpModalTitle').textContent = isEditing ? '対人イベント記録を編集' : '対人イベント記録を追加';
  document.getElementById('savePvpBtn').textContent = isEditing ? 'この内容で更新' : 'この内容を保存';
}

function resetForm() {
  document.getElementById('pvpForm').reset();
  setEventType('champions');
  setFinalReached(true);
  setRadioValue('fTier', 'grade', 'grade');
  setRadioValue('fFinalRound', 'A', 'A');
  [1, 2, 3].forEach(i => {
    ['First', 'Second', 'Third', 'Other', 'Races'].forEach(key => {
      document.getElementById('fTeam' + key + i).value = 0;
    });
    teamImageManagers[i - 1].reset();
  });
  setStatus('');
  setPvpModalMode(null);
}

document.getElementById('openRegisterModalBtn').addEventListener('click', () => {
  resetForm();
  setPvpModalMode(null);
  openModal('pvpModal');
});

document.getElementById('clearBtn').addEventListener('click', resetForm);

function fillForm(ev) {
  document.getElementById('fMonth').value = ev.month || '';
  setEventType(ev.eventType);

  const rc = ev.raceCondition || {};
  document.getElementById('fLocation').value = rc.location || '';
  document.getElementById('fDistance').value = rc.distance != null ? rc.distance : '';
  setRadioValue('fSurface', rc.surface, '芝');
  setRadioValue('fTrackDirection', rc.direction, '右回り');
  setRadioValue('fSeason', rc.season, '春');
  setRadioValue('fWeather', rc.weather, '晴');
  setRadioValue('fGoing', rc.going, '良');

  const team = ev.team || [];
  [1, 2, 3].forEach(i => {
    const member = team[i - 1] || {};
    document.getElementById('fTeamName' + i).value = member.name || '';
    document.getElementById('fTeamWinRate' + i).value = member.winRate != null ? member.winRate : '';
    document.getElementById('fTeamPlaceRate' + i).value = member.placeRate != null ? member.placeRate : '';
    document.getElementById('fTeamShowRate' + i).value = member.showRate != null ? member.showRate : '';
    document.getElementById('fTeamPoints' + i).value = member.points != null ? member.points : '';
    const results = member.results || {};
    document.getElementById('fTeamFirst' + i).value = results.first || 0;
    document.getElementById('fTeamSecond' + i).value = results.second || 0;
    document.getElementById('fTeamThird' + i).value = results.third || 0;
    document.getElementById('fTeamOther' + i).value = results.other || 0;
    document.getElementById('fTeamRaces' + i).value = results.races || 0;
    teamImageManagers[i - 1].setExisting(member.imagePath);
  });

  const champions = ev.champions || {};
  setRadioValue('fTier', champions.tier, 'grade');
  setFinalReached(champions.reachedFinal !== false);
  setRadioValue('fFinalRound', champions.finalRound, 'A');
  document.getElementById('fFinalRank').value = champions.rank != null ? champions.rank : '';

  const loh = ev.loh || {};
  document.getElementById('fLohTotalPoints').value = loh.totalPoints != null ? loh.totalPoints : '';
  document.getElementById('fLohRank').value = loh.overallRank != null ? loh.overallRank : '';
  document.getElementById('fLohRankTier').value = loh.rankTier || '';

  document.getElementById('fNotes').value = ev.notes || '';
}

function startEditEvent(id) {
  const ev = allEvents.find(e => e.id === id);
  if (!ev) return;
  resetForm();
  setPvpModalMode(id);
  fillForm(ev);
  openModal('pvpModal');
}

function readTeamFromForm() {
  const includeResults = getEventType() === 'champions' && isFinalReached();
  return [1, 2, 3].map(i => {
    const name = document.getElementById('fTeamName' + i).value.trim();
    const winRateRaw = document.getElementById('fTeamWinRate' + i).value;
    const placeRateRaw = document.getElementById('fTeamPlaceRate' + i).value;
    const showRateRaw = document.getElementById('fTeamShowRate' + i).value;
    const pointsRaw = document.getElementById('fTeamPoints' + i).value;
    const manager = teamImageManagers[i - 1];
    return {
      name,
      winRate: winRateRaw === '' ? null : Number(winRateRaw),
      placeRate: placeRateRaw === '' ? null : Number(placeRateRaw),
      showRate: showRateRaw === '' ? null : Number(showRateRaw),
      points: pointsRaw === '' ? null : Number(pointsRaw),
      imagePath: manager.shouldRemove() ? null : (manager.getCurrentPath() || null),
      results: includeResults ? {
        first: Number(document.getElementById('fTeamFirst' + i).value) || 0,
        second: Number(document.getElementById('fTeamSecond' + i).value) || 0,
        third: Number(document.getElementById('fTeamThird' + i).value) || 0,
        other: Number(document.getElementById('fTeamOther' + i).value) || 0,
        races: Number(document.getElementById('fTeamRaces' + i).value) || 0,
      } : null,
    };
  });
}

// --- 保存 ---
document.getElementById('pvpForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!config || !config.token) { setStatus('保存にはPATが必要です。設定でPATを入力してください。', true); return; }
  const month = document.getElementById('fMonth').value;
  if (!month) { setStatus('開催月を入力してください。', true); return; }

  const eventId = editingEventId || ('pvp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  const eventType = getEventType();
  const finalRankRaw = document.getElementById('fFinalRank').value;
  const lohTotalRaw = document.getElementById('fLohTotalPoints').value;
  const lohRankRaw = document.getElementById('fLohRank').value;

  const distanceRaw = document.getElementById('fDistance').value;
  const ev = {
    id: eventId,
    month,
    eventType,
    raceCondition: {
      location: document.getElementById('fLocation').value,
      distance: distanceRaw === '' ? null : Number(distanceRaw),
      surface: getRadioValue('fSurface', '芝'),
      direction: getRadioValue('fTrackDirection', '右回り'),
      season: getRadioValue('fSeason', '春'),
      weather: getRadioValue('fWeather', '晴'),
      going: getRadioValue('fGoing', '良'),
    },
    team: [],
    champions: eventType === 'champions' ? {
      tier: getRadioValue('fTier', 'grade'),
      reachedFinal: isFinalReached(),
      finalRound: isFinalReached() ? getRadioValue('fFinalRound', 'A') : null,
      rank: (isFinalReached() && finalRankRaw !== '') ? Number(finalRankRaw) : null,
    } : null,
    loh: eventType === 'loh' ? {
      totalPoints: lohTotalRaw === '' ? null : Number(lohTotalRaw),
      overallRank: lohRankRaw === '' ? null : Number(lohRankRaw),
      rankTier: document.getElementById('fLohRankTier').value.trim(),
    } : null,
    notes: document.getElementById('fNotes').value.trim(),
    savedAt: new Date().toISOString(),
  };

  const isEditing = !!editingEventId;
  const updated = isEditing
    ? allEvents.map(e => e.id === editingEventId ? ev : e)
    : [ev, ...allEvents];
  setStatus(isEditing ? '更新しています…' : '保存しています…');
  const saveBtn = document.getElementById('savePvpBtn');
  saveBtn.disabled = true;
  try {
    for (let i = 1; i <= 3; i++) {
      const manager = teamImageManagers[i - 1];
      const name = document.getElementById('fTeamName' + i).value.trim();
      if (manager.hasPending()) {
        setStatus('画像をアップロードしています…');
        const imagePath = `images/${eventId}_uma${i}.jpg`;
        await uploadImageToGitHub(imagePath, manager.getPendingDataUrl(), `対人イベント出走ウマ娘画像アップロード: ${name || eventId}`);
        manager.setUploadedPath(imagePath);
      } else if (manager.shouldRemove()) {
        setStatus('画像を削除しています…');
        await deleteImageFromGitHub(manager.getCurrentPath(), `対人イベント出走ウマ娘画像削除: ${name || eventId}`);
        manager.setUploadedPath(null);
      }
    }
    ev.team = readTeamFromForm().filter(member => member.name);
    setStatus(isEditing ? '更新しています…' : '保存しています…');
    await saveEventsToGitHub(updated, `${isEditing ? '対人イベント記録編集' : '対人イベント記録追加'}: ${month}`);
    allEvents = sortEvents(updated);
    renderEvents();
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

function askDeleteConfirm(ev, btn) {
  pendingDeleteId = ev.id;
  pendingDeleteBtn = btn;
  document.getElementById('confirmDeleteMessage').textContent = `「${formatMonthLabel(ev.month)}」の記録を削除します。この操作は取り消せません。よろしいですか？`;
  openModal('confirmDeleteModal');
}

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
  const id = pendingDeleteId;
  const btn = pendingDeleteBtn;
  pendingDeleteId = null;
  pendingDeleteBtn = null;
  closeModal();
  deleteEvent(id, btn);
});

async function deleteEvent(id, btn) {
  if (!config || !config.token) { setListStatus('削除にはPATが必要です。設定でPATを入力してください。', true); return; }
  const target = allEvents.find(e => e.id === id);
  const updated = allEvents.filter(e => e.id !== id);
  setListStatus('削除しています…');
  if (btn) btn.disabled = true;
  try {
    await saveEventsToGitHub(updated, `対人イベント記録削除: ${target ? target.month : id}`);
    allEvents = updated;
    setListStatus('');
    renderEvents();
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

document.getElementById('refreshBtn').addEventListener('click', loadEvents);

// --- 一覧表示(開催月ごとにグルーピング) ---
function formatMonthLabel(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  return m ? `${m[1]}年${Number(m[2])}月` : (month || '不明な月');
}

function renderEvents() {
  const container = document.getElementById('entries');
  const emptyMsg = document.getElementById('emptyMsg');
  container.innerHTML = '';

  document.getElementById('countLabel').textContent = allEvents.length + ' 件記録';

  if (!allEvents.length) {
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';

  const groups = [];
  const groupByMonth = new Map();
  allEvents.forEach(ev => {
    const key = ev.month || '';
    if (!groupByMonth.has(key)) {
      const group = { month: key, events: [] };
      groupByMonth.set(key, group);
      groups.push(group);
    }
    groupByMonth.get(key).events.push(ev);
  });

  groups.forEach(group => {
    const section = document.createElement('div');
    section.className = 'month-group';
    const heading = document.createElement('h3');
    heading.className = 'month-group-heading';
    heading.textContent = formatMonthLabel(group.month);
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'entries';
    group.events.forEach(ev => {
      const row = document.createElement('div');
      row.className = 'entry';
      const isLoh = ev.eventType === 'loh';
      const eventTypeLabel = isLoh ? 'リーグオブヒーローズ' : 'チャンピオンズミーティング';

      let badges = `<span class="apt-badge">${eventTypeLabel}</span>`;
      let showResults = false;
      if (isLoh) {
        const loh = ev.loh || {};
        if (loh.rankTier) badges += `<span class="apt-badge">${escapeHtml(loh.rankTier)}</span>`;
        if (loh.totalPoints != null) badges += `<span class="apt-badge">合計 ${loh.totalPoints.toLocaleString('ja-JP')}pt</span>`;
        if (loh.overallRank != null) badges += `<span class="apt-badge">総合${loh.overallRank}位</span>`;
      } else {
        const champions = ev.champions || {};
        badges += `<span class="apt-badge">${champions.tier === 'open' ? 'オープンリーグ' : 'グレードリーグ'}</span>`;
        if (champions.reachedFinal === false) {
          badges += `<span class="apt-badge">決勝未進出</span>`;
        } else {
          badges += `<span class="apt-badge">決勝${champions.finalRound || '?'}グループ</span>`;
          if (champions.rank != null) badges += `<span class="apt-badge">決勝${champions.rank}位</span>`;
          showResults = true;
        }
      }

      const rc = ev.raceCondition || {};
      const raceConditionLabel = [
        rc.location,
        rc.distance != null ? `${rc.distance}m` : '',
        rc.surface,
        rc.direction,
        rc.season,
        rc.weather,
        rc.going,
      ].filter(Boolean).join(' ／ ');

      const teamCards = (ev.team || []).map(member => {
        const imageUrl = member.imagePath ? imageRawUrl(member.imagePath) : null;
        const rateBadges = [];
        if (member.winRate != null) rateBadges.push(`<span class="apt-badge">勝率${member.winRate}%</span>`);
        if (member.placeRate != null) rateBadges.push(`<span class="apt-badge">連対${member.placeRate}%</span>`);
        if (member.showRate != null) rateBadges.push(`<span class="apt-badge">複勝${member.showRate}%</span>`);
        if (isLoh && member.points != null) rateBadges.push(`<span class="apt-badge">${member.points}pt</span>`);
        const r = showResults ? member.results : null;
        const resultBadges = r ? [
          `<span class="apt-badge">1着${r.first || 0}</span>`,
          `<span class="apt-badge">2着${r.second || 0}</span>`,
          `<span class="apt-badge">3着${r.third || 0}</span>`,
          `<span class="apt-badge">圏外${r.other || 0}</span>`,
          `<span class="apt-badge">${r.races || 0}戦</span>`,
        ] : [];
        return `
          <div class="pvp-team-member">
            ${imageUrl ? `<img class="pvp-team-thumb team-img" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(member.name)}" loading="lazy">` : ''}
            <div class="entry-name">${escapeHtml(member.name)}</div>
            ${rateBadges.length ? `<div class="apt-row">${rateBadges.join('')}</div>` : ''}
            ${resultBadges.length ? `<div class="apt-row">${resultBadges.join('')}</div>` : ''}
          </div>
        `;
      }).join('');

      row.innerHTML = `
        <div class="entry-main">
          ${raceConditionLabel ? `<div class="entry-name-row"><div class="entry-name">${escapeHtml(raceConditionLabel)}</div></div>` : ''}
          <div class="apt-row">${badges}</div>
          ${teamCards ? `<div class="pvp-team-grid">${teamCards}</div>` : ''}
          ${ev.notes ? `<div class="entry-notes">${escapeHtml(ev.notes)}</div>` : ''}
        </div>
        <div class="entry-side">
          <div class="entry-actions">
            <button class="entry-edit" data-id="${ev.id}">編集</button>
            <button class="entry-del" data-id="${ev.id}">削除</button>
          </div>
        </div>
      `;
      row.querySelector('.entry-edit').addEventListener('click', () => startEditEvent(ev.id));
      row.querySelector('.entry-del').addEventListener('click', e => askDeleteConfirm(ev, e.currentTarget));
      row.querySelectorAll('.team-img').forEach(img => {
        img.addEventListener('click', () => openLightbox(img.src));
      });
      list.appendChild(row);
    });
    section.appendChild(list);
    container.appendChild(section);
  });
}

resetForm();
loadEvents();
