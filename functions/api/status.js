/**
 * POST /api/status — 내 신청 현황.
 *
 * 두 가지로 엽니다.
 *   { contact, password }  신청할 때 적은 연락처와 정한 비밀번호. 사람이 쓰는 길입니다.
 *                          같은 연락처로 여러 건 신청했으면 맞는 것을 모두 돌려줍니다.
 *   { id, token }          신청한 브라우저가 자기 접수를 열 때. 열쇠는 화면에 보이지
 *                          않고 그 브라우저에만 적혀 있습니다.
 *
 * 비밀도 GET 쿼리로 보내지 않습니다. 주소는 기록에 남습니다.
 *
 * 연락처와 사진은 돌려주지 않습니다. 조회에 필요한 값이 아니고, 비밀번호가
 * 새더라도 사진까지 새지 않게 하려는 것입니다.
 */

import {
  FAIL_LIMIT, FAIL_WINDOW, LIMITS, STATUS, checkEnv, contactIndexKey, derivePassword,
  fail, failKey, json, samePassword, sameSecret, sha256Hex,
} from './_shared.js';

const ID_SHAPE = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;
const MAX_RECORDS = 20;

/** 신청자에게 보일 것만 골라 냅니다. 해시와 연락처는 여기서 떨어집니다. */
const view = (record) => {
  const meta = STATUS[record.status] || STATUS.received;
  return {
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
    history: (record.history || []).map((h) => ({
      at: h.at,
      status: h.status,
      label: (STATUS[h.status] || {}).label || h.status,
      note: h.note || null,
    })),
  };
};

export async function onRequestPost({ request, env }) {
  const missing = checkEnv(env);
  if (missing.length) return fail('지금은 조회할 수 없습니다. 잠시 뒤에 다시 시도해 주세요.', 503);

  let body;
  try { body = await request.json(); } catch { return fail('요청을 읽지 못했습니다.'); }

  /* 1. 접수번호 + 조회 열쇠 — 신청한 브라우저가 씁니다. */
  if (body.token) {
    const id = String(body.id || '').trim().toUpperCase();
    const token = String(body.token).trim();
    if (!ID_SHAPE.test(id) || token.length !== 32) {
      return fail('접수번호나 조회 열쇠 형식이 맞지 않습니다.', 400);
    }
    const record = await env.ULTARI_APPS.get(`app:${id}`, 'json');
    // 없는 번호와 틀린 열쇠를 같은 말로 돌려줍니다. 번호의 존재 여부도 정보입니다.
    if (!record || !sameSecret(await sha256Hex(token), record.tokenHash)) {
      return fail('접수번호 또는 조회 열쇠가 맞지 않습니다.', 404);
    }
    return json({ ok: true, ...view(record), items: [view(record)] });
  }

  /* 2. 연락처 + 비밀번호 */
  const contact = String(body.contact || '').trim();
  const password = String(body.password || '');
  if (contact.length < 5 || password.length < LIMITS.minPassword) {
    return fail('신청하실 때 적으신 연락처와 비밀번호를 넣어 주세요.', 400);
  }
  if (password.length > LIMITS.maxPassword) return fail('비밀번호가 너무 깁니다.', 400);

  const indexKey = await contactIndexKey(contact);
  const fkey = failKey(indexKey);

  /* 틀린 시도를 세어 막습니다. 연락처는 남이 알 수 있는 값이라,
     비밀번호만으로 버티게 두면 계속 찔러 볼 수 있습니다. */
  const fails = (await env.ULTARI_APPS.get(fkey, 'json')) || { n: 0 };
  if (fails.n >= FAIL_LIMIT) {
    return fail(`틀린 시도가 많아 잠시 막았습니다. ${Math.round(FAIL_WINDOW / 60)}분 뒤에 다시 시도해 주세요.`, 429);
  }

  const wrong = async () => {
    await env.ULTARI_APPS.put(
      fkey, JSON.stringify({ n: fails.n + 1 }), { expirationTtl: FAIL_WINDOW },
    );
    return fail('연락처 또는 비밀번호가 맞지 않습니다.', 404);
  };

  const ids = (await env.ULTARI_APPS.get(indexKey, 'json')) || [];
  if (!ids.length) return wrong();

  /* PBKDF2는 요청당 한 번만 돕니다. 소금이 연락처에서 나오므로, 늘린 값 하나를
     이 연락처의 모든 접수와 대조할 수 있습니다. 비밀번호는 접수별로 다를 수
     있으니 맞는 것만 모읍니다. */
  const hash = await derivePassword(password, contact);
  const items = [];
  for (const id of ids.slice(-MAX_RECORDS).reverse()) {
    const record = await env.ULTARI_APPS.get(`app:${id}`, 'json');
    if (record && samePassword(hash, record)) items.push(view(record));
  }
  if (!items.length) return wrong();

  await env.ULTARI_APPS.delete(fkey);
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return json({ ok: true, ...items[0], items });
}

export const onRequestGet = () =>
  fail('조회는 POST로 보내 주세요. 비밀은 주소에 담지 않습니다.', 405);
