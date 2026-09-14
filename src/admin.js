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

const KEY_STORE = 'ultari.admin.key.v1';

const MOVES = [
  { status: 'reviewing', label: '심사 착수' },
  { status: 'waiting', label: '추가 자료 대기' },
  { status: 'done', label: '결과 발표' },
  { status: 'rejected', label: '반려' },
];

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
  };

  const card = (a) => {
    const purged = Boolean(a.file?.purgedAt);
    return `
    <article class="panel adm-card${a.finished ? ' adm-card--done' : ''}" data-id="${escapeHtml(a.id)}">
      <p class="adm-top">
        <span class="adm-id">${escapeHtml(a.id)}</span>
        <span class="status-tag">${escapeHtml(a.statusLabel)}</span>
        <span class="dim">${a.grade}등급 신청</span>
        <span class="dim">신청 ${escapeHtml(formatDate(a.createdAt))}</span>
        <span class="dim">예상 ${escapeHtml(formatDate(a.etaDate))} · 영업일 ${a.etaDays}일</span>
      </p>

      <dl class="receipt-keys">
        <div><dt>연락처</dt><dd>${a.contact
          ? `<a href="mailto:${escapeHtml(a.contact)}">${escapeHtml(a.contact)}</a>`
          : '<span class="dim">삭제됨</span>'}</dd></div>
        <div><dt>파일</dt><dd>${escapeHtml(a.file?.name || '이름 없음')}
          <span class="dim">${escapeHtml(formatBytes(a.file?.size) || '')}${purged ? ' · 삭제됨' : ''}</span></dd></div>
        <div><dt>지문</dt><dd class="mono">${escapeHtml(a.fingerprint || '없음')}</dd></div>
        ${a.note ? `<div><dt>촬영 상황</dt><dd>${escapeHtml(a.note)}</dd></div>` : ''}
        ${a.result ? `<div><dt>발표한 결과</dt><dd>${escapeHtml(a.result)}</dd></div>` : ''}
      </dl>

      ${a.summary ? `<details class="fold"><summary>간단 검사 측정 요약<span class="hint">신청자가 보낸 값</span></summary>
        <div class="fold-body"><pre class="copybox">${escapeHtml(a.summary)}</pre></div></details>` : ''}

      ${a.history?.length ? `<ul class="status-hist">${a.history.map((h) =>
        `<li><span class="dim">${escapeHtml(formatDate(h.at))}</span> ${escapeHtml(h.label || h.status)}${
          h.note ? ` — ${escapeHtml(h.note)}` : ''}</li>`).join('')}</ul>` : ''}

      <label class="fld adm-note">
        <span class="fld-label">이력에 남길 메모 <em>선택</em></span>
        <input type="text" data-note maxlength="300" placeholder="무엇을 보고 그렇게 판단했는지">
      </label>
      <label class="fld adm-note">
        <span class="fld-label">신청자에게 보일 결과문 <em>결과 발표·반려에 쓰입니다</em></span>
        <textarea data-result rows="2" maxlength="500"
          placeholder="예: 3등급으로 확인했습니다. 화면 재촬영 흔적 없음.">${escapeHtml(a.result || '')}</textarea>
      </label>

      <div class="btn-row adm-actions">
        ${purged ? '' : '<button class="btn btn--mini btn--ghost" type="button" data-action="photo"><span data-icon="download"></span>사진 내려받기</button>'}
        ${MOVES.filter((m) => m.status !== a.status).map((m) =>
          `<button class="btn btn--mini${m.status === 'done' ? '' : ' btn--ghost'}" type="button"
            data-action="move" data-status="${m.status}">${m.label}</button>`).join('')}
        ${purged ? '' : '<button class="btn btn--mini btn--ghost adm-danger" type="button" data-action="purge">사진·연락처 삭제</button>'}
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

  /** 사진은 헤더가 필요해서 링크로 걸 수 없습니다. 받아서 저장합니다. */
  const downloadPhoto = async (el, id) => {
    cardMsg(el, '사진을 받는 중…');
    try {
      const res = await fetch(`/api/admin?photo=${encodeURIComponent(id)}`, { headers: headers() });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `받지 못했습니다 (HTTP ${res.status}).`);
      }
      const name = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || `${id}.bin`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      cardMsg(el, `${name} 으로 저장했습니다.`);
    } catch (err) {
      cardMsg(el, err.message, true);
    }
  };

  const move = async (el, id, status) => {
    const result = el.querySelector('[data-result]')?.value.trim() ?? '';
    const note = el.querySelector('[data-note]')?.value.trim() ?? '';
    cardMsg(el, '옮기는 중…');
    try {
      await post({ id, status, note, result });
      cardMsg(el, '');
      await load();
    } catch (err) {
      cardMsg(el, err.message, true);
    }
  };

  const purge = async (el, id) => {
    if (!window.confirm(`${id}의 사진과 연락처를 지웁니다. 되돌릴 수 없습니다.`)) return;
    cardMsg(el, '지우는 중…');
    try {
      await post({ id, action: 'purge' });
      cardMsg(el, '');
      await load();
    } catch (err) {
      cardMsg(el, err.message, true);
    }
  };

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
    if (act === 'move') { e.preventDefault(); move(cardEl, id, el.dataset.status); }
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
