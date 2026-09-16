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

/** 큰 자리용. 폭에 맞춰 늘어나도 선 굵기가 유지되게 그립니다. */
const mark = (inner) =>
  `<svg viewBox="0 0 64 42" fill="none" stroke="currentColor" stroke-width="1.7" ` +
  `stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  frame: icon('<rect x="3" y="5" width="18" height="14"/><path d="M3 16l5-5 4 4 3-3 6 6"/>'),
  layers: icon('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),
  lock: icon('<rect x="4" y="10.5" width="16" height="9.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
  download: icon('<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>'),
  archive: icon('<rect x="3" y="4" width="18" height="4"/><path d="M5 8v12h14V8"/><path d="M10 12h4"/>'),
  // 상태 표시용. 색만으로 구분하지 않도록 라벨과 함께 씁니다.
  check: icon('<path d="M4.5 12.5l4.8 4.8L19.5 7"/>'),
  cross: icon('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>'),
  // 매체 표시 — 작은 자리(칩)용
  film: icon('<rect x="3" y="5" width="18" height="14"/><path d="M3 9h4M3 15h4M17 9h4M17 15h4M8 5v14M16 5v14"/>'),
  wave: icon('<path d="M3 12h2M7 7v10M11 4v16M15 8v8M19 11h2"/>'),

  /* 랜딩의 큰 마크.
     작은 아이콘을 그냥 키우면 선이 가늘어 초라해집니다. 큰 자리에는 큰
     자리용으로 따로 그립니다.
     넷 다 ULTARI 마크와 같은 언어입니다 — 가로 띠 하나에 수직 요소가 얹힙니다.
     색은 쓰지 않습니다. 파란색은 이 사이트에서 측정값의 색이고, 장식에 쓰면
     그 뜻이 옅어집니다. */
  markPhoto: mark(
    '<path d="M2 33h60"/>'
    + '<rect x="17" y="9" width="30" height="24"/>'
    + '<circle cx="32" cy="21" r="6.5"/>'
  ),
  markVideo: mark(
    '<path d="M2 33h60"/>'
    + '<rect x="11" y="9" width="42" height="24"/>'
    + '<path d="M11 15h5M11 21h5M11 27h5M48 15h5M48 21h5M48 27h5"/>'
    + '<path d="M21 9v24M43 9v24"/>'
  ),
  markMusic: mark(
    '<path d="M2 33h60"/>'
    + '<path d="M18 33V15M25 33V6M32 33V19M39 33V10M46 33V17"/>'
  ),
  markDeep: mark(
    '<path d="M2 33h60"/>'
    + '<rect x="17" y="9" width="30" height="24"/>'
    + '<path d="M24 21.5l5.5 5.5L41 15.5"/>'
  ),
  // 기록 한 장과 확인 도장. 인증이 남기는 것이 상장이 아니라 기록이라는 뜻입니다.
  markRights: mark(
    '<path d="M2 33h60"/>'
    + '<rect x="13" y="7" width="23" height="26"/>'
    + '<path d="M19 14h11M19 20h11M19 26h6"/>'
    + '<circle cx="48" cy="26" r="7"/>'
    + '<path d="M44.5 26l2.5 2.5L52 23"/>'
  ),
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

/**
 * 모바일에서 상단 메뉴는 줄을 바꾸지 않고 한 줄로 고정돼 옆으로 밀립니다.
 * 지금 보고 있는 페이지가 그 줄 밖에 있으면 어디쯤인지 알 수 없으므로
 * 메뉴 안에서만 끌어다 놓습니다. 페이지의 세로 위치는 건드리지 않습니다.
 */
export function revealCurrentNav() {
  document.querySelectorAll('.site-nav').forEach((nav) => {
    const here = nav.querySelector('[aria-current="page"]');
    if (!here || nav.scrollWidth <= nav.clientWidth + 1) return;
    const navBox = nav.getBoundingClientRect();
    const hereBox = here.getBoundingClientRect();
    // 왼쪽에 붙박인 버튼이 있으면 그 뒤부터가 실제로 보이는 자리입니다.
    const pinned = nav.querySelector('.nav-lookup');
    const leftEdge = navBox.left + (pinned ? pinned.getBoundingClientRect().width + 8 : 0);
    // 이미 보이면 건드리지 않습니다. 필요한 만큼만 밉니다.
    if (hereBox.left < leftEdge) nav.scrollLeft -= leftEdge - hereBox.left;
    else if (hereBox.right > navBox.right) nav.scrollLeft += hereBox.right - navBox.right + 8;
  });
}

/**
 * 상단 메뉴의 가로 드롭박스.
 *
 * 마우스는 대면 열리고 떼면 닫힙니다. 손가락에는 hover가 없으니 눌러서
 * 엽니다. 둘을 한 상태(is-open)로만 관리합니다 — CSS :hover로 열어 두면
 * 눌러서 닫으려 할 때 hover가 그 자리에서 다시 열어 버립니다.
 */
export function mountNav(scope = document) {
  const drops = [...scope.querySelectorAll('[data-nav-drop]')];
  if (!drops.length) return;

  const btn = (drop) => drop.querySelector('[data-nav-toggle]');
  const close = (drop) => {
    drop.classList.remove('is-open');
    btn(drop)?.setAttribute('aria-expanded', 'false');
  };
  const open = (drop) => {
    drops.forEach((d) => { if (d !== drop) close(d); });
    drop.classList.add('is-open');
    btn(drop)?.setAttribute('aria-expanded', 'true');
  };

  drops.forEach((drop) => {
    /* 이름이 바 높이를 그대로 쓰고 칸이 바로 그 아래 붙으므로 둘 사이에
       빈 자리는 없습니다. 그래도 비스듬히 지나가면 한 프레임쯤 둘 다에서
       벗어납니다. 조금 기다렸다 닫고, 그 사이에 다시 들어오면 취소합니다. */
    let shut = 0;
    const later = () => { clearTimeout(shut); shut = setTimeout(() => close(drop), 100); };
    const now = () => { clearTimeout(shut); open(drop); };

    drop.classList.add('is-live');
    btn(drop)?.addEventListener('click', () => {
      clearTimeout(shut);
      if (drop.classList.contains('is-open')) close(drop);
      else open(drop);
    });

    drop.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') now(); });
    drop.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') later(); });

    // 키보드로 들어오면 열고, 칸 밖으로 나가면 닫습니다.
    drop.addEventListener('focusin', now);
    drop.addEventListener('focusout', (e) => {
      if (!drop.contains(e.relatedTarget)) close(drop);
    });

    /* 같은 페이지 안의 자리로 가는 링크(#lookup 같은 것)는 페이지가
       바뀌지 않으므로 칸이 열린 채로 남습니다. 눌렀으면 닫습니다. */
    drop.querySelector('[data-nav-panel]')?.addEventListener('click', (e) => {
      if (e.target.closest('a')) close(drop);
    });
  });

  document.addEventListener('click', (e) => {
    drops.forEach((drop) => { if (!drop.contains(e.target)) close(drop); });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    drops.forEach((drop) => {
      if (!drop.classList.contains('is-open')) return;
      close(drop);
      btn(drop)?.focus();
    });
  });
}

paintShared();
mountNav();
revealCurrentNav();
