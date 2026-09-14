/**
 * POST /api/admin — 심사자가 상태를 옮깁니다.
 *
 * ULTARI_ADMIN_KEY 환경 변수와 맞는 키를 헤더로 보내야 동작합니다.
 * 키가 설정돼 있지 않으면 이 경로는 아예 응답하지 않습니다.
 *
 * 상태를 사람이 바꿀 수 없으면 "현황 조회"는 거짓말이 됩니다.
 * 그래서 조회와 같이 만듭니다.
 */

import { STATUS, checkEnv, fail, json, safeText } from './_shared.js';

export async function onRequestPost({ request, env }) {
  if (!env.ULTARI_ADMIN_KEY) return fail('관리 경로가 설정되지 않았습니다.', 404);
  if (request.headers.get('x-ultari-admin') !== env.ULTARI_ADMIN_KEY) {
    return fail('권한이 없습니다.', 403);
  }
  const missing = checkEnv(env);
  if (missing.length) return fail('서버에 저장소가 연결되지 않았습니다.', 503);

  let body;
  try { body = await request.json(); } catch { return fail('본문을 읽지 못했습니다.'); }

  const id = safeText(body.id, 12).toUpperCase();
  const status = safeText(body.status, 20);
  if (!STATUS[status]) return fail(`status는 ${Object.keys(STATUS).join(', ')} 중 하나여야 합니다.`);

  const record = await env.ULTARI_APPS.get(`app:${id}`, 'json');
  if (!record) return fail('그런 접수번호가 없습니다.', 404);

  const now = new Date().toISOString();
  record.status = status;
  record.updatedAt = now;
  if (body.result !== undefined) record.result = safeText(body.result, 500) || null;
  record.history = [...(record.history || []), { at: now, status, note: safeText(body.note, 300) || null }];

  await env.ULTARI_APPS.put(`app:${id}`, JSON.stringify(record));

  // 끝난 접수는 대기 색인에서 빼야 뒷사람 예상일이 늘어나지 않습니다.
  if (STATUS[status].done) {
    const open = (await env.ULTARI_APPS.get('index:open', 'json')) || [];
    await env.ULTARI_APPS.put('index:open', JSON.stringify(open.filter((x) => x !== id)));
  }

  return json({ ok: true, id, status, updatedAt: now });
}

/** GET은 대기 건수만 알려 줍니다. 사이트가 대기열 숫자를 표시할 때 씁니다. */
export async function onRequestGet({ env }) {
  if (!env.ULTARI_APPS) return json({ ok: true, open: null });
  const open = (await env.ULTARI_APPS.get('index:open', 'json')) || [];
  return json({ ok: true, open: open.length });
}
