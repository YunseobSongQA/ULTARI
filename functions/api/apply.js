/**
 * POST /api/apply — 상세 검사 접수.
 *
 * 사용자가 "신청" 버튼을 누른 뒤에만 호출됩니다. 간단 검사는 이 경로를
 * 거치지 않습니다.
 *
 * 받는 것: 사진 원본, 연락처, 촬영 상황 설명, 브라우저에서 계산한 측정 요약.
 * 돌려주는 것: 접수번호와 조회 열쇠, 예상 완료일.
 *
 * 조회 열쇠는 여기서 한 번만 내려가고 서버는 해시만 남깁니다. 잃어버리면
 * 다시 발급해 줄 수 없고, 그렇게 만든 이유는 접수번호가 새어도 남의 신청을
 * 열 수 없게 하기 위해서입니다.
 */

import { LIMITS, STATUS, checkEnv, etaFrom, fail, json, newId, newToken, photoKey, safeText } from './_shared.js';
import { scanProvenance } from '../../src/verify/provenance.js';

const sha256 = async (text) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tif',
};

export async function onRequestPost({ request, env }) {
  const missing = checkEnv(env);
  if (missing.length) {
    // 방문자에게는 내부 이름을 보이지 않습니다. 자세한 것은 로그로만 남깁니다.
    console.error('[ultari] 접수 저장소 바인딩 누락:', missing.join(', '));
    return fail('지금은 접수를 받을 수 없습니다. 잠시 뒤에 다시 시도해 주세요.', 503);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return fail('요청을 읽지 못했습니다.');
  }

  const photo = form.get('photo');
  if (!(photo instanceof File) || photo.size === 0) {
    return fail('사진 파일이 없습니다.');
  }
  if (photo.size > LIMITS.maxBytes) {
    return fail(`사진이 ${Math.round(LIMITS.maxBytes / 1024 / 1024)}MB를 넘습니다. 더 작은 파일로 신청해 주세요.`, 413);
  }

  const grade = form.get('grade') === '1' ? 1 : 2;
  const contact = safeText(form.get('contact'), LIMITS.maxContact);
  if (contact.length < 5) {
    return fail('연락받을 메일 주소나 전화번호를 적어 주세요.');
  }
  const note = safeText(form.get('note'), LIMITS.maxNote);
  const summary = safeText(form.get('summary'), LIMITS.maxNote);
  const fingerprint = safeText(form.get('fingerprint'), 80);

  // 파일이 스스로 AI 생성물이라고 밝힌 경우는 여기서 돌려보냅니다.
  // 화면에서도 막지만, 화면만 막으면 요청을 직접 보내는 것으로 지나갑니다.
  let bytes;
  try {
    bytes = new Uint8Array(await photo.arrayBuffer());
  } catch {
    return fail('사진을 읽지 못했습니다.');
  }
  const prov = scanProvenance(bytes);
  if (prov.declaresAi) {
    return json({
      ok: false,
      code: 'declared-ai',
      error: '이 파일은 스스로 AI 생성물이라고 기록하고 있어 상세 검사를 접수하지 않습니다.',
      detail: prov.generator ? `기록된 생성기: ${prov.generator}` : null,
    }, 422);
  }

  const id = newId();
  const token = newToken();
  const tokenHash = await sha256(token);
  const now = new Date();

  // 대기 건수는 아직 끝나지 않은 접수만 셉니다.
  let queueAhead = 0;
  try {
    const open = await env.ULTARI_APPS.get('index:open', 'json');
    queueAhead = Array.isArray(open) ? open.length : 0;
  } catch {
    /* 처음 접수라면 색인이 없습니다. */
  }

  const { days, etaISO } = etaFrom(grade, queueAhead, now.getTime());

  const ext = EXT[photo.type] || 'bin';
  try {
    await env.ULTARI_APPS.put(photoKey(id), bytes, {
      metadata: { type: photo.type || 'application/octet-stream', ext, name: safeText(photo.name, 120) },
    });
  } catch {
    return fail('사진을 저장하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.', 502);
  }

  const record = {
    id,
    tokenHash,
    grade,
    status: 'received',
    contact,
    note,
    summary,
    fingerprint,
    file: {
      key: photoKey(id),
      name: safeText(photo.name, 120),
      type: photo.type || null,
      size: photo.size,
    },
    queueAhead,
    etaDays: days,
    etaDate: etaISO,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    history: [{ at: now.toISOString(), status: 'received', note: '접수됐습니다.' }],
  };

  try {
    await env.ULTARI_APPS.put(`app:${id}`, JSON.stringify(record));
    const open = (await env.ULTARI_APPS.get('index:open', 'json')) || [];
    open.push(id);
    await env.ULTARI_APPS.put('index:open', JSON.stringify(open));
  } catch {
    return fail('접수를 기록하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.', 502);
  }

  return json({
    ok: true,
    id,
    token,
    grade,
    status: 'received',
    statusLabel: STATUS.received.label,
    queueAhead,
    etaDays: days,
    etaDate: etaISO,
    createdAt: record.createdAt,
  });
}

export const onRequestGet = () => fail('이 주소는 접수 전용입니다. 조회는 /api/status를 씁니다.', 405);
