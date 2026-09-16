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
  // 조회 비밀번호. 신청자가 정하고, 서버는 소금 섞은 해시만 남깁니다.
  minPassword: 8,
  maxPassword: 72,
  // 사진은 KV 값으로 들어갑니다. KV 값 한도가 25MiB라 그 아래로 잡습니다.
  // R2를 쓰지 않는 이유는 Cloudflare가 R2에 결제수단 등록을 요구하기 때문입니다.
  // 무료 한도 안에서 쓰더라도 카드를 걸어야 합니다. 심사 대기열 정도의 분량은
  // KV로 충분하고, 늘어나면 그때 R2로 옮기면 됩니다.
  maxBytes: 20 * 1024 * 1024,
  maxNote: 2000,
  maxContact: 200,
  // 배분받을 계좌. 정산할 때만 꺼내 쓰고 조회 응답에는 넣지 않습니다.
  maxPayoutHolder: 60,
  maxPayoutBank: 40,
  maxPayoutAccount: 40,
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

/* 화면의 진행 레일(신청 → 심사 중 → 결과 발표)과 같은 말을 씁니다. */
export const STATUS = {
  received: { label: '신청 접수', done: false },
  reviewing: { label: '심사 중', done: false },
  waiting: { label: '추가 자료 대기', done: false },
  done: { label: '결과 발표', done: true },
  rejected: { label: '반려', done: true },
  /* 사람 심사 없이 아카이브에만 등록한 건. 심사를 기다리는 것이 아니라
     이미 끝난 상태이므로 done입니다. */
  archived: { label: '보관 중', done: true },
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
  return env.ULTARI_APPS ? [] : ['ULTARI_APPS (KV)'];
}

/** 사진은 접수 기록과 같은 네임스페이스에 따로 둡니다. */
export const photoKey = (id) => `photo:${id}`;

export const safeText = (value, max) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/* ── 조회 자격 ──────────────────────────────────────── */

const encoder = new TextEncoder();

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array((hex.match(/../g) || []).map((h) => parseInt(h, 16)));

export const sha256Hex = async (text) =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));

/** 길이가 같아도 앞에서 갈리면 빨리 끝나는 비교를 피합니다. */
export function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 조회 비밀번호는 PBKDF2로 늘려 저장합니다. 그냥 SHA-256 한 번이면 사람이 고른
 * 비밀번호는 초당 수억 번 대조할 수 있습니다.
 *
 * 반복 횟수는 요청당 CPU 예산에서 나온 값입니다. workerd에서 30,000회가 7ms로
 * 측정됐고 Workers 무료 플랜의 요청당 CPU는 10ms라, 20,000회(약 5ms)로 잡았습니다.
 * 권장치보다 낮은 대신 최소 길이를 8자로 두고 틀린 시도를 세어 막습니다(fail: 키).
 * 이 비밀번호가 지키는 것은 심사 현황이고, 사진과 연락처는 조회 응답에 들어가지
 * 않습니다.
 *
 * 소금은 연락처에서 결정론적으로 만듭니다. 접수마다 무작위 소금을 쓰면 한 번의
 * 조회에서 접수 수만큼 PBKDF2를 돌려야 하고, 그러면 CPU 예산을 넘습니다.
 * 연락처가 소금이면 한 번 늘린 값을 여러 접수와 싸게 대조할 수 있습니다.
 * 대신 도둑이 특정 메일 주소를 겨냥해 미리 표를 만들 수 있다는 것이 값입니다 —
 * 그 비용은 여전히 PBKDF2가 지배합니다.
 *
 * 반복 횟수를 바꾸면 그 전에 정한 비밀번호는 대조되지 않습니다. 바꾸실 때는
 * 이전 횟수로도 한 번 더 대조하는 코드를 여기에 두십시오.
 */
export const PW_ITERATIONS = 20000;

async function saltFor(contact) {
  const seed = `ultari:pw:${normalizeContact(contact)}`;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(seed)));
}

export async function derivePassword(password, contact, iterations = PW_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: await saltFor(contact), iterations }, key, 256,
  );
  return toHex(new Uint8Array(bits));
}

/** 늘린 값 하나를 여러 접수와 대조합니다. 여기서는 해시만 비교합니다. */
export const samePassword = (hash, record) =>
  Boolean(record?.pwHash)
  && (record.pwIterations || PW_ITERATIONS) === PW_ITERATIONS
  && sameSecret(hash, record.pwHash);

/**
 * 조회는 신청할 때 적은 연락처로 합니다. 대소문자와 공백, 전화번호의
 * 하이픈은 무시합니다 — 적은 그대로 다시 치게 하면 조회가 안 됩니다.
 */
export const normalizeContact = (value) => {
  const flat = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return flat.includes('@') ? flat : flat.replace(/[^0-9+]/g, '');
};

/** 연락처 색인은 해시를 키로 씁니다. 키 목록만 훑어도 메일 주소가 나오면 안 됩니다. */
export const contactIndexKey = async (value) => `by:${await sha256Hex(normalizeContact(value))}`;

/** 틀린 시도 세기. 조회에는 다른 잠금 장치가 없습니다. */
export const failKey = (indexKey) => `fail:${indexKey.slice(3)}`;
export const FAIL_LIMIT = 10;
export const FAIL_WINDOW = 900;   // 초. KV expirationTtl 최소값은 60초입니다.
