// character-config.js — タブ登録できるポップアップ(キャラ編成/育成計画詳細/
// イベント結果詳細)をページ非依存で開けるようにする共通部品
//
// training.js/pvp.jsの各ポップアップ(キャラ編成=サポカ編成6枚+因子設計図、
// 育成計画詳細、イベント結果詳細)を、どのページからでも
// window.openCharacterConfigWidget(planId, charIndex, options) /
// window.openPlanDetailWidget(planId, options) /
// window.openEventDetailWidget(eventId, options)
// で呼び出せる共通部品に切り出したもの。必要なモーダルHTMLは初回呼び出し時に
// 現在のページの#modalOverlayへ自動で挿入する(common.jsのopenModal/closeModal
// と同じ仕組みに乗る)。
//
// 呼び出し元のページが何を読み込んでいるかに依存しないよう、データ(育成計画/
// ウマ娘/サポカ/イベント結果)は呼び出しのたびに自前で取得する。

(function () {
  const DATA_PATH = 'data/training_plans.json';
  const UMA_PATH = 'data/uma_musume.json';
  const SUPPORT_PATH = 'data/support_cards.json';
  const EVENTS_PATH = 'data/pvp_events.json';

  class CcConflictError extends Error {
    constructor() {
      super('conflict');
      this.name = 'CcConflictError';
    }
  }

  function ccEscapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function ccDecodeBase64Utf8(b64) {
    const binary = atob(b64.replace(/\n/g, ''));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }
  function ccEncodeUtf8Base64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function ccContentsApiUrl(path) {
    const owner = (config && config.owner) || DEFAULT_OWNER;
    const repo = (config && config.repo) || DEFAULT_REPO;
    return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
  }
  function ccContentsApiUrlForGet(path) {
    const url = ccContentsApiUrl(path);
    const branch = config && config.branch;
    return branch ? `${url}?ref=${encodeURIComponent(branch)}` : url;
  }

  async function ccFetchJson(path) {
    const res = await fetch(ccContentsApiUrlForGet(path), { headers: authHeaders(), cache: 'no-store' });
    if (res.status === 404) return [];
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || `GitHub APIエラー: ${res.status}`);
    }
    const json = await res.json();
    try {
      const arr = JSON.parse(ccDecodeBase64Utf8(json.content));
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  async function ccFetchPlansRaw() {
    const res = await fetch(ccContentsApiUrlForGet(DATA_PATH), { headers: authHeaders(), cache: 'no-store' });
    if (res.status === 404) return { sha: null, entries: [] };
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || `GitHub APIエラー: ${res.status}`);
    }
    const json = await res.json();
    let entries = [];
    try {
      entries = JSON.parse(ccDecodeBase64Utf8(json.content));
      if (!Array.isArray(entries)) entries = [];
    } catch {
      entries = [];
    }
    return { sha: json.sha, entries };
  }

  async function ccSavePlans(newEntries, sha, commitMessage) {
    const body = {
      message: commitMessage,
      content: ccEncodeUtf8Base64(JSON.stringify(newEntries, null, 2)),
    };
    if (config && config.branch) body.branch = config.branch;
    if (sha) body.sha = sha;
    const res = await fetch(ccContentsApiUrl(DATA_PATH), {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 409) throw new CcConflictError();
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || `GitHub APIエラー: ${res.status}`);
    }
  }

  // --- 適性表示・入力の共通ヘルパー ---
  const CC_APT_RANKS = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
  function ccAptBadge(prefix, v) {
    const rankClass = v ? 'rank-' + v : 'rank-none';
    return `<span class="apt-badge ${rankClass}">${prefix}${v || '-'}</span>`;
  }
  function ccAptSelect(id, value) {
    return `<select id="${id}"><option value="">-</option>${CC_APT_RANKS.map(r => `<option value="${r}"${value === r ? ' selected' : ''}>${r}</option>`).join('')}</select>`;
  }
  const CC_APT_TYPE_LABELS = {
    'track.turf': '芝', 'track.dirt': 'ダート',
    'distance.short': '短距離', 'distance.mile': 'マイル', 'distance.medium': '中距離', 'distance.long': '長距離',
    'style.nige': '逃げ', 'style.senko': '先行', 'style.sashi': '差し', 'style.oikomi': '追込',
  };
  const CC_RANK_SCALE = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];
  function ccBoostRank(baseRank, bonus) {
    if (!baseRank || !bonus) return baseRank || null;
    const idx = CC_RANK_SCALE.indexOf(baseRank);
    if (idx === -1) return baseRank;
    return CC_RANK_SCALE[Math.min(CC_RANK_SCALE.length - 1, idx + bonus)];
  }
  function ccAptBadgeBoosted(prefix, base, bonus) {
    if (!bonus) return ccAptBadge(prefix, base);
    const boosted = ccBoostRank(base, bonus);
    const rankClass = boosted ? 'rank-' + boosted : 'rank-none';
    return `<span class="apt-badge ${rankClass}">${prefix}${boosted || '-'}<small>+${bonus}</small></span>`;
  }
  function ccEmptyPedigreeEntry() {
    return { id: null, name: '', imagePath: null, manual: true, track: {}, distance: {}, style: {} };
  }
  function ccPedigreeEntryFromUma(u) {
    return {
      id: u.id, name: u.name, imagePath: u.imagePath || null, manual: false,
      track: u.track || {}, distance: u.distance || {}, style: u.style || {},
    };
  }

  // --- 状態 ---
  let ccPlans = [];
  let ccSha = null;
  let ccUmas = [];
  let ccSupportCards = [];
  let ccPlanId = null;
  let ccCharIndex = null;
  let ccReturnModalId = null;
  let ccOnSaved = null;
  let ccDeckSelections = [null, null, null, null, null, null];
  let ccPedigreeSelections = new Array(7).fill(null);
  let ccDeckPickerSlot = null;
  let ccUmaPickerTargetSlot = null;
  let ccPlanDetailId = null;
  let ccPlanDetailReturnModalId = null;
  let ccEvents = [];
  let ccEventDetailId = null;
  let ccEventDetailReturnModalId = null;

  // --- モーダルHTML注入(初回のみ) ---
  function ensureMarkup() {
    if (document.getElementById('ccCharacterConfigModal')) return;
    const overlay = document.getElementById('modalOverlay');
    if (!overlay) return;

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="modal" id="ccCharacterConfigModal" role="dialog" aria-labelledby="ccCharacterConfigTitle" hidden>
        <div class="modal-header-row">
          <h2 id="ccCharacterConfigTitle">キャラ編成</h2>
          <div class="modal-header-actions">
            <button type="button" class="modal-icon-btn" id="ccCharacterConfigSaveBtn" title="この内容を保存" aria-label="この内容を保存">💾</button>
            <button type="button" class="modal-icon-btn" id="ccCharacterConfigPinBtn" title="タブに登録" aria-label="タブに登録">📌</button>
            <button type="button" class="modal-icon-btn" id="ccCharacterConfigCloseBtn" title="閉じる" aria-label="閉じる">✕</button>
          </div>
        </div>
        <div id="ccCharacterConfigBody"></div>
        <div class="status" id="ccCharacterConfigStatus"></div>
      </div>
      <div class="modal" id="ccSupportCardPickerModal" role="dialog" aria-labelledby="ccSupportCardPickerTitle" hidden>
        <h2 id="ccSupportCardPickerTitle">サポートカードを選択</h2>
        <input type="text" id="ccSupportCardPickerSearch" class="character-picker-search" placeholder="名前で検索">
        <div id="ccSupportCardPickerGrid" class="character-picker-grid"></div>
        <div class="status" id="ccSupportCardPickerStatus"></div>
        <button type="button" class="btn secondary" id="ccSupportCardPickerCloseBtn">閉じる</button>
      </div>
      <div class="modal" id="ccUmaPickerModal" role="dialog" aria-labelledby="ccUmaPickerTitle" hidden>
        <h2 id="ccUmaPickerTitle">ウマ娘を選択</h2>
        <input type="text" id="ccUmaPickerSearch" class="character-picker-search" placeholder="名前で検索">
        <div id="ccUmaPickerGrid" class="character-picker-grid"></div>
        <div class="status" id="ccUmaPickerStatus"></div>
        <button type="button" class="btn secondary" id="ccUmaPickerCloseBtn">閉じる</button>
      </div>
      <div class="modal" id="ccPlanDetailModal" role="dialog" aria-labelledby="ccPlanDetailTitle" hidden>
        <div class="modal-header-row">
          <h2 id="ccPlanDetailTitle">育成計画詳細</h2>
          <div class="modal-header-actions">
            <button type="button" class="modal-icon-btn" id="ccPlanDetailPinBtn" title="タブに登録" aria-label="タブに登録">📌</button>
            <button type="button" class="modal-icon-btn" id="ccPlanDetailCloseBtn" title="閉じる" aria-label="閉じる">✕</button>
          </div>
        </div>
        <div id="ccPlanDetailBody"></div>
        <div class="status" id="ccPlanDetailStatus"></div>
      </div>
      <div class="modal" id="ccEventDetailModal" role="dialog" aria-labelledby="ccEventDetailTitle" hidden>
        <div class="modal-header-row">
          <h2 id="ccEventDetailTitle">イベント結果詳細</h2>
          <div class="modal-header-actions">
            <button type="button" class="modal-icon-btn" id="ccEventDetailPinBtn" title="タブに登録" aria-label="タブに登録">📌</button>
            <button type="button" class="modal-icon-btn" id="ccEventDetailCloseBtn" title="閉じる" aria-label="閉じる">✕</button>
          </div>
        </div>
        <div id="ccEventDetailBody"></div>
        <div class="status" id="ccEventDetailStatus"></div>
      </div>
    `;
    while (wrap.firstElementChild) overlay.appendChild(wrap.firstElementChild);

    document.getElementById('ccCharacterConfigCloseBtn').addEventListener('click', closeWidget);
    document.getElementById('ccCharacterConfigSaveBtn').addEventListener('click', handleSave);
    document.getElementById('ccCharacterConfigPinBtn').addEventListener('click', handlePin);
    document.getElementById('ccSupportCardPickerCloseBtn').addEventListener('click', closeSupportPicker);
    document.getElementById('ccUmaPickerCloseBtn').addEventListener('click', closeUmaPicker);
    document.getElementById('ccSupportCardPickerSearch').addEventListener('input', debounce(() => {
      renderSupportPickerGrid(document.getElementById('ccSupportCardPickerSearch').value);
    }, 150));
    document.getElementById('ccUmaPickerSearch').addEventListener('input', debounce(() => {
      renderUmaPickerGrid(document.getElementById('ccUmaPickerSearch').value);
    }, 150));
    document.getElementById('ccPlanDetailCloseBtn').addEventListener('click', closePlanDetailWidget);
    document.getElementById('ccPlanDetailPinBtn').addEventListener('click', handlePlanDetailPin);
    document.getElementById('ccEventDetailCloseBtn').addEventListener('click', closeEventDetailWidget);
    document.getElementById('ccEventDetailPinBtn').addEventListener('click', handleEventDetailPin);
  }

  // --- 公開エントリポイント ---
  window.openCharacterConfigWidget = async function (planId, charIndex, options) {
    options = options || {};
    if (!config || !config.owner || !config.repo) {
      alert('先に「⚙ 設定」からGitHub連携(リポジトリ所有者・リポジトリ名)を設定してください。');
      return;
    }
    ensureMarkup();
    ccPlanId = planId;
    ccCharIndex = charIndex;
    ccReturnModalId = options.returnModalId || null;
    ccOnSaved = typeof options.onSaved === 'function' ? options.onSaved : null;

    const statusEl = document.getElementById('ccCharacterConfigStatus');
    statusEl.textContent = '読み込み中…';
    statusEl.className = 'status';
    document.getElementById('ccCharacterConfigBody').innerHTML = '';

    if (ccReturnModalId) {
      const returnEl = document.getElementById(ccReturnModalId);
      if (returnEl) returnEl.hidden = true;
    }
    document.getElementById('ccCharacterConfigModal').hidden = false;
    document.getElementById('modalOverlay').hidden = false;

    try {
      const [plansRaw, umas, supports] = await Promise.all([
        ccFetchPlansRaw(),
        ccFetchJson(UMA_PATH),
        ccFetchJson(SUPPORT_PATH),
      ]);
      ccPlans = plansRaw.entries;
      ccSha = plansRaw.sha;
      ccUmas = umas;
      ccSupportCards = supports;
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'データの読み込みに失敗しました: ' + err.message;
      statusEl.className = 'status error';
      return;
    }

    const plan = ccPlans.find(p => p.id === planId);
    const character = plan && (plan.characters || [])[charIndex];
    if (!plan || !character) {
      statusEl.textContent = '対象の育成計画・キャラが見つかりませんでした。';
      statusEl.className = 'status error';
      return;
    }

    ccDeckSelections = [0, 1, 2, 3, 4, 5].map(i => {
      const d = (character.supportDeck || [])[i];
      if (!d) return null;
      const card = d.id ? ccSupportCards.find(c => c.id === d.id) : ccSupportCards.find(c => c.name === d.name);
      return card
        ? { id: card.id, name: card.name, imagePath: card.imagePath || null }
        : { id: d.id || null, name: d.name, imagePath: null };
    });
    const savedPedigree = character.pedigree || [];
    ccPedigreeSelections = [0, 1, 2, 3, 4, 5, 6].map(slot => {
      const p = savedPedigree[slot];
      // 保存データにはimagePathを含めていない(図鑑参照時は常に最新の登録内容を
      // 反映させるため)。図鑑登録済み(manual:false)の場合はidから毎回引き直す。
      if (p && !p.manual && p.id) {
        const uma = ccUmas.find(u => u.id === p.id);
        if (uma) return { ...ccPedigreeEntryFromUma(uma), redFactor: p.redFactor || null };
      }
      if (p) return p;
      if (slot === 0) {
        const uma = character.id ? ccUmas.find(u => u.id === character.id) : ccUmas.find(u => u.name === character.name);
        return uma ? ccPedigreeEntryFromUma(uma) : { id: null, name: character.name, imagePath: null, manual: true, track: {}, distance: {}, style: {} };
      }
      return null;
    });

    document.getElementById('ccCharacterConfigTitle').textContent = `${character.name}の編成`;
    renderBody();
    statusEl.textContent = '';
  };

  function closeWidget() {
    document.getElementById('ccCharacterConfigModal').hidden = true;
    if (ccReturnModalId && document.getElementById(ccReturnModalId)) {
      document.getElementById(ccReturnModalId).hidden = false;
    } else if (typeof closeModal === 'function') {
      closeModal();
    }
  }

  function handlePin() {
    const plan = ccPlans.find(p => p.id === ccPlanId);
    const character = plan && (plan.characters || [])[ccCharIndex];
    if (!plan || !character || typeof addPinnedTab !== 'function') return;
    addPinnedTab({
      key: `training-char-${plan.id}-${ccCharIndex}`,
      page: 'training.html',
      type: 'characterConfig',
      params: { plan: plan.id, char: ccCharIndex },
      label: `${character.name}の編成`,
    });
  }

  // --- 育成計画詳細ポップアップ ---
  window.openPlanDetailWidget = async function (planId, options) {
    options = options || {};
    if (!config || !config.owner || !config.repo) {
      alert('先に「⚙ 設定」からGitHub連携(リポジトリ所有者・リポジトリ名)を設定してください。');
      return;
    }
    ensureMarkup();
    ccPlanDetailId = planId;
    ccPlanDetailReturnModalId = options.returnModalId || null;

    const statusEl = document.getElementById('ccPlanDetailStatus');
    statusEl.textContent = '読み込み中…';
    statusEl.className = 'status';
    document.getElementById('ccPlanDetailBody').innerHTML = '';

    if (ccPlanDetailReturnModalId) {
      const returnEl = document.getElementById(ccPlanDetailReturnModalId);
      if (returnEl) returnEl.hidden = true;
    }
    document.getElementById('ccPlanDetailModal').hidden = false;
    document.getElementById('modalOverlay').hidden = false;

    try {
      const [plansRaw, umas] = await Promise.all([
        ccFetchPlansRaw(),
        ccFetchJson(UMA_PATH),
      ]);
      ccPlans = plansRaw.entries;
      ccSha = plansRaw.sha;
      ccUmas = umas;
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'データの読み込みに失敗しました: ' + err.message;
      statusEl.className = 'status error';
      return;
    }

    const plan = ccPlans.find(p => p.id === planId);
    if (!plan) {
      statusEl.textContent = '対象の育成計画が見つかりませんでした。';
      statusEl.className = 'status error';
      return;
    }

    document.getElementById('ccPlanDetailTitle').textContent = planLabelCc(plan);
    renderPlanDetailBody(plan);
    statusEl.textContent = '';
  };

  function planLabelCc(plan) {
    if (plan.title) return plan.title;
    const names = (plan.characters || []).map(c => c.name).filter(Boolean).join('・');
    return names || '無題';
  }
  function formatMonthLabelCc(month) {
    const m = /^(\d{4})-(\d{2})$/.exec(month || '');
    return m ? `${m[1]}年${Number(m[2])}月` : '';
  }

  function renderPlanDetailBody(plan) {
    const monthLabel = formatMonthLabelCc(plan.month);
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
      const uma = c.id ? ccUmas.find(u => u.id === c.id) : ccUmas.find(u => u.name === c.name);
      const imageUrl = uma && uma.imagePath ? imageRawUrl(uma.imagePath) : null;
      const deckCount = (c.supportDeck || []).filter(Boolean).length;
      return `
        <div class="plan-char-chip plan-detail-char" data-index="${idx}">
          ${imageUrl ? `<img class="uma-icon" src="${ccEscapeHtml(imageUrl)}" alt="${ccEscapeHtml(c.name)}" loading="lazy">` : ''}
          <span>${ccEscapeHtml(c.name)}${deckCount ? `<br><small>サポカ${deckCount}/6</small>` : ''}</span>
        </div>
      `;
    }).join('');

    const body = document.getElementById('ccPlanDetailBody');
    body.innerHTML = `
      <div class="entry-name-row">
        ${monthLabel ? `<span class="apt-badge">${ccEscapeHtml(monthLabel)}</span>` : ''}
        <div class="entry-name">${plan.title ? ccEscapeHtml(plan.title) : '（タイトル未設定）'}</div>
      </div>
      <div class="apt-row"><span class="apt-badge">${eventTypeLabel}</span></div>
      ${raceConditionLabel ? `<div class="entry-notes">${ccEscapeHtml(raceConditionLabel)}</div>` : ''}
      ${charCardsHtml ? `<div class="apt-group owner-group"><span class="apt-group-label">育成予定(タップして編成を設定)</span><div class="plan-char-row">${charCardsHtml}</div></div>` : ''}
      ${plan.notes ? `<div class="entry-notes">${ccEscapeHtml(plan.notes)}</div>` : ''}
    `;
    body.querySelectorAll('.plan-detail-char').forEach(el => {
      el.addEventListener('click', () => {
        window.openCharacterConfigWidget(plan.id, Number(el.dataset.index), { returnModalId: 'ccPlanDetailModal' });
      });
    });
  }

  function closePlanDetailWidget() {
    document.getElementById('ccPlanDetailModal').hidden = true;
    if (ccPlanDetailReturnModalId && document.getElementById(ccPlanDetailReturnModalId)) {
      document.getElementById(ccPlanDetailReturnModalId).hidden = false;
    } else if (typeof closeModal === 'function') {
      closeModal();
    }
  }

  function handlePlanDetailPin() {
    const plan = ccPlans.find(p => p.id === ccPlanDetailId);
    if (!plan || typeof addPinnedTab !== 'function') return;
    addPinnedTab({
      key: `training-plan-${plan.id}`,
      page: 'training.html',
      type: 'planDetail',
      params: { plan: plan.id },
      label: planLabelCc(plan),
    });
  }

  // --- イベント結果詳細ポップアップ(読み取り専用) ---
  function formatMonthLabelEventCc(month) {
    const m = /^(\d{4})-(\d{2})$/.exec(month || '');
    return m ? `${m[1]}年${Number(m[2])}月` : (month || '不明な月');
  }

  function eventMetaCc(ev) {
    const isLoh = ev.eventType === 'loh';
    const eventTypeLabel = isLoh ? 'リーグオブヒーローズ' : 'チャンピオンズミーティング';

    let badges = `<span class="apt-badge">${eventTypeLabel}</span>`;
    let showResults = false;
    if (isLoh) {
      const loh = ev.loh || {};
      if (loh.rankTier) badges += `<span class="apt-badge">${ccEscapeHtml(loh.rankTier)}</span>`;
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

    return { isLoh, badges, showResults, raceConditionLabel };
  }

  function renderEventDetailBody(ev) {
    const { isLoh, badges, showResults, raceConditionLabel } = eventMetaCc(ev);

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
          ${imageUrl ? `<img class="pvp-team-thumb team-img" src="${ccEscapeHtml(imageUrl)}" alt="${ccEscapeHtml(member.name)}" loading="lazy">` : ''}
          <div class="entry-name">${ccEscapeHtml(member.name)}</div>
          ${rateBadges.length ? `<div class="apt-row">${rateBadges.join('')}</div>` : ''}
          ${resultBadges.length ? `<div class="apt-row">${resultBadges.join('')}</div>` : ''}
        </div>
      `;
    }).join('');

    const videoUrl = ev.videoPath ? imageRawUrl(ev.videoPath) : null;
    const videoWrap = videoUrl
      ? `<div class="pvp-video-wrap"><span class="apt-group-label">決勝動画</span><video controls preload="metadata" playsinline src="${ccEscapeHtml(videoUrl)}"></video></div>`
      : '';

    const extraImagesHtml = (ev.extraImages || []).length
      ? `<div class="pvp-extra-images"><span class="apt-group-label">参考画像</span><div class="extra-images-grid">${
          (ev.extraImages || []).map(path => `<div class="extra-image-thumb"><img class="extra-img" src="${ccEscapeHtml(imageRawUrl(path))}" alt="参考画像" loading="lazy"></div>`).join('')
        }</div></div>`
      : '';

    const body = document.getElementById('ccEventDetailBody');
    body.innerHTML = `
      ${raceConditionLabel ? `<div class="entry-name-row"><div class="entry-name">${ccEscapeHtml(raceConditionLabel)}</div></div>` : ''}
      <div class="apt-row">${badges}</div>
      ${teamCards ? `<div class="pvp-team-grid">${teamCards}</div>` : ''}
      ${videoWrap}
      ${extraImagesHtml}
      ${ev.notes ? `<div class="entry-notes">${ccEscapeHtml(ev.notes)}</div>` : ''}
    `;
    body.querySelectorAll('.team-img, .extra-img').forEach(img => {
      img.addEventListener('click', () => { if (typeof openLightbox === 'function') openLightbox(img.src); });
    });
  }

  window.openEventDetailWidget = async function (eventId, options) {
    options = options || {};
    if (!config || !config.owner || !config.repo) {
      alert('先に「⚙ 設定」からGitHub連携(リポジトリ所有者・リポジトリ名)を設定してください。');
      return;
    }
    ensureMarkup();
    ccEventDetailId = eventId;
    ccEventDetailReturnModalId = options.returnModalId || null;

    const statusEl = document.getElementById('ccEventDetailStatus');
    statusEl.textContent = '読み込み中…';
    statusEl.className = 'status';
    document.getElementById('ccEventDetailBody').innerHTML = '';

    if (ccEventDetailReturnModalId) {
      const returnEl = document.getElementById(ccEventDetailReturnModalId);
      if (returnEl) returnEl.hidden = true;
    }
    document.getElementById('ccEventDetailModal').hidden = false;
    document.getElementById('modalOverlay').hidden = false;

    try {
      const [events, umas] = await Promise.all([
        ccFetchJson(EVENTS_PATH),
        ccFetchJson(UMA_PATH),
      ]);
      ccEvents = events;
      ccUmas = umas;
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'データの読み込みに失敗しました: ' + err.message;
      statusEl.className = 'status error';
      return;
    }

    const ev = ccEvents.find(e => e.id === eventId);
    if (!ev) {
      statusEl.textContent = '対象のイベント結果が見つかりませんでした。';
      statusEl.className = 'status error';
      return;
    }

    document.getElementById('ccEventDetailTitle').textContent = `${formatMonthLabelEventCc(ev.month)} イベント結果詳細`;
    renderEventDetailBody(ev);
    statusEl.textContent = '';
  };

  function closeEventDetailWidget() {
    document.getElementById('ccEventDetailModal').hidden = true;
    if (ccEventDetailReturnModalId && document.getElementById(ccEventDetailReturnModalId)) {
      document.getElementById(ccEventDetailReturnModalId).hidden = false;
    } else if (typeof closeModal === 'function') {
      closeModal();
    }
  }

  function handleEventDetailPin() {
    const ev = ccEvents.find(e => e.id === ccEventDetailId);
    if (!ev || typeof addPinnedTab !== 'function') return;
    const { raceConditionLabel } = eventMetaCc(ev);
    addPinnedTab({
      key: `pvp-event-${ev.id}`,
      page: 'pvp.html',
      type: 'eventDetail',
      params: { event: ev.id },
      label: `${formatMonthLabelEventCc(ev.month)} ${raceConditionLabel || ''}`.trim(),
    });
  }

  // --- 本体描画 ---
  function pedigreeCardHtml(slot, label) {
    const sel = ccPedigreeSelections[slot];
    const redFactor = (sel && sel.redFactor) || {};
    const isWide = slot <= 2;
    const isParent = slot === 1 || slot === 2;
    // 親A(1)・祖a(3)・祖b(4)は同じ色、親B(2)・祖c(5)・祖d(6)は別の色の枠で
    // 囲み、どの祖がどの親に対応するか見た目で分かるようにする。
    const groupClass = [1, 3, 4].includes(slot) ? ' pedigree-group-a' : [2, 5, 6].includes(slot) ? ' pedigree-group-b' : '';
    return `
      <div class="pedigree-card${isWide ? ' pedigree-card-wide' : ''}${isParent ? ' pedigree-card-parent' : ''}${groupClass}">
        <div class="pedigree-card-label">${label}</div>
        <div class="pedigree-card-main">
          <div class="char-select-box" id="ccPedigreeBox${slot}">
            <button type="button" class="char-select-clear-btn" id="ccPedigreeClearBtn${slot}" hidden>×</button>
            <div id="ccPedigreeEmpty${slot}">タップして図鑑から選択</div>
            <div class="char-select-filled-inner" id="ccPedigreeFilled${slot}" hidden>
              <img class="uma-icon" id="ccPedigreeIcon${slot}" alt="">
              <span id="ccPedigreeName${slot}"></span>
            </div>
          </div>
          <div class="pedigree-apt-area" id="ccPedigreeAptArea${slot}"></div>
        </div>
        ${slot !== 0 ? `
          <div class="pedigree-red-factor">
            <label>赤因子</label>
            <div class="star-rating" id="ccPedigreeRedRarity${slot}" data-value="${Number(redFactor.rarity) || 0}">
              ${[1, 2, 3].map(n => `<button type="button" class="star-btn${n <= (Number(redFactor.rarity) || 0) ? ' active' : ''}" data-star="${n}">★</button>`).join('')}
            </div>
            <select id="ccPedigreeRedType${slot}">
              <option value="">種類を選択</option>
              <optgroup label="バ場">
                <option value="track.turf"${redFactor.type === 'track.turf' ? ' selected' : ''}>芝</option>
                <option value="track.dirt"${redFactor.type === 'track.dirt' ? ' selected' : ''}>ダート</option>
              </optgroup>
              <optgroup label="距離">
                <option value="distance.short"${redFactor.type === 'distance.short' ? ' selected' : ''}>短距離</option>
                <option value="distance.mile"${redFactor.type === 'distance.mile' ? ' selected' : ''}>マイル</option>
                <option value="distance.medium"${redFactor.type === 'distance.medium' ? ' selected' : ''}>中距離</option>
                <option value="distance.long"${redFactor.type === 'distance.long' ? ' selected' : ''}>長距離</option>
              </optgroup>
              <optgroup label="脚質">
                <option value="style.nige"${redFactor.type === 'style.nige' ? ' selected' : ''}>逃げ</option>
                <option value="style.senko"${redFactor.type === 'style.senko' ? ' selected' : ''}>先行</option>
                <option value="style.sashi"${redFactor.type === 'style.sashi' ? ' selected' : ''}>差し</option>
                <option value="style.oikomi"${redFactor.type === 'style.oikomi' ? ' selected' : ''}>追込</option>
              </optgroup>
            </select>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderBody() {
    const body = document.getElementById('ccCharacterConfigBody');
    body.innerHTML = `
      <label>サポカ編成（6枚）</label>
      <div class="support-deck-grid">
        ${[0, 1, 2, 3, 4, 5].map(i => `
          <div class="team-slot">
            <div class="char-select-box" id="ccDeckSlotBox${i}">
              <button type="button" class="char-select-clear-btn" id="ccDeckSlotClearBtn${i}" hidden>×</button>
              <div id="ccDeckSlotEmpty${i}">タップして選択</div>
              <div class="char-select-filled-inner" id="ccDeckSlotFilled${i}" hidden>
                <img class="uma-icon" id="ccDeckSlotIcon${i}" alt="">
                <span id="ccDeckSlotName${i}"></span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <label style="display:block;margin-top:18px;">因子設計図</label>
      <p class="hint">図鑑にいれば所持ウマ娘の適性を自動反映(編集不可)。図鑑に無いキャラは名前を手入力して適性を手動設定できる。</p>
      <div class="pedigree-tree">
        <div class="pedigree-row pedigree-row-self">${pedigreeCardHtml(0, '本人')}</div>
        <div class="pedigree-columns">
          <div class="pedigree-column">
            ${pedigreeCardHtml(1, '親')}
            <div class="pedigree-subrow">${pedigreeCardHtml(3, '祖')}${pedigreeCardHtml(4, '祖')}</div>
          </div>
          <div class="pedigree-column">
            ${pedigreeCardHtml(2, '親')}
            <div class="pedigree-subrow">${pedigreeCardHtml(5, '祖')}${pedigreeCardHtml(6, '祖')}</div>
          </div>
        </div>
      </div>
    `;
    [0, 1, 2, 3, 4, 5].forEach(i => {
      updateDeckSlotBox(i);
      document.getElementById('ccDeckSlotBox' + i).addEventListener('click', () => openSupportPicker(i));
      document.getElementById('ccDeckSlotClearBtn' + i).addEventListener('click', e => {
        e.stopPropagation();
        ccDeckSelections[i] = null;
        updateDeckSlotBox(i);
      });
    });
    [0, 1, 2, 3, 4, 5, 6].forEach(slot => {
      document.getElementById('ccPedigreeBox' + slot).addEventListener('click', () => openUmaPickerForPedigree(slot));
      document.getElementById('ccPedigreeClearBtn' + slot).addEventListener('click', e => {
        e.stopPropagation();
        const keepRedFactor = ccPedigreeSelections[slot] && ccPedigreeSelections[slot].redFactor;
        ccPedigreeSelections[slot] = keepRedFactor ? { ...ccEmptyPedigreeEntry(), redFactor: keepRedFactor } : null;
        updatePedigreeCard(slot);
      });
      updatePedigreeCard(slot);
      if (slot !== 0) {
        const rarityEl = document.getElementById('ccPedigreeRedRarity' + slot);
        rarityEl.querySelectorAll('.star-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const n = Number(btn.dataset.star);
            const current = Number(rarityEl.dataset.value) || 0;
            const newValue = current === n ? 0 : n;
            if (!ccPedigreeSelections[slot]) ccPedigreeSelections[slot] = ccEmptyPedigreeEntry();
            ccPedigreeSelections[slot].redFactor = ccPedigreeSelections[slot].redFactor || {};
            ccPedigreeSelections[slot].redFactor.rarity = newValue;
            rarityEl.dataset.value = newValue;
            rarityEl.querySelectorAll('.star-btn').forEach(b => {
              b.classList.toggle('active', Number(b.dataset.star) <= newValue);
            });
            refreshPedigreeDependents(slot);
          });
        });
        document.getElementById('ccPedigreeRedType' + slot).addEventListener('change', e => {
          if (!ccPedigreeSelections[slot]) ccPedigreeSelections[slot] = ccEmptyPedigreeEntry();
          ccPedigreeSelections[slot].redFactor = ccPedigreeSelections[slot].redFactor || {};
          ccPedigreeSelections[slot].redFactor.type = e.target.value;
          refreshPedigreeDependents(slot);
        });
      }
    });
  }

  function computePairBonus(slotA, slotB) {
    const bonuses = {};
    const add = (type, stars) => {
      if (!type || !stars) return;
      bonuses[type] = Math.min(4, (bonuses[type] || 0) + Math.ceil(stars / 3));
    };
    const rfA = ccPedigreeSelections[slotA] && ccPedigreeSelections[slotA].redFactor;
    const rfB = ccPedigreeSelections[slotB] && ccPedigreeSelections[slotB].redFactor;
    const typeA = rfA && rfA.type;
    const typeB = rfB && rfB.type;
    const starA = (rfA && Number(rfA.rarity)) || 0;
    const starB = (rfB && Number(rfB.rarity)) || 0;
    if (typeA && typeA === typeB) {
      add(typeA, starA + starB);
    } else {
      if (typeA) add(typeA, starA);
      if (typeB) add(typeB, starB);
    }
    return bonuses;
  }
  function mergeBonuses(...bonusObjs) {
    const merged = {};
    bonusObjs.forEach(b => {
      Object.entries(b).forEach(([type, val]) => {
        merged[type] = Math.min(4, (merged[type] || 0) + val);
      });
    });
    return merged;
  }
  function bonusesForPedigreeSlot(slot) {
    if (slot === 0) return mergeBonuses(computePairBonus(1, 2), computePairBonus(3, 4), computePairBonus(5, 6));
    if (slot === 1) return computePairBonus(3, 4);
    if (slot === 2) return computePairBonus(5, 6);
    return {};
  }
  function refreshPedigreeDependents(sourceSlot) {
    renderPedigreeAptArea(0);
    if (sourceSlot === 3 || sourceSlot === 4) renderPedigreeAptArea(1);
    if (sourceSlot === 5 || sourceSlot === 6) renderPedigreeAptArea(2);
  }

  function updatePedigreeCard(slot) {
    const sel = ccPedigreeSelections[slot];
    const hasRegistrySel = !!(sel && !sel.manual);
    const box = document.getElementById('ccPedigreeBox' + slot);
    const emptyEl = document.getElementById('ccPedigreeEmpty' + slot);
    const filledEl = document.getElementById('ccPedigreeFilled' + slot);
    const iconEl = document.getElementById('ccPedigreeIcon' + slot);
    const nameEl = document.getElementById('ccPedigreeName' + slot);
    const clearBtn = document.getElementById('ccPedigreeClearBtn' + slot);
    if (hasRegistrySel) {
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
    renderPedigreeAptArea(slot);
  }

  function renderPedigreeAptArea(slot) {
    const area = document.getElementById('ccPedigreeAptArea' + slot);
    if (!area) return;
    const sel = ccPedigreeSelections[slot];
    const hasRegistrySel = !!(sel && !sel.manual);
    const bonuses = bonusesForPedigreeSlot(slot);

    if (hasRegistrySel) {
      const track = sel.track || {};
      const distance = sel.distance || {};
      const style = sel.style || {};
      area.innerHTML = `
        <div class="apt-row">${ccAptBadgeBoosted('芝', track.turf, bonuses['track.turf'])}${ccAptBadgeBoosted('ダ', track.dirt, bonuses['track.dirt'])}</div>
        <div class="apt-row">${ccAptBadgeBoosted('短', distance.short, bonuses['distance.short'])}${ccAptBadgeBoosted('マ', distance.mile, bonuses['distance.mile'])}${ccAptBadgeBoosted('中', distance.medium, bonuses['distance.medium'])}${ccAptBadgeBoosted('長', distance.long, bonuses['distance.long'])}</div>
        <div class="apt-row">${ccAptBadgeBoosted('逃', style.nige, bonuses['style.nige'])}${ccAptBadgeBoosted('先', style.senko, bonuses['style.senko'])}${ccAptBadgeBoosted('差', style.sashi, bonuses['style.sashi'])}${ccAptBadgeBoosted('追', style.oikomi, bonuses['style.oikomi'])}</div>
      `;
      return;
    }

    const track = (sel && sel.track) || {};
    const distance = (sel && sel.distance) || {};
    const style = (sel && sel.style) || {};
    const bonusEntries = Object.entries(bonuses);
    area.innerHTML = `
      <input type="text" id="ccPedigreeManualName${slot}" placeholder="図鑑に無い場合は名前を手入力" value="${ccEscapeHtml((sel && sel.name) || '')}">
      <div class="apt-select-row">
        <div><span>芝</span>${ccAptSelect('ccPedigreeTurf' + slot, track.turf)}</div>
        <div><span>ダート</span>${ccAptSelect('ccPedigreeDirt' + slot, track.dirt)}</div>
      </div>
      <div class="apt-select-row">
        <div><span>短</span>${ccAptSelect('ccPedigreeShort' + slot, distance.short)}</div>
        <div><span>マ</span>${ccAptSelect('ccPedigreeMile' + slot, distance.mile)}</div>
        <div><span>中</span>${ccAptSelect('ccPedigreeMedium' + slot, distance.medium)}</div>
        <div><span>長</span>${ccAptSelect('ccPedigreeLong' + slot, distance.long)}</div>
      </div>
      <div class="apt-select-row">
        <div><span>逃</span>${ccAptSelect('ccPedigreeNige' + slot, style.nige)}</div>
        <div><span>先</span>${ccAptSelect('ccPedigreeSenko' + slot, style.senko)}</div>
        <div><span>差</span>${ccAptSelect('ccPedigreeSashi' + slot, style.sashi)}</div>
        <div><span>追</span>${ccAptSelect('ccPedigreeOikomi' + slot, style.oikomi)}</div>
      </div>
      ${bonusEntries.length ? `<p class="pedigree-bonus-hint">${slot === 0 ? '親・祖父母' : '祖父母'}の赤因子による自動加算: ${bonusEntries.map(([k, v]) => `${CC_APT_TYPE_LABELS[k] || k}+${v}`).join('、')}</p>` : ''}
    `;
    document.getElementById('ccPedigreeManualName' + slot).addEventListener('input', e => {
      if (!ccPedigreeSelections[slot]) ccPedigreeSelections[slot] = ccEmptyPedigreeEntry();
      ccPedigreeSelections[slot].name = e.target.value.trim();
      ccPedigreeSelections[slot].manual = true;
    });
    [
      ['ccPedigreeTurf' + slot, 'track', 'turf'],
      ['ccPedigreeDirt' + slot, 'track', 'dirt'],
      ['ccPedigreeShort' + slot, 'distance', 'short'],
      ['ccPedigreeMile' + slot, 'distance', 'mile'],
      ['ccPedigreeMedium' + slot, 'distance', 'medium'],
      ['ccPedigreeLong' + slot, 'distance', 'long'],
      ['ccPedigreeNige' + slot, 'style', 'nige'],
      ['ccPedigreeSenko' + slot, 'style', 'senko'],
      ['ccPedigreeSashi' + slot, 'style', 'sashi'],
      ['ccPedigreeOikomi' + slot, 'style', 'oikomi'],
    ].forEach(([id, group, key]) => {
      document.getElementById(id).addEventListener('change', e => {
        if (!ccPedigreeSelections[slot]) ccPedigreeSelections[slot] = ccEmptyPedigreeEntry();
        ccPedigreeSelections[slot].manual = true;
        ccPedigreeSelections[slot][group][key] = e.target.value || null;
      });
    });
  }

  function updateDeckSlotBox(i) {
    const sel = ccDeckSelections[i];
    const box = document.getElementById('ccDeckSlotBox' + i);
    const emptyEl = document.getElementById('ccDeckSlotEmpty' + i);
    const filledEl = document.getElementById('ccDeckSlotFilled' + i);
    const iconEl = document.getElementById('ccDeckSlotIcon' + i);
    const nameEl = document.getElementById('ccDeckSlotName' + i);
    const clearBtn = document.getElementById('ccDeckSlotClearBtn' + i);
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

  // --- サポートカードピッカー ---
  function openSupportPicker(slot) {
    ccDeckPickerSlot = slot;
    document.getElementById('ccSupportCardPickerSearch').value = '';
    renderSupportPickerGrid('');
    document.getElementById('ccCharacterConfigModal').hidden = true;
    document.getElementById('ccSupportCardPickerModal').hidden = false;
  }
  function closeSupportPicker() {
    document.getElementById('ccSupportCardPickerModal').hidden = true;
    document.getElementById('ccCharacterConfigModal').hidden = false;
  }
  function renderSupportPickerGrid(keyword) {
    const grid = document.getElementById('ccSupportCardPickerGrid');
    const kw = keyword.trim().toLowerCase();
    const filtered = kw ? ccSupportCards.filter(c => (c.name || '').toLowerCase().includes(kw)) : ccSupportCards;
    grid.innerHTML = '';
    const fragment = document.createDocumentFragment();
    filtered.forEach(c => {
      const tile = document.createElement('div');
      tile.className = 'character-picker-tile';
      const imageUrl = c.imagePath ? imageRawUrl(c.imagePath) : '';
      tile.innerHTML = `
        ${imageUrl ? `<img src="${ccEscapeHtml(imageUrl)}" alt="${ccEscapeHtml(c.name)}" loading="lazy">` : ''}
        <span>${ccEscapeHtml(c.name)}</span>
      `;
      tile.addEventListener('click', () => selectSupportCard(c));
      fragment.appendChild(tile);
    });
    grid.appendChild(fragment);
    document.getElementById('ccSupportCardPickerStatus').textContent = ccSupportCards.length
      ? (filtered.length ? '' : '該当するサポートカードが見つかりません。')
      : 'サポカ図鑑にまだ登録がありません。';
  }
  function selectSupportCard(c) {
    if (ccDeckPickerSlot == null) return;
    ccDeckSelections[ccDeckPickerSlot] = { id: c.id, name: c.name, imagePath: c.imagePath || null };
    updateDeckSlotBox(ccDeckPickerSlot);
    closeSupportPicker();
  }

  // --- ウマ娘ピッカー(因子設計図の各枠用) ---
  function openUmaPickerForPedigree(slot) {
    ccUmaPickerTargetSlot = slot;
    document.getElementById('ccUmaPickerSearch').value = '';
    renderUmaPickerGrid('');
    document.getElementById('ccCharacterConfigModal').hidden = true;
    document.getElementById('ccUmaPickerModal').hidden = false;
  }
  function closeUmaPicker() {
    document.getElementById('ccUmaPickerModal').hidden = true;
    document.getElementById('ccCharacterConfigModal').hidden = false;
  }
  function renderUmaPickerGrid(keyword) {
    const grid = document.getElementById('ccUmaPickerGrid');
    const kw = keyword.trim().toLowerCase();
    const filtered = kw ? ccUmas.filter(u => (u.name || '').toLowerCase().includes(kw)) : ccUmas;
    grid.innerHTML = '';
    const fragment = document.createDocumentFragment();
    filtered.forEach(u => {
      const tile = document.createElement('div');
      tile.className = 'character-picker-tile';
      const imageUrl = u.imagePath ? imageRawUrl(u.imagePath) : '';
      tile.innerHTML = `
        ${imageUrl ? `<img src="${ccEscapeHtml(imageUrl)}" alt="${ccEscapeHtml(u.name)}" loading="lazy">` : ''}
        <span>${ccEscapeHtml(u.name)}</span>
      `;
      tile.addEventListener('click', () => selectUmaForPedigree(u));
      fragment.appendChild(tile);
    });
    grid.appendChild(fragment);
    document.getElementById('ccUmaPickerStatus').textContent = ccUmas.length
      ? (filtered.length ? '' : '該当するウマ娘が見つかりません。')
      : 'ウマ娘図鑑にまだ登録がありません。';
  }
  function selectUmaForPedigree(u) {
    if (ccUmaPickerTargetSlot == null) return;
    const slot = ccUmaPickerTargetSlot;
    const existingRedFactor = ccPedigreeSelections[slot] && ccPedigreeSelections[slot].redFactor;
    ccPedigreeSelections[slot] = ccPedigreeEntryFromUma(u);
    if (existingRedFactor) ccPedigreeSelections[slot].redFactor = existingRedFactor;
    updatePedigreeCard(slot);
    closeUmaPicker();
  }

  // --- 保存 ---
  async function handleSave() {
    const statusEl = document.getElementById('ccCharacterConfigStatus');
    if (!config || !config.token) {
      statusEl.textContent = '保存にはPATが必要です。設定でPATを入力してください。';
      statusEl.className = 'status error';
      return;
    }
    const plan = ccPlans.find(p => p.id === ccPlanId);
    if (!plan) return;
    const character = (plan.characters || [])[ccCharIndex];
    if (!character) return;
    character.supportDeck = ccDeckSelections.map(sel => sel ? { id: sel.id, name: sel.name } : null);
    character.pedigree = ccPedigreeSelections.map(sel => sel ? {
      id: sel.id || null,
      name: sel.name || '',
      manual: !!sel.manual,
      track: sel.track || {},
      distance: sel.distance || {},
      style: sel.style || {},
      redFactor: sel.redFactor ? { rarity: Number(sel.redFactor.rarity) || 0, type: sel.redFactor.type || '' } : null,
    } : null);
    const updated = ccPlans.map(p => p.id === plan.id ? plan : p);
    statusEl.textContent = '保存しています…';
    statusEl.className = 'status';
    const saveBtn = document.getElementById('ccCharacterConfigSaveBtn');
    saveBtn.disabled = true;
    try {
      await ccSavePlans(updated, ccSha, `育成計画サポカ編成更新: ${character.name}`);
      ccPlans = updated;
      statusEl.textContent = '保存しました。';
      if (ccOnSaved) ccOnSaved(updated);
      window.dispatchEvent(new CustomEvent('training-plans-updated', { detail: { plans: updated } }));
    } catch (err) {
      console.error(err);
      if (err instanceof CcConflictError) {
        statusEl.textContent = '他の端末で更新されています。もう一度開き直してから保存してください。';
      } else {
        statusEl.textContent = '保存中にエラーが発生しました: ' + err.message;
      }
      statusEl.className = 'status error';
    } finally {
      saveBtn.disabled = false;
    }
  }
})();
