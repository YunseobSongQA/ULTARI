/**
 * GET /api/status?id=XXXX-XXXX&token=... — 내 신청 현황.
 *
 * 접수번호와 조회 열쇠가 둘 다 맞아야 열립니다. 접수번호만으로 열리면
 * 번호를 훑어서 남의 신청을 들여다볼 수 있습니다.
 *
 * 연락처와 사진은 돌려주지 않습니다. 조회에 필요한 값이 아닙니다.
 */

import { STATUS, checkEnv, fail, json } from './_shared.js';

const sha256 = async (text) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** 길이가 같아도 앞에서 갈리면 빨리 끝나는 비교를 피합니다. */
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestGet({ request, env }) {
  const missing = checkEnv(env);
  if (missing.length) return fail('서버에 저장소가 연결되지 않았습니다.', 503);

  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim().toUpperCase();
  const token = (url.searchParams.get('token') || '').trim();

  if (!/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(id) || token.length !== 32) {
    return fail('접수번호나 조회 열쇠 형식이 맞지 않습니다.', 400);
  }

  const record = await env.ULTARI_APPS.get(`app:${id}`, 'json');
  // 없는 번호와 틀린 열쇠를 같은 말로 돌려줍니다. 번호의 존재 여부도 정보입니다.
  const wrong = () => fail('접수번호 또는 조회 열쇠가 맞지 않습니다.', 404);
  if (!record) return wrong();
  if (!sameSecret(await sha256(token), record.tokenHash)) return wrong();

  const meta = STATUS[record.status] || STATUS.received;
  return json({
    ok: true,
    id: record.id,
    grade: record.grade,
    status: record.status,
    statusLabel: meta.label,
    finished: meta.done,
    queueAhead: record.queueAhead,
    etaDays: record.etaDays,
    etaDate: record.etaDate,
    fingerprint: record.fingerprint || null,
    result: record.result || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    history: (record.history || []).map((h) => ({ at: h.at, status: h.status, label: (STATUS[h.status] || {}).label || h.status, note: h.note || null })),
  });
}
