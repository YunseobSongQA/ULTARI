/**
 * review.js — 상세 검사 접수와 현황 조회.
 *
 * ─────────────────────────────────────────────────────────────
 * 이 파일은 ULTARI에서 유일하게 네트워크를 쓰는 코드입니다.
 *
 * 간단 검사는 여전히 브라우저 안에서만 돕니다. 아무것도 보내지 않습니다.
 * 여기가 호출되는 것은 사용자가 상세 검사 신청 버튼을 누른 뒤이고,
 * 그때 사진 원본이 서버로 올라갑니다. 그 사실을 화면에도 적습니다.
 * ─────────────────────────────────────────────────────────────
 */

const LOCAL_KEY = 'ultari.applications.v1';

export const MAX_UPLOAD = 20 * 1024 * 1024;
export const MIN_PASSWORD = 8;

/**
 * 접수번호와 조회 열쇠를 이 브라우저에 적어 둡니다.
 *
 * 열쇠는 화면에 보여 주지 않습니다. 이 브라우저가 비밀번호를 다시 치지 않고
 * 자기 접수를 여는 데만 씁니다. 다른 기기에서는 연락처와 비밀번호로 엽니다.
 * 비밀번호는 여기에 적지 않습니다 — 적어 두면 이 브라우저를 쓰는 다음 사람이
 * 그대로 씁니다.
 */
export function rememberApplication(entry) {
  try {
    const all = listApplications();
    const next = [entry, ...all.filter((a) => a.id !== entry.id)].slice(0, 30);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
  } catch {
    /* 사생활 보호 모드에서는 저장이 막힙니다. 접수 자체는 이미 끝났습니다. */
  }
}

export function listApplications() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const all = raw ? JSON.parse(raw) : [];
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}

export function forgetApplication(id) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(listApplications().filter((a) => a.id !== id)));
  } catch {
    /* 무시 */
  }
}

/**
 * 접수. 업로드 진행률이 필요해서 XMLHttpRequest를 씁니다.
 * fetch는 보내는 쪽 진행률을 알려주지 않습니다.
 *
 * @param {{file:File, grade:number, archive?:boolean, verifiedGrade?:number, contact:string, note:string,
 *          summary:string, fingerprint:string, onProgress?:(pct:number)=>void,
 *          signal?:AbortSignal}} opt
 */
export function submitApplication(opt) {
  const body = new FormData();
  body.append('photo', opt.file, opt.file.name || 'photo');
  body.append('grade', String(opt.grade ?? 2));
  body.append('archive', opt.archive === false ? 'no' : 'yes');
  // 3등급 아카이브 자동 등록은 최종 통과 판정을 받은 화면에서만 보냅니다.
  // 서버도 이 값이 없으면 등록 요청을 받지 않습니다.
  body.append('verifiedGrade', String(opt.verifiedGrade ?? ''));
  body.append('contact', opt.contact ?? '');
  body.append('password', opt.password ?? '');
  body.append('note', opt.note ?? '');
  body.append('summary', opt.summary ?? '');
  body.append('fingerprint', opt.fingerprint ?? '');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/apply');
    xhr.responseType = 'json';

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) opt.onProgress?.((e.loaded / e.total) * 100);
    });
    xhr.upload.addEventListener('load', () => opt.onProgress?.(100));

    xhr.addEventListener('load', () => {
      const data = xhr.response && typeof xhr.response === 'object'
        ? xhr.response
        : safeParse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300 && data?.ok) resolve(data);
      else reject(new Error(data?.error || `접수에 실패했습니다 (HTTP ${xhr.status}).`));
    });
    xhr.addEventListener('error', () => reject(new Error('서버에 닿지 못했습니다. 연결을 확인해 주세요.')));
    xhr.addEventListener('abort', () => reject(new Error('접수를 취소했습니다.')));

    opt.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

const safeParse = (text) => { try { return JSON.parse(text); } catch { return null; } };

/** 비밀은 주소에 담지 않습니다. 주소는 접속 기록에 남습니다. */
async function askStatus(body) {
  const res = await fetch('/api/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `조회에 실패했습니다 (HTTP ${res.status}).`);
  return data;
}

/** 신청할 때 적은 연락처와 정한 비밀번호로 엽니다. 맞는 접수를 모두 돌려줍니다. */
export const fetchStatusByContact = (contact, password) => askStatus({ contact, password });

/** 이 브라우저에 적어 둔 접수를 엽니다. 열쇠는 사용자가 보지 않습니다. */
export const fetchStatus = (id, token) => askStatus({ id, token });

/** 현재 대기 건수. 실패하면 null을 돌려주고 화면은 숫자를 감춥니다. */
export async function fetchQueue() {
  try {
    const res = await fetch('/api/admin', { cache: 'no-store' });
    const data = await res.json();
    return typeof data?.open === 'number' ? data.open : null;
  } catch {
    return null;
  }
}

export const formatDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
};
