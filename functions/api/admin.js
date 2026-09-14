/**
 * POST /api/admin — 심사자가 상태를 옮깁니다.
 *
 * ULTARI_ADMIN_KEY 환경 변수와 맞는 키를 헤더로 보내야 동작합니다.
 * 키가 설정돼 있지 않으면 이 경로는 아예 응답하지 않습니다.
 *
 * 상태를 사람이 바꿀 수 없으면 "현황 조회"는 거짓말이 됩니다.
 * 그래서 조회와 같이 만듭니다.
 */

import { STATUS, checkEnv, fail, json, photoKey, safeText } from './_shared.js';
import { sanitizeChecks, sanitizeGrade } from '../../src/review-criteria.js';

/** 되돌리기용 snapshot. 바꾸기 전 상태를 쌓아 두고 하나씩 되짚습니다. */
const snapshot = (r) => ({
  status: r.status,
  awarded: r.awarded ?? null,
  checks: r.checks || {},
  result: r.result || null,
});

/**
 * 대기 색인 맞추기. 끝난 건은 빼야 뒷사람 예상일이 늘어나지 않고,
 * 되돌려 다시 열린 건은 넣어야 예상일이 맞습니다.
 */
async function syncOpenIndex(env, id, done) {
  const open = (await env.ULTARI_APPS.get('index:open', 'json')) || [];
  const has = open.includes(id);
  if (done && has) {
    await env.ULTARI_APPS.put('index:open', JSON.stringify(open.filter((x) => x !== id)));
  } else if (!done && !has) {
    await env.ULTARI_APPS.put('index:open', JSON.stringify([...open, id]));
  }
}

export async function onRequestPost({ request, env }) {
  const denied = denyAdmin(request, env);
  if (denied) return denied;
  const missing = checkEnv(env);
  if (missing.length) return fail('지금은 조회할 수 없습니다. 잠시 뒤에 다시 시도해 주세요.', 503);

  let body;
  try { body = await request.json(); } catch { return fail('본문을 읽지 못했습니다.'); }

  const id = safeText(body.id, 12).toUpperCase();
  const record = await env.ULTARI_APPS.get(`app:${id}`, 'json');
  if (!record) return fail('그런 접수번호가 없습니다.', 404);

  /* 보관 기간이 끝난 접수는 사진부터 지웁니다. /privacy에 완료 후 90일로 적어
     두었으므로, 지울 수단이 없으면 그 문장이 거짓이 됩니다. */
  if (body.action === 'purge') {
    await env.ULTARI_APPS.delete(photoKey(id));
    const now = new Date().toISOString();
    record.file = { ...(record.file || {}), purgedAt: now };
    record.contact = '';
    record.note = '';
    record.updatedAt = now;
    record.history = [...(record.history || []), { at: now, status: record.status, note: '사진과 연락처를 삭제했습니다.' }];
    await env.ULTARI_APPS.put(`app:${id}`, JSON.stringify(record));
    return json({ ok: true, id, purged: true, updatedAt: now });
  }

  /* 되돌리기. 심사는 사람이 하는 일이라 잘못 누를 수 있습니다. */
  if (body.action === 'revert') {
    const stack = Array.isArray(record.undo) ? [...record.undo] : [];
    if (!stack.length) return fail('되돌릴 이전 상태가 없습니다.', 409);

    const prev = stack.pop();
    const now = new Date().toISOString();
    record.undo = stack;
    record.status = prev.status;
    record.awarded = prev.awarded ?? null;
    record.checks = prev.checks || {};
    record.result = prev.result || null;
    record.updatedAt = now;
    record.history = [...(record.history || []), {
      at: now, status: record.status, note: '이전 상태로 되돌렸습니다.', revert: true,
    }];

    await env.ULTARI_APPS.put(`app:${id}`, JSON.stringify(record));
    await syncOpenIndex(env, id, Boolean((STATUS[record.status] || {}).done));

    return json({ ok: true, id, status: record.status, reverted: true, updatedAt: now });
  }

  const status = safeText(body.status, 20);
  if (!STATUS[status]) return fail(`status는 ${Object.keys(STATUS).join(', ')} 중 하나여야 합니다.`);

  /* 결과를 알리는 상태에서는 신청자가 읽을 문장이 있어야 합니다.
     등급만 바뀌고 아무 설명이 없으면 신청자는 이유를 알 수 없습니다. */
  const result = body.result !== undefined ? safeText(body.result, 500) : (record.result || '');
  if (STATUS[status].done && !result) {
    return fail('신청자에게 보일 결과문을 적어 주세요. 결과를 알리는 상태입니다.');
  }

  const now = new Date().toISOString();
  record.undo = [...(Array.isArray(record.undo) ? record.undo : []), snapshot(record)].slice(-20);
  record.status = status;
  record.updatedAt = now;
  if (body.result !== undefined) record.result = result || null;
  if (body.awarded !== undefined) record.awarded = sanitizeGrade(body.awarded);
  if (body.checks !== undefined) record.checks = sanitizeChecks(body.checks);
  record.history = [...(record.history || []), {
    at: now,
    status,
    note: safeText(body.note, 300) || null,
    awarded: record.awarded ?? null,
  }];

  await env.ULTARI_APPS.put(`app:${id}`, JSON.stringify(record));
  await syncOpenIndex(env, id, Boolean(STATUS[status].done));

  return json({ ok: true, id, status, awarded: record.awarded ?? null, updatedAt: now });
}

