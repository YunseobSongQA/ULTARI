/**
 * POST /api/apply — 상세 검사 접수.
 *
 * 사용자가 "신청" 버튼을 누른 뒤에만 호출됩니다. 간단 검사는 이 경로를
 * 거치지 않습니다.
 *
 * 받는 것: 사진 원본, 연락처, 조회 비밀번호, 촬영 상황 설명, 측정 요약.
 * 돌려주는 것: 접수번호와 예상 완료일.
 *
 * 현황 조회는 연락처와 비밀번호로 합니다. 32자 열쇠를 받아 적게 하는 것은
 * 너무 번거로웠습니다. 비밀번호는 소금 섞어 늘린 해시만 남기므로 저희도
 * 원문을 알지 못합니다.
 *
 * 조회 열쇠도 여전히 발급하지만 화면에 보여 주지 않습니다. 신청한 브라우저가
 * 비밀번호 없이 자기 접수를 열어 보는 데만 씁니다.
 */

import {
  LIMITS, PW_ITERATIONS, STATUS, checkEnv, contactIndexKey, derivePassword, etaFrom,
  fail, json, newId, newToken, normalizeContact, photoKey, safeText, sha256Hex,
} from './_shared.js';
import { scanProvenance } from '../../src/verify/provenance.js';

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
    return fail('파일이 없습니다.');
  }
  if (photo.size > LIMITS.maxBytes) {
    return fail(`파일이 ${Math.round(LIMITS.maxBytes / 1024 / 1024)}MB를 넘습니다. 더 작은 파일로 신청해 주세요.`, 413);
  }

  /* 3은 사람 심사 없이 아카이브에만 등록하는 길입니다. 간단 검사로 등급이
     나온 사람이 심사를 기다리지 않고 바로 맡길 수 있어야 합니다. */
  const rawGrade = String(form.get('grade') ?? '');
  const grade = rawGrade === '1' ? 1 : rawGrade === '3' ? 3 : 2;
  const reviewed = grade !== 3;
  // 간단 검사 화면이 최종 통과한 경우에만 이 표식을 붙입니다. 예전 화면이나
  // 실패 파일이 3등급 등록 요청을 보내더라도 서버에서 아카이브로 저장하지
  // 않도록, 화면의 조건과 별개로 한 번 더 막습니다.
  if (grade === 3 && String(form.get('verifiedGrade') ?? '') !== '3') {
    return fail('3등급을 받은 파일만 아카이브에 등록할 수 있습니다.', 422);
  }
  // 심사 접수와 아카이브 등록은 별개입니다. 간단 검사에서 3등급을 받은
  // 원본만 자동 등록하며, 상세 심사 접수는 원본을 보관하지 않는다고 명시한
  // 요청일 때 아카이브 색인에 넣지 않습니다.
  const archive = String(form.get('archive') ?? 'yes') !== 'no';
  const contact = safeText(form.get('contact'), LIMITS.maxContact);
  const password = String(form.get('password') ?? '');

  /* 아카이브 등록만 하는 건(3)은 연락처 없이 받습니다.
     검사 화면에서 동의 한 번으로 자동 등록되는 길이라, 그 자리에서 연락처와
     비밀번호를 받으면 자동이 아닙니다. 대신 조회 열쇠를 응답으로 돌려주고
     등록한 브라우저가 그것으로 자기 등록을 엽니다(localStorage).

     사람 심사(1·2등급)는 결과를 알려 드려야 하므로 연락처를 받습니다. */
  const anonymous = !reviewed && contact.length === 0 && password.length === 0;

  if (!anonymous) {
    if (contact.length < 5) {
      return fail('연락받을 메일 주소나 전화번호를 적어 주세요.');
    }
    if (password.length < LIMITS.minPassword) {
      return fail(`조회 비밀번호를 ${LIMITS.minPassword}자 이상으로 정해 주세요.`);
    }
    if (password.length > LIMITS.maxPassword) {
      return fail(`조회 비밀번호가 ${LIMITS.maxPassword}자를 넘습니다.`);
    }
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
    return fail('파일을 읽지 못했습니다.');
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
  const tokenHash = await sha256Hex(token);
  const pwHash = anonymous ? null : await derivePassword(password, contact);
  const now = new Date();

  // 대기 건수는 아직 끝나지 않은 접수만 셉니다.
  let queueAhead = 0;
  try {
    const open = await env.ULTARI_APPS.get('index:open', 'json');
    queueAhead = Array.isArray(open) ? open.length : 0;
  } catch {
    /* 처음 접수라면 색인이 없습니다. */
  }

  /* 심사를 받지 않는 건에는 완료 예정일이 없습니다. 없는 날짜를 적어
     두면 기다리지 않아도 되는 사람이 기다립니다. */
  const { days, etaISO } = reviewed
    ? etaFrom(grade, queueAhead, now.getTime())
    : { days: 0, etaISO: null };

  const ext = EXT[photo.type] || 'bin';
  try {
    await env.ULTARI_APPS.put(photoKey(id), bytes, {
      metadata: { type: photo.type || 'application/octet-stream', ext, name: safeText(photo.name, 120) },
    });
  } catch {
    return fail('파일을 저장하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.', 502);
  }

  const record = {
    id,
    tokenHash,
    pwHash,
    pwIterations: anonymous ? null : PW_ITERATIONS,
    anonymous,
    contactKey: anonymous ? null : normalizeContact(contact),
    grade,
    archive,
    reviewed,
    status: reviewed ? 'received' : 'archived',
    contact: anonymous ? '' : contact,
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
    history: [reviewed
      ? { at: now.toISOString(), status: 'received', note: '접수됐습니다.' }
      : { at: now.toISOString(), status: 'archived', note: '아카이브에 등록됐습니다.' }],
  };

  try {
    await env.ULTARI_APPS.put(`app:${id}`, JSON.stringify(record));

    /* 심사 대기 목록에는 심사를 받는 건만 넣습니다. 등록만 한 건을 넣으면
       뒤에 오는 사람의 대기 건수가 실제보다 길게 나옵니다. */
    if (reviewed) {
      const open = (await env.ULTARI_APPS.get('index:open', 'json')) || [];
      open.push(id);
      await env.ULTARI_APPS.put('index:open', JSON.stringify(open));
    }

    /* 연락처 → 접수번호 색인. 이것이 없으면 번호를 모르는 사람은 조회할 수
       없습니다. 익명 등록은 연락처가 없으므로 색인을 만들지 않습니다 —
       등록한 브라우저가 들고 있는 조회 열쇠가 유일한 길입니다. */
    if (!anonymous) {
      const byContact = await contactIndexKey(contact);
      const mine = (await env.ULTARI_APPS.get(byContact, 'json')) || [];
      if (!mine.includes(id)) mine.push(id);
      await env.ULTARI_APPS.put(byContact, JSON.stringify(mine.slice(-50)));
    }
  } catch {
    return fail('접수를 기록하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.', 502);
  }

  return json({
    ok: true,
    id,
    token,          // 화면에 보이지 않습니다. 이 브라우저가 자기 접수를 열 때만 씁니다.
    grade,
    archive,
    reviewed,
    status: reviewed ? 'received' : 'archived',
    statusLabel: reviewed ? STATUS.received.label : STATUS.archived.label,
    queueAhead: reviewed ? queueAhead : 0,
    etaDays: days,
    etaDate: etaISO,
    createdAt: record.createdAt,
  });
}

export const onRequestGet = () => fail('이 주소는 접수 전용입니다. 조회는 /api/status를 씁니다.', 405);
