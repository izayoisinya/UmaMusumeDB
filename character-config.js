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
// キャラ編成のみ、画面サイズが許す範囲(最大CC_CONFIG_MAX_INSTANCES件)で
// 複数キャラ分を同時に開いておける(縮小表示で並べて見比べる用途を想定)。
// キャラごとにモーダル要素と状態(サポカ編成/因子設計図の選択内容)を独立して
// 持たせ、キー(planId:charIndex)で管理する。育成計画詳細・イベント結果詳細は
// これまで通り1つずつのシングルトン。
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
    return `<span class="apt-badge ${rankClass}"><span class="apt-badge-prefix">${prefix}</span><span class="apt-badge-value">${v || '-'}</span></span>`;
  }
  function ccAptSelect(field, value) {
    return `<select data-field="${field}"><option value="">-</option>${CC_APT_RANKS.map(r => `<option value="${r}"${value === r ? ' selected' : ''}>${r}</option>`).join('')}</select>`;
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
    return `<span class="apt-badge ${rankClass}"><span class="apt-badge-prefix">${prefix}</span><span class="apt-badge-value">${boosted || '-'}<small>+${bonus}</small></span></span>`;
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
  // 育成計画詳細・イベント結果詳細はこれまで通り1つずつ(シングルトン)。
  let ccPlans = [];
  let ccSha = null;
  let ccUmas = [];
  let ccPlanDetailId = null;
  let ccPlanDetailReturnModalId = null;
  let ccEvents = [];
  let ccEventDetailId = null;
  let ccEventDetailReturnModalId = null;

  // キャラ編成は複数キャラ分を同時に開けるようにする(最大CC_CONFIG_MAX_INSTANCES件)。
  // planId:charIndexをキーにインスタンスを管理し、それぞれ独立したモーダル要素と
  // 状態(サポカ編成/因子設計図の選択内容・取得データ)を持つ。
  const CC_CONFIG_MAX_INSTANCES = 5;
  const ccConfigInstances = new Map();
  let ccActivePickerCtx = null; // { instance, kind: 'deck'|'pedigree', slot }

  // --- モーダルHTML注入(初回のみ。育成計画詳細/イベント結果詳細/各ピッカーのみ。
  //     キャラ編成はcreateConfigInstance()でキャラごとに動的生成する) ---
  function ensureMarkup() {
    if (document.getElementById('ccPlanDetailModal')) return;
    const overlay = document.getElementById('modalOverlay');
    if (!overlay) return;

    const wrap = document.createElement('div');
    wrap.innerHTML = `
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
      <div class="modal compact-eligible" id="ccPlanDetailModal" data-pos-key="cc-plan-detail" role="dialog" aria-labelledby="ccPlanDetailTitle" hidden>
        <div class="modal-header-row">
          <h2 id="ccPlanDetailTitle">育成計画詳細</h2>
          <div class="modal-header-actions">
            <button type="button" class="modal-icon-btn modal-compact-toggle" id="ccPlanDetailCompactBtn" title="ポップアップを小さくして裏の画面を見る" aria-label="縮小表示切替">⤡</button>
            <button type="button" class="modal-icon-btn" id="ccPlanDetailPinBtn" title="タブに登録" aria-label="タブに登録"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg></button>
            <button type="button" class="modal-icon-btn" id="ccPlanDetailCloseBtn" title="閉じる" aria-label="閉じる">✕</button>
          </div>
        </div>
        <div id="ccPlanDetailBody"></div>
        <div class="status" id="ccPlanDetailStatus"></div>
      </div>
      <div class="modal compact-eligible" id="ccEventDetailModal" data-pos-key="cc-event-detail" role="dialog" aria-labelledby="ccEventDetailTitle" hidden>
        <div class="modal-header-row">
          <h2 id="ccEventDetailTitle">イベント結果詳細</h2>
          <div class="modal-header-actions">
            <button type="button" class="modal-icon-btn modal-compact-toggle" id="ccEventDetailCompactBtn" title="ポップアップを小さくして裏の画面を見る" aria-label="縮小表示切替">⤡</button>
            <button type="button" class="modal-icon-btn" id="ccEventDetailPinBtn" title="タブに登録" aria-label="タブに登録"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg></button>
            <button type="button" class="modal-icon-btn" id="ccEventDetailCloseBtn" title="閉じる" aria-label="閉じる">✕</button>
          </div>
        </div>
        <div id="ccEventDetailBody"></div>
        <div class="status" id="ccEventDetailStatus"></div>
      </div>
    `;
    while (wrap.firstElementChild) overlay.appendChild(wrap.firstElementChild);

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
    document.getElementById('ccPlanDetailCompactBtn').addEventListener('click', () => {
      const modal = document.getElementById('ccPlanDetailModal');
      setModalCompact(!modal.classList.contains('compact'), modal);
    });
    document.getElementById('ccEventDetailCloseBtn').addEventListener('click', closeEventDetailWidget);
    document.getElementById('ccEventDetailPinBtn').addEventListener('click', handleEventDetailPin);
    document.getElementById('ccEventDetailCompactBtn').addEventListener('click', () => {
      const modal = document.getElementById('ccEventDetailModal');
      setModalCompact(!modal.classList.contains('compact'), modal);
    });
  }

  // --- キャラ編成: インスタンス生成(キャラごとに独立したモーダル+状態を持つ) ---
  function createConfigInstance(key) {
    const overlay = document.getElementById('modalOverlay');
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="modal compact-eligible cc-character-config-modal" role="dialog" aria-label="キャラ編成" hidden>
        <div class="modal-header-row">
          <h2 class="cc-config-title">キャラ編成</h2>
          <div class="modal-header-actions">
            <button type="button" class="modal-icon-btn modal-compact-toggle" title="ポップアップを小さくして裏の画面を見る" aria-label="縮小表示切替">⤡</button>
            <button type="button" class="modal-icon-btn config-save-btn" title="この内容を保存" aria-label="この内容を保存">💾</button>
            <button type="button" class="modal-icon-btn cc-config-pin-btn" title="タブに登録" aria-label="タブに登録"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg></button>
            <button type="button" class="modal-icon-btn cc-config-close-btn" title="閉じる" aria-label="閉じる">✕</button>
          </div>
        </div>
        <div class="cc-config-body"></div>
        <div class="status cc-config-status"></div>
      </div>
    `;
    const modalEl = wrap.firstElementChild;
    overlay.appendChild(modalEl);
    modalEl.dataset.posKey = 'characterConfig:' + key;

    const instance = {
      key,
      modalEl,
      bodyEl: modalEl.querySelector('.cc-config-body'),
      statusEl: modalEl.querySelector('.cc-config-status'),
      titleEl: modalEl.querySelector('.cc-config-title'),
      planId: null,
      charIndex: null,
      returnModalId: null,
      onSaved: null,
      plans: [],
      sha: null,
      umas: [],
      supportCards: [],
      deckSelections: [null, null, null, null, null, null],
      pedigreeSelections: new Array(7).fill(null),
    };
    modalEl.querySelector('.cc-config-close-btn').addEventListener('click', () => closeConfigInstance(instance));
    modalEl.querySelector('.config-save-btn').addEventListener('click', () => handleSave(instance));
    modalEl.querySelector('.cc-config-pin-btn').addEventListener('click', () => handlePin(instance));
    modalEl.querySelector('.modal-compact-toggle').addEventListener('click', () => {
      setModalCompact(!modalEl.classList.contains('compact'), modalEl);
    });
    ccConfigInstances.set(key, instance);
    return instance;
  }

  function closeConfigInstance(instance) {
    instance.modalEl.hidden = true;
    ccConfigInstances.delete(instance.key);
    instance.modalEl.remove();
    if (instance.returnModalId && document.getElementById(instance.returnModalId)) {
      document.getElementById(instance.returnModalId).hidden = false;
    } else if (typeof hideOverlayIfNoModalOpen === 'function') {
      hideOverlayIfNoModalOpen();
    }
  }

  function handlePin(instance) {
    const plan = instance.plans.find(p => p.id === instance.planId);
    const character = plan && (plan.characters || [])[instance.charIndex];
    if (!plan || !character || typeof addPinnedTab !== 'function') return;
    addPinnedTab({
      key: `training-char-${plan.id}-${instance.charIndex}`,
      page: 'training.html',
      type: 'characterConfig',
      params: { plan: plan.id, char: instance.charIndex },
      label: `${character.name}の編成`,
    });
  }

  // --- 公開エントリポイント ---
  window.openCharacterConfigWidget = async function (planId, charIndex, options) {
    options = options || {};
    if (!config || !config.owner || !config.repo) {
      alert('先に「⚙ 設定」からGitHub連携(リポジトリ所有者・リポジトリ名)を設定してください。');
      return;
    }
    ensureMarkup();

    const key = planId + ':' + charIndex;
    let instance = ccConfigInstances.get(key);
    if (!instance) {
      if (ccConfigInstances.size >= CC_CONFIG_MAX_INSTANCES) {
        const msg = `キャラ編成は同時に${CC_CONFIG_MAX_INSTANCES}個までしか開けません。どれかを閉じてください。`;
        if (typeof showToast === 'function') showToast(msg); else alert(msg);
        return;
      }
      instance = createConfigInstance(key);
    }
    instance.planId = planId;
    instance.charIndex = charIndex;
    instance.returnModalId = options.returnModalId || null;
    instance.onSaved = typeof options.onSaved === 'function' ? options.onSaved : null;

    instance.statusEl.textContent = '読み込み中…';
    instance.statusEl.className = 'status';
    instance.bodyEl.innerHTML = '';

    if (instance.returnModalId) {
      const returnEl = document.getElementById(instance.returnModalId);
      if (returnEl) returnEl.hidden = true;
    }
    instance.modalEl.hidden = false;
    document.getElementById('modalOverlay').hidden = false;
    if (typeof bringModalToFront === 'function') bringModalToFront(instance.modalEl);
    if (typeof applyDefaultCompactOnOpen === 'function') applyDefaultCompactOnOpen(instance.modalEl, !!options.keepCompactState);

    try {
      const [plansRaw, umas, supports] = await Promise.all([
        ccFetchPlansRaw(),
        ccFetchJson(UMA_PATH),
        ccFetchJson(SUPPORT_PATH),
      ]);
      instance.plans = plansRaw.entries;
      instance.sha = plansRaw.sha;
      instance.umas = umas;
      instance.supportCards = supports;
    } catch (err) {
      console.error(err);
      instance.statusEl.textContent = 'データの読み込みに失敗しました: ' + err.message;
      instance.statusEl.className = 'status error';
      return;
    }

    const plan = instance.plans.find(p => p.id === planId);
    const character = plan && (plan.characters || [])[charIndex];
    if (!plan || !character) {
      instance.statusEl.textContent = '対象の育成計画・キャラが見つかりませんでした。';
      instance.statusEl.className = 'status error';
      return;
    }

    instance.deckSelections = [0, 1, 2, 3, 4, 5].map(i => {
      const d = (character.supportDeck || [])[i];
      if (!d) return null;
      const card = d.id ? instance.supportCards.find(c => c.id === d.id) : instance.supportCards.find(c => c.name === d.name);
      return card
        ? { id: card.id, name: card.name, imagePath: card.imagePath || null }
        : { id: d.id || null, name: d.name, imagePath: null };
    });
    const savedPedigree = character.pedigree || [];
    instance.pedigreeSelections = [0, 1, 2, 3, 4, 5, 6].map(slot => {
      const p = savedPedigree[slot];
      // 保存データにはimagePathを含めていない(図鑑参照時は常に最新の登録内容を
      // 反映させるため)。図鑑登録済み(manual:false)の場合はidから毎回引き直す。
      if (p && !p.manual && p.id) {
        const uma = instance.umas.find(u => u.id === p.id);
        if (uma) return { ...ccPedigreeEntryFromUma(uma), redFactor: p.redFactor || null };
      }
      if (p) return p;
      if (slot === 0) {
        const uma = character.id ? instance.umas.find(u => u.id === character.id) : instance.umas.find(u => u.name === character.name);
        return uma ? ccPedigreeEntryFromUma(uma) : { id: null, name: character.name, imagePath: null, manual: true, track: {}, distance: {}, style: {} };
      }
      return null;
    });

    instance.titleEl.textContent = `${character.name}の編成`;
    renderBody(instance);
    instance.statusEl.textContent = '';
  };

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
    if (typeof bringModalToFront === 'function') bringModalToFront(document.getElementById('ccPlanDetailModal'));
    if (typeof applyDefaultCompactOnOpen === 'function') applyDefaultCompactOnOpen(document.getElementById('ccPlanDetailModal'), !!options.keepCompactState);

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
    } else if (typeof hideOverlayIfNoModalOpen === 'function') {
      hideOverlayIfNoModalOpen();
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
    if (typeof bringModalToFront === 'function') bringModalToFront(document.getElementById('ccEventDetailModal'));
    if (typeof applyDefaultCompactOnOpen === 'function') applyDefaultCompactOnOpen(document.getElementById('ccEventDetailModal'), !!options.keepCompactState);

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
    } else if (typeof hideOverlayIfNoModalOpen === 'function') {
      hideOverlayIfNoModalOpen();
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

  // --- キャラ編成本体描画(インスタンスごと) ---
  function pedigreeCardHtml(instance, slot, label) {
    const sel = instance.pedigreeSelections[slot];
    const redFactor = (sel && sel.redFactor) || {};
    const isWide = slot <= 2;
    const isParent = slot === 1 || slot === 2;
    // 親A(1)・祖a(3)・祖b(4)は同じ色、親B(2)・祖c(5)・祖d(6)は別の色の枠で
    // 囲み、どの祖がどの親に対応するか見た目で分かるようにする。
    const groupClass = [1, 3, 4].includes(slot) ? ' pedigree-group-a' : [2, 5, 6].includes(slot) ? ' pedigree-group-b' : ' pedigree-group-self';
    return `
      <div class="pedigree-card${isWide ? ' pedigree-card-wide' : ''}${isParent ? ' pedigree-card-parent' : ''}${groupClass}" data-slot="${slot}">
        <div class="pedigree-card-label">${label}</div>
        <div class="pedigree-card-main">
          <div class="char-select-box">
            <button type="button" class="char-select-clear-btn" hidden>×</button>
            <div class="char-select-empty-text">タップして図鑑から選択</div>
            <div class="char-select-filled-inner" hidden>
              <img class="uma-icon" alt="">
              <span class="char-select-name"></span>
            </div>
          </div>
          <div class="pedigree-apt-area"></div>
        </div>
        ${slot !== 0 ? `
          <div class="pedigree-red-factor">
            <label>赤因子</label>
            <div class="pedigree-red-factor-row">
              <div class="star-rating" data-value="${Number(redFactor.rarity) || 0}">
                ${[1, 2, 3].map(n => `<button type="button" class="star-btn${n <= (Number(redFactor.rarity) || 0) ? ' active' : ''}" data-star="${n}">★</button>`).join('')}
              </div>
              <select>
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
          </div>
        ` : ''}
      </div>
    `;
  }

  function pedigreeCardEl(instance, slot) {
    return instance.bodyEl.querySelector('.pedigree-tree [data-slot="' + slot + '"]');
  }

  function renderBody(instance) {
    instance.bodyEl.innerHTML = `
      <label class="config-section-title">サポカ編成（6枚）</label>
      <div class="support-deck-grid">
        ${[0, 1, 2, 3, 4, 5].map(i => `
          <div class="team-slot">
            <div class="char-select-box" data-slot="${i}">
              <button type="button" class="char-select-clear-btn" hidden>×</button>
              <div class="char-select-empty-text">タップして選択</div>
              <div class="char-select-filled-inner" hidden>
                <img class="uma-icon" alt="">
                <span class="char-select-name"></span>
              </div>
            </div>
            <div class="team-slot-skills"></div>
          </div>
        `).join('')}
      </div>

      <label class="config-section-title" style="margin-top:18px;">因子設計図</label>
      <div class="pedigree-tree">
        <div class="pedigree-row pedigree-row-self">${pedigreeCardHtml(instance, 0, '本人')}</div>
        <div class="pedigree-columns">
          <div class="pedigree-column">
            ${pedigreeCardHtml(instance, 1, '親')}
            <div class="pedigree-subrow">${pedigreeCardHtml(instance, 3, '祖')}${pedigreeCardHtml(instance, 4, '祖')}</div>
          </div>
          <div class="pedigree-column">
            ${pedigreeCardHtml(instance, 2, '親')}
            <div class="pedigree-subrow">${pedigreeCardHtml(instance, 5, '祖')}${pedigreeCardHtml(instance, 6, '祖')}</div>
          </div>
        </div>
      </div>
    `;
    [0, 1, 2, 3, 4, 5].forEach(i => {
      updateDeckSlotBox(instance, i);
      const box = instance.bodyEl.querySelector('.support-deck-grid [data-slot="' + i + '"]');
      box.addEventListener('click', () => openSupportPicker(instance, i));
      box.querySelector('.char-select-clear-btn').addEventListener('click', e => {
        e.stopPropagation();
        instance.deckSelections[i] = null;
        updateDeckSlotBox(instance, i);
      });
    });
    [0, 1, 2, 3, 4, 5, 6].forEach(slot => {
      const card = pedigreeCardEl(instance, slot);
      card.querySelector('.char-select-box').addEventListener('click', () => openUmaPickerForPedigree(instance, slot));
      card.querySelector('.char-select-clear-btn').addEventListener('click', e => {
        e.stopPropagation();
        const keepRedFactor = instance.pedigreeSelections[slot] && instance.pedigreeSelections[slot].redFactor;
        instance.pedigreeSelections[slot] = keepRedFactor ? { ...ccEmptyPedigreeEntry(), redFactor: keepRedFactor } : null;
        updatePedigreeCard(instance, slot);
      });
      updatePedigreeCard(instance, slot);
      if (slot !== 0) {
        const rarityEl = card.querySelector('.star-rating');
        rarityEl.querySelectorAll('.star-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const n = Number(btn.dataset.star);
            const current = Number(rarityEl.dataset.value) || 0;
            const newValue = current === n ? 0 : n;
            if (!instance.pedigreeSelections[slot]) instance.pedigreeSelections[slot] = ccEmptyPedigreeEntry();
            instance.pedigreeSelections[slot].redFactor = instance.pedigreeSelections[slot].redFactor || {};
            instance.pedigreeSelections[slot].redFactor.rarity = newValue;
            rarityEl.dataset.value = newValue;
            rarityEl.querySelectorAll('.star-btn').forEach(b => {
              b.classList.toggle('active', Number(b.dataset.star) <= newValue);
            });
            refreshPedigreeDependents(instance, slot);
          });
        });
        card.querySelector('.pedigree-red-factor-row select').addEventListener('change', e => {
          if (!instance.pedigreeSelections[slot]) instance.pedigreeSelections[slot] = ccEmptyPedigreeEntry();
          instance.pedigreeSelections[slot].redFactor = instance.pedigreeSelections[slot].redFactor || {};
          instance.pedigreeSelections[slot].redFactor.type = e.target.value;
          refreshPedigreeDependents(instance, slot);
        });
      }
    });
  }

  function computePairBonus(instance, slotA, slotB) {
    const bonuses = {};
    const add = (type, stars) => {
      if (!type || !stars) return;
      bonuses[type] = Math.min(4, (bonuses[type] || 0) + Math.ceil(stars / 3));
    };
    const rfA = instance.pedigreeSelections[slotA] && instance.pedigreeSelections[slotA].redFactor;
    const rfB = instance.pedigreeSelections[slotB] && instance.pedigreeSelections[slotB].redFactor;
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
  function bonusesForPedigreeSlot(instance, slot) {
    if (slot === 0) return mergeBonuses(computePairBonus(instance, 1, 2), computePairBonus(instance, 3, 4), computePairBonus(instance, 5, 6));
    if (slot === 1) return computePairBonus(instance, 3, 4);
    if (slot === 2) return computePairBonus(instance, 5, 6);
    return {};
  }
  function refreshPedigreeDependents(instance, sourceSlot) {
    renderPedigreeAptArea(instance, 0);
    if (sourceSlot === 3 || sourceSlot === 4) renderPedigreeAptArea(instance, 1);
    if (sourceSlot === 5 || sourceSlot === 6) renderPedigreeAptArea(instance, 2);
  }

  function updatePedigreeCard(instance, slot) {
    const sel = instance.pedigreeSelections[slot];
    const hasRegistrySel = !!(sel && !sel.manual);
    const card = pedigreeCardEl(instance, slot);
    const box = card.querySelector('.char-select-box');
    const emptyEl = card.querySelector('.char-select-empty-text');
    const filledEl = card.querySelector('.char-select-filled-inner');
    const iconEl = filledEl.querySelector('.uma-icon');
    const nameEl = filledEl.querySelector('.char-select-name');
    const clearBtn = card.querySelector('.char-select-clear-btn');
    const labelEl = card.querySelector('.pedigree-card-label');
    if (labelEl) labelEl.hidden = hasRegistrySel;
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
    renderPedigreeAptArea(instance, slot);
  }

  function renderPedigreeAptArea(instance, slot) {
    const card = pedigreeCardEl(instance, slot);
    const area = card && card.querySelector('.pedigree-apt-area');
    if (!area) return;
    const sel = instance.pedigreeSelections[slot];
    const hasRegistrySel = !!(sel && !sel.manual);
    const bonuses = bonusesForPedigreeSlot(instance, slot);

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
      <input type="text" class="cc-pedigree-manual-name" placeholder="図鑑に無い場合は名前を手入力" value="${ccEscapeHtml((sel && sel.name) || '')}">
      <div class="apt-select-row">
        <div><span>芝</span>${ccAptSelect('track.turf', track.turf)}</div>
        <div><span>ダート</span>${ccAptSelect('track.dirt', track.dirt)}</div>
      </div>
      <div class="apt-select-row">
        <div><span>短</span>${ccAptSelect('distance.short', distance.short)}</div>
        <div><span>マ</span>${ccAptSelect('distance.mile', distance.mile)}</div>
        <div><span>中</span>${ccAptSelect('distance.medium', distance.medium)}</div>
        <div><span>長</span>${ccAptSelect('distance.long', distance.long)}</div>
      </div>
      <div class="apt-select-row">
        <div><span>逃</span>${ccAptSelect('style.nige', style.nige)}</div>
        <div><span>先</span>${ccAptSelect('style.senko', style.senko)}</div>
        <div><span>差</span>${ccAptSelect('style.sashi', style.sashi)}</div>
        <div><span>追</span>${ccAptSelect('style.oikomi', style.oikomi)}</div>
      </div>
      ${bonusEntries.length ? `<p class="pedigree-bonus-hint">${slot === 0 ? '親・祖父母' : '祖父母'}の赤因子による自動加算: ${bonusEntries.map(([k, v]) => `${CC_APT_TYPE_LABELS[k] || k}+${v}`).join('、')}</p>` : ''}
    `;
    area.querySelector('.cc-pedigree-manual-name').addEventListener('input', e => {
      if (!instance.pedigreeSelections[slot]) instance.pedigreeSelections[slot] = ccEmptyPedigreeEntry();
      instance.pedigreeSelections[slot].name = e.target.value.trim();
      instance.pedigreeSelections[slot].manual = true;
    });
    area.querySelectorAll('select[data-field]').forEach(el => {
      const [group, fieldKey] = el.dataset.field.split('.');
      el.addEventListener('change', e => {
        if (!instance.pedigreeSelections[slot]) instance.pedigreeSelections[slot] = ccEmptyPedigreeEntry();
        instance.pedigreeSelections[slot].manual = true;
        instance.pedigreeSelections[slot][group][fieldKey] = e.target.value || null;
      });
    });
  }

  // --- サポカ編成の各枠に、そのサポカで取得できるスキル(所持・育成イベント)を表示 ---
  function ccNormalizeSkill(s) {
    return typeof s === 'string' ? { name: s, type: 'normal' } : { name: s.name || '', type: s.type || 'normal' };
  }
  function ccSupportCardSkillChipsHtml(instance, sel) {
    if (!sel) return '';
    const card = (instance.supportCards || []).find(c => (sel.id ? c.id === sel.id : c.name === sel.name));
    if (!card) return '';
    const skills = [...(card.skills || []), ...(card.eventSkills || [])].map(ccNormalizeSkill).filter(s => s.name);
    if (!skills.length) return '';
    return skills.map(s => `<span class="chip white skill-chip skill-${s.type}">${ccEscapeHtml(s.name)}</span>`).join('');
  }

  function updateDeckSlotBox(instance, i) {
    const sel = instance.deckSelections[i];
    const box = instance.bodyEl.querySelector('.support-deck-grid [data-slot="' + i + '"]');
    const emptyEl = box.querySelector('.char-select-empty-text');
    const filledEl = box.querySelector('.char-select-filled-inner');
    const iconEl = filledEl.querySelector('.uma-icon');
    const nameEl = filledEl.querySelector('.char-select-name');
    const clearBtn = box.querySelector('.char-select-clear-btn');
    const skillsEl = box.parentElement.querySelector('.team-slot-skills');
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
    skillsEl.innerHTML = ccSupportCardSkillChipsHtml(instance, sel);
  }

  // --- サポートカードピッカー(共有。どのインスタンスから開いたかはccActivePickerCtxで追跡) ---
  function openSupportPicker(instance, slot) {
    ccActivePickerCtx = { instance, kind: 'deck', slot };
    document.getElementById('ccSupportCardPickerSearch').value = '';
    renderSupportPickerGrid('');
    instance.modalEl.hidden = true;
    document.getElementById('ccSupportCardPickerModal').hidden = false;
  }
  function closeSupportPicker() {
    document.getElementById('ccSupportCardPickerModal').hidden = true;
    if (ccActivePickerCtx && ccActivePickerCtx.instance) ccActivePickerCtx.instance.modalEl.hidden = false;
  }
  function renderSupportPickerGrid(keyword) {
    const grid = document.getElementById('ccSupportCardPickerGrid');
    const cards = (ccActivePickerCtx && ccActivePickerCtx.instance && ccActivePickerCtx.instance.supportCards) || [];
    const kw = keyword.trim().toLowerCase();
    const filtered = kw ? cards.filter(c => (c.name || '').toLowerCase().includes(kw)) : cards;
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
    document.getElementById('ccSupportCardPickerStatus').textContent = cards.length
      ? (filtered.length ? '' : '該当するサポートカードが見つかりません。')
      : 'サポカ図鑑にまだ登録がありません。';
  }
  function selectSupportCard(c) {
    if (!ccActivePickerCtx || ccActivePickerCtx.kind !== 'deck') return;
    const { instance, slot } = ccActivePickerCtx;
    instance.deckSelections[slot] = { id: c.id, name: c.name, imagePath: c.imagePath || null };
    updateDeckSlotBox(instance, slot);
    closeSupportPicker();
  }

  // --- ウマ娘ピッカー(因子設計図の各枠用。共有) ---
  function openUmaPickerForPedigree(instance, slot) {
    ccActivePickerCtx = { instance, kind: 'pedigree', slot };
    document.getElementById('ccUmaPickerSearch').value = '';
    renderUmaPickerGrid('');
    instance.modalEl.hidden = true;
    document.getElementById('ccUmaPickerModal').hidden = false;
  }
  function closeUmaPicker() {
    document.getElementById('ccUmaPickerModal').hidden = true;
    if (ccActivePickerCtx && ccActivePickerCtx.instance) ccActivePickerCtx.instance.modalEl.hidden = false;
  }
  function renderUmaPickerGrid(keyword) {
    const grid = document.getElementById('ccUmaPickerGrid');
    const umas = (ccActivePickerCtx && ccActivePickerCtx.instance && ccActivePickerCtx.instance.umas) || [];
    const kw = keyword.trim().toLowerCase();
    const filtered = kw ? umas.filter(u => (u.name || '').toLowerCase().includes(kw)) : umas;
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
    document.getElementById('ccUmaPickerStatus').textContent = umas.length
      ? (filtered.length ? '' : '該当するウマ娘が見つかりません。')
      : 'ウマ娘図鑑にまだ登録がありません。';
  }
  function selectUmaForPedigree(u) {
    if (!ccActivePickerCtx || ccActivePickerCtx.kind !== 'pedigree') return;
    const { instance, slot } = ccActivePickerCtx;
    const existingRedFactor = instance.pedigreeSelections[slot] && instance.pedigreeSelections[slot].redFactor;
    instance.pedigreeSelections[slot] = ccPedigreeEntryFromUma(u);
    if (existingRedFactor) instance.pedigreeSelections[slot].redFactor = existingRedFactor;
    updatePedigreeCard(instance, slot);
    closeUmaPicker();
  }

  // --- 保存 ---
  async function handleSave(instance) {
    const statusEl = instance.statusEl;
    if (!config || !config.token) {
      statusEl.textContent = '保存にはPATが必要です。設定でPATを入力してください。';
      statusEl.className = 'status error';
      return;
    }
    const plan = instance.plans.find(p => p.id === instance.planId);
    if (!plan) return;
    const character = (plan.characters || [])[instance.charIndex];
    if (!character) return;
    character.supportDeck = instance.deckSelections.map(sel => sel ? { id: sel.id, name: sel.name } : null);
    character.pedigree = instance.pedigreeSelections.map(sel => sel ? {
      id: sel.id || null,
      name: sel.name || '',
      manual: !!sel.manual,
      track: sel.track || {},
      distance: sel.distance || {},
      style: sel.style || {},
      redFactor: sel.redFactor ? { rarity: Number(sel.redFactor.rarity) || 0, type: sel.redFactor.type || '' } : null,
    } : null);
    const updated = instance.plans.map(p => p.id === plan.id ? plan : p);
    statusEl.textContent = '保存しています…';
    statusEl.className = 'status';
    const saveBtn = instance.modalEl.querySelector('.config-save-btn');
    saveBtn.disabled = true;
    try {
      await ccSavePlans(updated, instance.sha, `育成計画サポカ編成更新: ${character.name}`);
      instance.plans = updated;
      statusEl.textContent = '保存しました。';
      if (typeof showToast === 'function') showToast('保存しました');
      if (instance.onSaved) instance.onSaved(updated);
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

  // --- 縮小表示ポップアップを開いたまま別ページへ遷移した時の復元用 ---
  // 現在このモジュール経由で実際に開いている(hiddenでない)ポップアップに
  // 対応するピン留めタブのキーを列挙する。common.jsがページ離脱直前に
  // これを呼び出し、次にページを開いた時の自動復元に使う。
  window.ccGetOpenPinnedTabKeys = function () {
    const keys = [];
    ccConfigInstances.forEach(instance => {
      if (!instance.modalEl.hidden && instance.planId != null && instance.charIndex != null) {
        keys.push(`training-char-${instance.planId}-${instance.charIndex}`);
      }
    });
    const planModal = document.getElementById('ccPlanDetailModal');
    if (planModal && !planModal.hidden && ccPlanDetailId) {
      keys.push(`training-plan-${ccPlanDetailId}`);
    }
    const eventModal = document.getElementById('ccEventDetailModal');
    if (eventModal && !eventModal.hidden && ccEventDetailId) {
      keys.push(`pvp-event-${ccEventDetailId}`);
    }
    return keys;
  };
})();