/** 관리 키 확인. 키가 없으면 이 경로는 존재하지 않는 것처럼 답합니다. */
function denyAdmin(request, env) {
  if (!env.ULTARI_ADMIN_KEY) return fail('관리 경로가 설정되지 않았습니다.', 404);
  if (request.headers.get('x-ultari-admin') !== env.ULTARI_ADMIN_KEY) return fail('권한이 없습니다.', 403);
  return null;
}

/**
 * GET은 세 가지입니다.
 *   ?list=1     심사자가 접수 목록을 봅니다. 관리 키가 필요합니다.
 *   ?photo=ID   심사자가 사진을 내려받습니다. 관리 키가 필요합니다.
 *               R2를 쓰지 않으므로 버킷 브라우저가 없고, 이 경로가 그 역할을 합니다.
 *   (인자 없음)  대기 건수만. 공개입니다. 사이트가 예상 소요를 계산할 때 씁니다.
 */
export async function onRequestGet({ request, env }) {
  if (!env.ULTARI_APPS) return json({ ok: true, open: null });

  const url = new URL(request.url);
  const wanted = url.searchParams.get('photo');

  /* 목록. index:open은 끝난 건을 빼기 때문에 색인이 아니라 키를 훑습니다.
     조회 열쇠의 해시는 돌려주지 않습니다 — 심사에 필요한 값이 아닙니다. */
  if (url.searchParams.has('list')) {
    const denied = denyAdmin(request, env);
    if (denied) return denied;

    const listed = await env.ULTARI_APPS.list({ prefix: 'app:' });
    const items = [];
    for (const key of listed.keys) {
      const record = await env.ULTARI_APPS.get(key.name, 'json');
      if (!record) continue;
      const meta = STATUS[record.status] || STATUS.received;
      // 조회 자격에 쓰이는 값은 심사에 필요하지 않습니다. 목록에서 뺍니다.
      const { tokenHash, pwHash, pwSalt, pwIterations, ...rest } = record;
      items.push({
        ...rest,
        statusLabel: meta.label,
        finished: meta.done,
        history: (record.history || []).map((h) => ({
          ...h, label: (STATUS[h.status] || {}).label || h.status,
        })),
      });
    }
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return json({
      ok: true,
      count: items.length,
      open: items.filter((i) => !i.finished).length,
      complete: listed.list_complete !== false,
      items,
    });
  }

  if (wanted) {
    const denied = denyAdmin(request, env);
    if (denied) return denied;
    const id = safeText(wanted, 12).toUpperCase();
    const got = await env.ULTARI_APPS.getWithMetadata(photoKey(id), { type: 'arrayBuffer' });
    if (!got || !got.value) return fail('그 접수의 사진이 없습니다. 이미 지워졌을 수 있습니다.', 404);
    const meta = got.metadata || {};
    return new Response(got.value, {
      headers: {
        'content-type': meta.type || 'application/octet-stream',
        'content-disposition': `attachment; filename="${id}.${meta.ext || 'bin'}"`,
        'cache-control': 'no-store',
      },
    });
  }

  const open = (await env.ULTARI_APPS.get('index:open', 'json')) || [];
  return json({ ok: true, open: open.length });
}
