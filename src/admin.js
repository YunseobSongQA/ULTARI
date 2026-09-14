/**
 * admin.js — 심사 콘솔.
 *
 * 접수된 상세 검사를 사람이 처리하는 화면입니다. 상태를 옮길 수단이 없으면
 * "현황 조회"는 거짓말이 되고, 사진을 볼 수단이 없으면 심사 자체가 불가능합니다.
 * R2를 쓰지 않아 버킷 브라우저가 없으므로 이 화면이 그 자리를 대신합니다.
 *
 * 열쇠는 sessionStorage에만 둡니다. localStorage에 두면 탭을 닫아도 남아,
 * 공용 컴퓨터에서 다음 사람이 그대로 열 수 있습니다.
 */

import { paintIcons } from './site.js';
import { formatDate } from './review.js';
import { formatBytes } from './verify/fingerprint.js';
import { AWARDABLE, REVIEW_CHECKS, needsSensor, tallyChecks } from './review-criteria.js';

const KEY_STORE = 'ultari.admin.key.v1';

/* 되돌릴 상태의 이름. 서버가 보내 주는 statusLabel과 같은 말을 씁니다. */
const STATUS_LABEL = {
  received: '신청 접수',
  reviewing: '심사 중',
  waiting: '추가 자료 대기',
  done: '결과 발표',
  rejected: '반려',
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const root = document.querySelector('[data-admin]');
if (root) mountConsole(root);

function mountConsole(scope) {
  const gate = scope.querySelector('[data-gate]');
  const gateForm = scope.querySelector('[data-gate-form]');
  const gateMsg = scope.querySelector('[data-gate-msg]');
  const keyInput = scope.querySelector('[data-key]');
  const lockBtn = scope.querySelector('[data-action="lock"]');
  const box = scope.querySelector('[data-console]');
  const list = scope.querySelector('[data-list]');
  const count = scope.querySelector('[data-count]');

  let key = '';
  let items = [];
  let filter = 'open';

  /* 사진은 관리 키를 헤더로 보내야 받을 수 있어서 img src로 걸 수 없습니다.
     한 번 받아 objectURL로 두고 새로 읽을 때도 다시 받지 않습니다. */
  const photos = new Map();
  const names = new Map();
  // 없는 사진을 목록마다 다시 찾지 않습니다. 오래된 접수는 사진이 없을 수 있습니다.
  const missing = new Set();
  const AUTO_LOAD_MAX = 8 * 1024 * 1024;   // 이보다 큰 사진은 눌러서 봅니다

  const say = (text, bad = false) => {
    gateMsg.textContent = text;
    gateMsg.classList.toggle('is-bad', bad);
    gateMsg.hidden = !text;
  };

  const headers = () => ({ 'x-ultari-admin': key });

  /** 열쇠가 틀리면 목록이 열리지 않습니다. 그 자리에서 알려 줍니다. */
  const load = async () => {
    say('읽는 중…');
    try {
      const res = await fetch('/api/admin?list=1', { headers: headers(), cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(res.status === 403 ? '관리 열쇠가 맞지 않습니다.'
          : res.status === 404 ? '이 사이트에 관리 열쇠가 설정돼 있지 않습니다.'
            : data?.error || `읽지 못했습니다 (HTTP ${res.status}).`);
      }
      items = Array.isArray(data.items) ? data.items : [];
      try { sessionStorage.setItem(KEY_STORE, key); } catch { /* 사생활 보호 모드 */ }
      gate.classList.add('is-open');
      lockBtn.hidden = false;
      box.hidden = false;
      say('');
      count.textContent = `진행 중 ${data.open}건 · 전체 ${data.count}건`
        + (data.complete === false ? ' · 목록이 잘렸습니다' : '');
      draw();
    } catch (err) {
      box.hidden = true;
      say(err.message, true);
    }
  };

  const draw = () => {
    const shown = filter === 'open' ? items.filter((i) => !i.finished) : items;
    list.innerHTML = shown.length
      ? shown.map(card).join('')
      : '<p class="adm-empty">해당하는 접수가 없습니다.</p>';
    paintIcons(list);
    fillPhotos();
  };

  const shotFigure = (a, url) => `
    <a class="adm-shot-frame" href="${url}" target="_blank" rel="noopener">
      <img src="${url}" alt="${escapeHtml(a.id)} 접수 사진">
    </a>
    <p class="adm-shot-meta">${escapeHtml(a.file?.name || '이름 없음')}
      <span class="dim">${escapeHtml(formatBytes(a.file?.size) || '')} · ${escapeHtml(a.file?.type || '형식 미상')} · 눌러서 크게</span></p>`;

  const gradeOptions = (a) => {
    const picked = typeof a.awarded === 'number' ? String(a.awarded) : (a.finished ? 'none' : '');
    const opts = [['', '— 아직 정하지 않음'], ...AWARDABLE.map((g) => [String(g), `${g}등급`]), ['none', '등급 없음']];
    return opts.map(([v, label]) =>
      `<option value="${v}"${v === picked ? ' selected' : ''}>${label}</option>`).join('');
  };

  const judgeRow = (check, state) => `
    <li class="judge-row">
      <div class="judge-what">
        <span class="judge-label">${escapeHtml(check.label)}</span>
        <span class="judge-detail">${escapeHtml(check.detail)}</span>
      </div>
      <select data-check="${check.id}" class="judge-pick judge-pick--${state}">
        <option value="unknown"${state === 'unknown' ? ' selected' : ''}>확인 못 함</option>
        <option value="pass"${state === 'pass' ? ' selected' : ''}>확인됨</option>
        <option value="fail"${state === 'fail' ? ' selected' : ''}>어긋남</option>
      </select>
    </li>`;

  const card = (a) => {
    const purged = Boolean(a.file?.purgedAt);
    const checks = a.checks || {};
    const tally = tallyChecks(checks);
    const undo = Array.isArray(a.undo) ? a.undo : [];
    const back = undo.length ? (STATUS_LABEL[undo[undo.length - 1].status] || undo[undo.length - 1].status) : null;
    // 심사에 들어간 건은 판단 칸을 펼쳐 둡니다. 나머지는 접어 둡니다.
    const openJudge = a.status === 'reviewing' || a.status === 'waiting';

    return `
    <article class="panel adm-card${a.finished ? ' adm-card--done' : ''}"
      data-id="${escapeHtml(a.id)}" data-status="${escapeHtml(a.status)}">
      <p class="adm-top">
        <span class="adm-id">${escapeHtml(a.id)}</span>
        <span class="status-tag">${escapeHtml(a.statusLabel)}</span>
        ${typeof a.awarded === 'number'
          ? `<span class="adm-award">${a.awarded}등급 발급</span>`
          : a.finished ? '<span class="dim">등급 없음</span>' : ''}
        <span class="dim">${a.grade}등급 신청</span>
        <span class="dim">신청 ${escapeHtml(formatDate(a.createdAt))}</span>
        <span class="dim">예상 ${escapeHtml(formatDate(a.etaDate))} · 영업일 ${a.etaDays}일</span>
      </p>

      <div class="adm-shot" data-shot>
        ${purged
          ? '<p class="adm-shot-none">사진이 삭제됐습니다 (보관 만료 정리).</p>'
          : photos.has(a.id)
            ? shotFigure(a, photos.get(a.id))
            : missing.has(a.id)
              ? '<p class="adm-shot-none">저장된 사진이 없습니다.</p>'
              : (a.file?.size || 0) > AUTO_LOAD_MAX
                ? `<button class="btn btn--mini btn--ghost" type="button" data-action="photo-show">사진 보기 <span class="dim">${escapeHtml(formatBytes(a.file?.size) || '')}</span></button>`
                : '<p class="adm-shot-none">사진을 불러오는 중…</p>'}
      </div>

      <dl class="receipt-keys">
        <div><dt>연락처</dt><dd>${a.contact
          ? `<a href="mailto:${escapeHtml(a.contact)}">${escapeHtml(a.contact)}</a>`
          : '<span class="dim">삭제됨</span>'}</dd></div>
        <div><dt>파일</dt><dd>${escapeHtml(a.file?.name || '이름 없음')}
          <span class="dim">${escapeHtml(formatBytes(a.file?.size) || '')}${purged ? ' · 삭제됨' : ''}</span></dd></div>
        <div><dt>지문</dt><dd class="mono">${escapeHtml(a.fingerprint || '없음')}</dd></div>
        ${a.note ? `<div><dt>촬영 상황</dt><dd>${escapeHtml(a.note)}</dd></div>` : ''}
      </dl>

      ${a.summary ? `<details class="fold"><summary>간단 검사 측정 요약<span class="hint">신청자가 보낸 값</span></summary>
        <div class="fold-body"><pre class="copybox">${escapeHtml(a.summary)}</pre></div></details>` : ''}

      <details class="fold adm-judge"${openJudge ? ' open' : ''}>
        <summary>심사 판단<span class="hint">기준 ${REVIEW_CHECKS.length}개 · 확인 ${tally.pass} · 어긋남 ${tally.fail}</span></summary>
        <div class="fold-body">
          <ul class="judge-list">
            ${REVIEW_CHECKS.map((c) => judgeRow(c, checks[c.id] || 'unknown')).join('')}
          </ul>

          <div class="apply-grid">
            <label class="fld">
              <span class="fld-label">발급 등급 <em>결과 발표에 쓰입니다</em></span>
              <select data-awarded>${gradeOptions(a)}</select>
            </label>
            <label class="fld">
              <span class="fld-label">이력 메모 <em>신청자에게 보이지 않습니다</em></span>
              <input type="text" data-note maxlength="300" placeholder="무엇을 보고 그렇게 판단했는지">
            </label>
          </div>

          <label class="fld">
            <span class="fld-label">신청자에게 보일 결과문 <em>결과 발표·반려에 필요합니다</em></span>
            <textarea data-result rows="3" maxlength="500"
              placeholder="예: 원본 파일에서 촬영 정보와 픽셀이 서로 맞고, 화면 재촬영 흔적이 없었습니다. 센서 지문은 대조하지 못했습니다."
              >${escapeHtml(a.result || '')}</textarea>
          </label>

          <p class="judge-warn" data-warn hidden></p>

          <div class="btn-row">
            <button class="btn btn--mini" type="button" data-action="finish">심사 완료 · 결과 발표</button>
            <button class="btn btn--mini btn--ghost" type="button" data-action="save">판단만 저장</button>
            <button class="btn btn--mini btn--ghost adm-danger" type="button" data-action="reject">반려</button>
          </div>
        </div>
      </details>

      ${a.history?.length ? `<ul class="status-hist">${a.history.map((h) =>
        `<li><span class="dim">${escapeHtml(formatDate(h.at))}</span> ${escapeHtml(h.label || h.status)}${
          typeof h.awarded === 'number' ? ` · ${h.awarded}등급` : ''}${
          h.note ? ` — ${escapeHtml(h.note)}` : ''}</li>`).join('')}</ul>` : ''}

      <div class="btn-row adm-actions">
        ${purged ? '' : '<button class="btn btn--mini btn--ghost" type="button" data-action="photo"><span data-icon="download"></span>원본 내려받기</button>'}
        ${a.status === 'reviewing' ? '' : '<button class="btn btn--mini btn--ghost" type="button" data-action="move" data-status="reviewing">심사 착수</button>'}
        ${a.status === 'waiting' ? '' : '<button class="btn btn--mini btn--ghost" type="button" data-action="move" data-status="waiting">추가 자료 대기</button>'}
        ${back ? `<button class="btn btn--mini btn--ghost" type="button" data-action="revert">되돌리기 <span class="dim">→ ${escapeHtml(back)}</span></button>` : ''}
        ${purged ? '' : '<button class="btn btn--mini btn--ghost adm-danger" type="button" data-action="purge">보관 만료 정리 <span class="dim">사진·연락처만</span></button>'}
        <button class="btn btn--mini btn--ghost adm-danger" type="button" data-action="delete">접수 삭제 <span class="dim">전부</span></button>
      </div>
      <p class="adm-msg" data-msg hidden></p>
    </article>`;
  };

  /* ── 동작 ───────────────────────────────────────────── */

  const post = async (body) => {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.error || `실패했습니다 (HTTP ${res.status}).`);
    return data;
  };

  const cardMsg = (el, text, bad = false) => {
    const p = el.querySelector('[data-msg]');
    if (!p) return;
    p.textContent = text;
    p.classList.toggle('is-bad', bad);
    p.hidden = !text;
  };

  /** 사진 원본을 받아 둡니다. 미리보기와 내려받기가 같은 것을 씁니다. */
  const grabPhoto = async (id) => {
    if (photos.has(id)) return photos.get(id);
    const res = await fetch(`/api/admin?photo=${encodeURIComponent(id)}`, { headers: headers() });
    if (!res.ok) {
      if (res.status === 404) missing.add(id);
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `받지 못했습니다 (HTTP ${res.status}).`);
    }
    const name = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || `${id}.bin`;
    const url = URL.createObjectURL(await res.blob());
    photos.set(id, url);
    names.set(id, name);
    return url;
  };
  /** 카드에 사진을 박아 넣습니다. 목록을 다시 읽어도 다시 받지 않습니다. */
  const showPhoto = async (cardEl, id) => {
    const box = cardEl.querySelector('[data-shot]');
    if (!box) return;
    const item = items.find((x) => x.id === id);
    try {
      const url = await grabPhoto(id);
      box.innerHTML = shotFigure(item || { id }, url);
    } catch (err) {
      box.innerHTML = missing.has(id)
        ? '<p class="adm-shot-none">저장된 사진이 없습니다.</p>'
        : `<p class="adm-shot-none is-bad">사진을 불러오지 못했습니다 — ${escapeHtml(err.message)}</p>`;
    }
  };

  /** 보이는 카드의 사진을 차례로 받습니다. 큰 파일은 눌러서 봅니다. */
  const fillPhotos = async () => {
    for (const a of items) {
      if (a.file?.purgedAt || photos.has(a.id) || missing.has(a.id)) continue;
      if ((a.file?.size || 0) > AUTO_LOAD_MAX) continue;
      const cardEl = list.querySelector(`.adm-card[data-id="${a.id}"]`);
      if (!cardEl) continue;
      await showPhoto(cardEl, a.id);
    }
  };

  const downloadPhoto = async (el, id) => {
    cardMsg(el, '사진을 받는 중…');
    try {
      const url = await grabPhoto(id);
      const a = document.createElement('a');
      a.href = url;
      a.download = names.get(id) || `${id}.bin`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      cardMsg(el, `${a.download} 으로 저장했습니다.`);
    } catch (err) {
      cardMsg(el, err.message, true);
    }
  };

  /** 카드에 적힌 판단을 모읍니다. "확인 못 함"은 보내지 않습니다. */
  const collect = (el) => {
    const checks = {};
    el.querySelectorAll('[data-check]').forEach((sel) => {
      if (sel.value !== 'unknown') checks[sel.dataset.check] = sel.value;
    });
    const picked = el.querySelector('[data-awarded]')?.value ?? '';
    const body = {
      checks,
      result: el.querySelector('[data-result]')?.value.trim() ?? '',
      note: el.querySelector('[data-note]')?.value.trim() ?? '',
    };
    // 고르지 않았으면 보내지 않습니다. 서버가 기존 값을 지우지 않게 합니다.
    if (picked === 'none') body.awarded = null;
    else if (picked !== '') body.awarded = Number(picked);
    return { body, picked, checks };
  };

  const send = async (el, id, status, extra) => {
    cardMsg(el, '저장하는 중…');
    try {
      await post({ id, status, ...extra });
      cardMsg(el, '');
      await load();
    } catch (err) {
      cardMsg(el, err.message, true);
    }
  };

  /** 상태만 옮기는 버튼도 적어 둔 판단을 함께 저장합니다. 타이핑을 버리지 않습니다. */
  const move = (el, id, status) => send(el, id, status, collect(el).body);

  /** 심사 완료 — 기준, 등급, 결과문, 상태를 한 번에 넘깁니다. */
  const finish = (el, id, kind) => {
    const { body, picked, checks } = collect(el);
    if (!body.result) {
      cardMsg(el, '신청자에게 보일 결과문을 적어 주세요. 결과를 알리는 상태입니다.', true);
      el.querySelector('[data-result]')?.focus();
      return;
    }
    if (kind === 'done' && picked === '') {
      cardMsg(el, '발급 등급을 골라 주세요. "등급 없음"도 고를 수 있습니다.', true);
      el.querySelector('[data-awarded]')?.focus();
      return;
    }
    if (kind === 'done' && needsSensor(body.awarded, checks)
      && !window.confirm('1등급은 센서 지문 대조가 확인돼야 합니다. 그래도 1등급으로 발급합니까?')) {
      return;
    }
    send(el, id, kind, body);
  };

  /** 잘못 누른 것을 되짚습니다. 서버가 바꾸기 전 상태를 쌓아 두고 있습니다. */
  const revert = (el, id) => {
    if (!window.confirm(`${id}를 직전 상태로 되돌립니다.`)) return;
    send(el, id, undefined, { action: 'revert' });
  };

  /** 접수 자체를 지웁니다. 사진·기록·색인 전부. 되돌릴 수 없습니다. */
  const destroy = async (el, id) => {
    if (!window.confirm(`${id} 접수를 완전히 삭제합니다.

사진, 심사 기록, 조회 색인까지 모두 지워지고 신청자도 조회할 수 없게 됩니다. 되돌릴 수 없습니다.`)) return;
    cardMsg(el, '지우는 중…');
    try {
      await post({ id, action: 'delete' });
      const url = photos.get(id);
      if (url) { URL.revokeObjectURL(url); photos.delete(id); }
      await load();
    } catch (err) {
      cardMsg(el, err.message, true);
    }
  };

  const purge = async (el, id) => {
    if (!window.confirm(`${id}의 사진과 연락처를 지웁니다. 접수번호와 심사 기록은 남습니다.

보관 기간(완료 후 90일)이 끝난 건을 정리하는 기능입니다. 되돌릴 수 없습니다.`)) return;
    cardMsg(el, '지우는 중…');
    try {
      await post({ id, action: 'purge' });
      const url = photos.get(id);
      if (url) { URL.revokeObjectURL(url); photos.delete(id); }
      cardMsg(el, '');
      await load();
    } catch (err) {
      cardMsg(el, err.message, true);
    }
  };

  /* 고른 값이 색으로 보이고, 1등급 조건은 누르기 전에 알려 줍니다. */
  scope.addEventListener('change', (e) => {
    const pick = e.target.closest('[data-check]');
    if (pick) {
      pick.className = `judge-pick judge-pick--${pick.value}`;
    }
    const cardEl = e.target.closest('.adm-card');
    if (!cardEl) return;
    const warn = cardEl.querySelector('[data-warn]');
    if (!warn) return;
    const { body, checks } = collect(cardEl);
    const bad = needsSensor(body.awarded, checks);
    warn.textContent = bad
      ? '1등급은 센서 지문 대조가 확인돼야 합니다. 지금은 확인되지 않았습니다.' : '';
    warn.hidden = !bad;
  });

  gateForm.addEventListener('submit', (e) => {
    e.preventDefault();
    key = keyInput.value.trim();
    if (!key) { say('열쇠를 넣어 주세요.', true); return; }
    load();
  });

  scope.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-filter]');
    if (pick) {
      filter = pick.dataset.filter;
      scope.querySelectorAll('[data-filter]').forEach((b) => {
        const on = b.dataset.filter === filter;
        b.classList.toggle('btn--ghost', !on);
        b.setAttribute('aria-pressed', String(on));
      });
      draw();
      return;
    }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;

    if (act === 'lock') {
      e.preventDefault();
      key = '';
      items = [];
      photos.forEach((url) => URL.revokeObjectURL(url));
      photos.clear();
      try { sessionStorage.removeItem(KEY_STORE); } catch { /* 무시 */ }
      keyInput.value = '';
      box.hidden = true;
      lockBtn.hidden = true;
      gate.classList.remove('is-open');
      say('잠갔습니다. 다시 열려면 열쇠를 넣어 주세요.');
      return;
    }
    if (act === 'reload') { e.preventDefault(); load(); return; }

    const cardEl = el.closest('.adm-card');
    if (!cardEl) return;
    const id = cardEl.dataset.id;
    if (act === 'photo') { e.preventDefault(); downloadPhoto(cardEl, id); }
    if (act === 'photo-show') { e.preventDefault(); showPhoto(cardEl, id); }
    if (act === 'delete') { e.preventDefault(); destroy(cardEl, id); }
    if (act === 'move') { e.preventDefault(); move(cardEl, id, el.dataset.status); }
    if (act === 'save') { e.preventDefault(); move(cardEl, id, cardEl.dataset.status); }
    if (act === 'finish') { e.preventDefault(); finish(cardEl, id, 'done'); }
    if (act === 'reject') { e.preventDefault(); finish(cardEl, id, 'rejected'); }
    if (act === 'revert') { e.preventDefault(); revert(cardEl, id); }
    if (act === 'purge') { e.preventDefault(); purge(cardEl, id); }
  });

  // 같은 탭에서 새로고침했을 때 다시 넣지 않아도 되게 합니다.
  try {
    const saved = sessionStorage.getItem(KEY_STORE);
    if (saved) { key = saved; keyInput.value = saved; load(); }
  } catch {
    /* 사생활 보호 모드에서는 읽히지 않습니다. 손으로 넣으면 됩니다. */
  }
}
