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

/**
 * 시험 운영 띠.
 *
 * 이 사이트는 아직 시험 삼아 돌리는 것입니다. 등급도 아카이브도 실제로
 * 발급하고 등록하지만 수익 배분은 아직 없습니다. 그 사실을 첫 화면에서
 * 말하지 않으면 다 쓰고 난 뒤에 알게 됩니다.
 *
 * 모든 페이지가 site.js를 부르므로 여기 한 곳에서 붙입니다. 페이지마다
 * 적어 두면 한 장은 반드시 빠집니다.
 *
 * 화면 위가 아니라 아래에 고정합니다. 랜딩의 상단 바는 position: fixed이고
 * 화면들이 100svh에 맞춰 붙어 있어서, 위에 띠를 끼우면 그 높이만큼 전부
 * 어긋납니다.
 *
 * 닫을 수 있습니다. 한 번 읽은 사람에게 계속 같은 줄을 보이면 그 줄이
 * 아니라 화면이 가려집니다. 닫은 것은 이 브라우저에만 적어 둡니다 —
 * 서버로 가지 않고, 다른 기기에서는 다시 보입니다.
 */
const TRIAL_KEY = 'ultari.trial.hidden';

/** 띠 높이를 --trial-h로 알려 줍니다. 아래에 있는 것들이 그만큼 비켜섭니다. */
function measureTrialBar(bar) {
  const h = bar && !bar.hidden ? Math.round(bar.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--trial-h', `${h}px`);
}

function paintTrialBar() {
  if (document.querySelector('[data-trial-bar]')) return;

  // 저장소는 사생활 보호 창에서 던질 수 있습니다. 못 읽으면 그냥 보여 줍니다.
  let hidden = false;
  try { hidden = localStorage.getItem(TRIAL_KEY) === '1'; } catch { /* 보여 줍니다 */ }

  const bar = document.createElement('div');
  bar.className = 'trial-bar';
  bar.setAttribute('data-trial-bar', '');
  bar.hidden = hidden;
  bar.innerHTML = `
    <div class="shell trial-inner">
      <span class="trial-tag">시험 운영</span>
      <p class="trial-line">
        테스트용으로 열어 둔 서비스입니다. 검사와 등급은 진짜로 돌아가지만
        <b>수익 배분은 아직 없습니다.</b> <a href="/roadmap">언제 되나</a>
      </p>
      <button class="trial-x" type="button" aria-label="이 안내 닫기" data-trial-close>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>`;

  bar.querySelector('[data-trial-close]').addEventListener('click', () => {
    bar.hidden = true;
    measureTrialBar(bar);
    try { localStorage.setItem(TRIAL_KEY, '1'); } catch { /* 이번만 닫힙니다 */ }
  });

  document.body.appendChild(bar);
  measureTrialBar(bar);
  // 글이 줄바꿈되면 높이가 달라집니다. 창을 줄일 때마다 다시 잽니다.
  if (window.ResizeObserver) new ResizeObserver(() => measureTrialBar(bar)).observe(bar);
}

paintTrialBar();
paintShared();
mountNav();
revealCurrentNav();
