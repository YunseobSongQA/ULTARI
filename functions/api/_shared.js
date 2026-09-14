/**
 * _shared.js — 접수 API가 함께 쓰는 것들.
 *
 * 밑줄로 시작하는 파일은 Cloudflare Pages가 경로로 노출하지 않습니다.
 *
 * 이 폴더의 코드는 간단 검사와 무관합니다. 간단 검사는 여전히 브라우저
 * 안에서만 돌고 아무것도 보내지 않습니다. 여기로 오는 것은 사용자가
 * 상세 검사를 직접 신청했을 때뿐입니다.
 */

export const LIMITS = {
  // Pages Functions 요청 본문 한도보다 넉넉히 아래로 잡습니다.
  maxBytes: 20 * 1024 * 1024,
  maxNote: 2000,
  maxContact: 200,
};

/** 접수번호. 사람이 받아 적을 수 있어야 해서 헷갈리는 글자를 뺐습니다. */
const ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomChars(alphabet, length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export const newId = () => `${randomChars(ID_ALPHABET, 4)}-${randomChars(ID_ALPHABET, 4)}`;

/** 조회 열쇠. 접수번호만으로는 남의 신청을 들여다볼 수 없게 합니다. */
export const newToken = () =>
  randomChars('abcdefghijklmnopqrstuvwxyz0123456789', 32);

export const STATUS = {
  received: { label: '접수됨', done: false },
  reviewing: { label: '심사 중', done: false },
  waiting: { label: '추가 자료 대기', done: false },
  done: { label: '심사 완료', done: true },
  rejected: { label: '반려', done: true },
};

/** 심사 소요. 대기 건수에 비례해 늘어납니다. 없는 속도를 약속하지 않습니다. */
export const WORKDAYS = { 2: 4, 1: 15 };

export function etaFrom(grade, queueAhead, startedAt = Date.now()) {
  const base = WORKDAYS[grade] ?? WORKDAYS[2];
  const days = base + Math.floor(queueAhead / 5) * base;
  const eta = new Date(startedAt);
  let left = days;
  while (left > 0) {
    eta.setUTCDate(eta.getUTCDate() + 1);
    const day = eta.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;   // 주말은 세지 않습니다
  }
  return { days, etaISO: eta.toISOString().slice(0, 10) };
}

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

export const fail = (message, status = 400) => json({ ok: false, error: message }, status);

/** 바인딩이 없으면 조용히 죽지 않고 무엇이 빠졌는지 알려 줍니다. */
export function checkEnv(env) {
  const missing = [];
  if (!env.ULTARI_APPS) missing.push('ULTARI_APPS (KV)');
  if (!env.ULTARI_FILES) missing.push('ULTARI_FILES (R2)');
  return missing;
}

export const safeText = (value, max) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
