/**
 * site.js — 모든 페이지가 쓰는 것들. 아이콘, 대기 건수, 접수처.
 *
 * 검증 도구가 없는 페이지에서도 필요한데 검증 코드까지 내려받게 할 이유는 없어
 * 따로 뒀습니다. 이 파일은 네트워크를 쓰지 않습니다.
 */

import { REVIEW_QUEUE, CONTACT, MAIL, queueLine } from './queue.js';

const icon = (inner) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  frame: icon('<rect x="3" y="5" width="18" height="14"/><path d="M3 16l5-5 4 4 3-3 6 6"/>'),
  layers: icon('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),
  lock: icon('<rect x="4" y="10.5" width="16" height="9.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
  download: icon('<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>'),
  archive: icon('<rect x="3" y="4" width="18" height="4"/><path d="M5 8v12h14V8"/><path d="M10 12h4"/>'),
};

export function paintIcons(scope = document) {
  scope.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.painted) return;
    el.innerHTML = ICONS[el.dataset.icon] || '';
    el.dataset.painted = '1';
  });
}

export function paintShared() {
  paintIcons(document);
  document.querySelectorAll('[data-queue-grade2]').forEach((el) => { el.textContent = queueLine(REVIEW_QUEUE.grade2); });
  document.querySelectorAll('[data-queue-grade1]').forEach((el) => { el.textContent = queueLine(REVIEW_QUEUE.grade1); });
  document.querySelectorAll('[data-queue-archive]').forEach((el) => { el.textContent = `현재 보관 ${REVIEW_QUEUE.archive}건.`; });
  document.querySelectorAll('[data-contact]').forEach((el) => {
    el.textContent = CONTACT;
    if (el.tagName === 'A') el.href = `mailto:${CONTACT}`;
  });
  document.querySelectorAll('[data-mail]').forEach((el) => {
    const make = MAIL[el.dataset.mail];
    if (make && el.tagName === 'A') el.href = make();
  });
}

paintShared();
