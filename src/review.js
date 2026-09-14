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

/**
 * 접수번호와 조회 열쇠를 이 브라우저에 적어 둡니다.
 * 서버는 열쇠의 해시만 갖고 있어서, 잃어버리면 다시 발급해 줄 수 없습니다.
 * 그래서 화면에도 적어 두시라고 권합니다.
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
 * @param {{file:File, grade:number, contact:string, note:string,
 *          summary:string, fingerprint:string, onProgress?:(pct:number)=>void,
 *          signal?:AbortSignal}} opt
 */
export function submitApplication(opt) {
  const body = new FormData();
  body.append('photo', opt.file, opt.file.name || 'photo');
  body.append('grade', String(opt.grade ?? 2));
  body.append('contact', opt.contact ?? '');
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

/** 현황 조회. 접수번호와 조회 열쇠가 둘 다 맞아야 열립니다. */
export async function fetchStatus(id, token) {
  const url = `/api/status?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `조회에 실패했습니다 (HTTP ${res.status}).`);
  return data;
}

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
