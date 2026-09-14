/**
 * certificate.js — 상세 검사 인증서를 그립니다.
 *
 * 사람 심사가 끝난 접수에만 나옵니다. 그리는 일은 브라우저 안에서 끝나고,
 * 사진은 쓰지 않습니다 — 인증서에 들어가는 값은 조회 응답에 이미 있는 것뿐입니다.
 *
 * 인증서는 장식이 아니라 주장입니다. "이 지문을 가진 파일이 ULTARI에서
 * 몇 등급을 받았고, 사람이 어떤 기준을 확인했다." 그래서 보장하지 않는 것도
 * 같은 종이에 적습니다. 근거 없이 등급만 적힌 종이는 아무것도 증명하지 않습니다.
 */

import { drawMark } from './watermark.js';
import { CHECK_LABEL, CHECK_STATES, REVIEW_CHECKS } from './review-criteria.js';

const FONT = '"Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif';
const PAPER = '#FBFAF9';
const INK = '#14161A';
const INK_2 = '#5E6166';
const INK_3 = '#8A8D92';
const RULE = '#E2DFD8';
const RULE_STRONG = '#C9C5BB';
const MEASURE = '#2B5FA8';
const WARN = '#B4532A';

const W = 1240;
const H = 1754;          // A4 비율(1:1.414)
const PAD = 96;

const font = (weight, size) => `${weight} ${size}px ${FONT}`;

const dateText = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '—');
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
};

/** 글자 간격을 직접 벌립니다. canvas에는 letter-spacing이 없습니다. */
function fillTracked(ctx, text, x, y, tracking) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
}

/** 한글은 단어 중간에서 끊으면 안 됩니다. 공백 단위로 자르고 넘칠 때만 글자로 자릅니다. */
function wrap(ctx, text, maxWidth) {
  const out = [];
  for (const paragraph of String(text || '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) { line = next; continue; }
      if (line) out.push(line);
      if (ctx.measureText(word).width <= maxWidth) { line = word; continue; }
      let piece = '';
      for (const ch of word) {
        if (ctx.measureText(piece + ch).width > maxWidth) { out.push(piece); piece = ch; }
        else piece += ch;
      }
      line = piece;
    }
    out.push(line);
  }
  return out;
}

function checkGlyph(ctx, x, y, size, ok) {
  ctx.save();
  ctx.strokeStyle = ok ? MEASURE : WARN;
  ctx.lineWidth = Math.max(2, size * 0.11);
  ctx.lineCap = 'square';
  ctx.beginPath();
  if (ok) {
    ctx.moveTo(x, y + size * 0.55);
    ctx.lineTo(x + size * 0.36, y + size * 0.88);
    ctx.lineTo(x + size, y + size * 0.12);
  } else {
    ctx.moveTo(x + size * 0.12, y + size * 0.12);
    ctx.lineTo(x + size * 0.88, y + size * 0.88);
    ctx.moveTo(x + size * 0.88, y + size * 0.12);
    ctx.lineTo(x + size * 0.12, y + size * 0.88);
  }
  ctx.stroke();
  ctx.restore();
}

const rule = (ctx, y, color = RULE, from = PAD, to = W - PAD) => {
  ctx.fillStyle = color;
  ctx.fillRect(from, y, to - from, 1);
};

/**
 * @param {{id:string, awarded:number, fingerprint?:string, checks?:object,
 *          result?:string, updatedAt?:string, createdAt?:string}} st
 * @returns {{url:string, width:number, height:number, type:string}}
 */
export async function renderCertificate(st) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // 종이 테두리 — 등급 색으로 왼쪽만 두껍게. 장식이 아니라 표지입니다.
  ctx.fillStyle = RULE_STRONG;
  ctx.fillRect(PAD - 40, PAD - 48, W - (PAD - 40) * 2, 1);
  ctx.fillRect(PAD - 40, H - PAD + 48, W - (PAD - 40) * 2, 1);

  let y = PAD;

  /* 머리 — 마크와 이름 */
  drawMark(ctx, PAD, y, 52, INK);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = font(600, 30);
  fillTracked(ctx, 'ULTARI', PAD + 78, y + 40, 3.5);

  ctx.textAlign = 'right';
  ctx.fillStyle = INK_3;
  ctx.font = font(400, 19);
  ctx.fillText('상세 검사 인증서', W - PAD, y + 40);
  ctx.textAlign = 'left';

  y += 130;

  /* 등급 — 이 종이에서 가장 큰 글자 */
  ctx.fillStyle = INK_3;
  ctx.font = font(400, 20);
  ctx.fillText('발급 등급', PAD, y);

  y += 96;
  ctx.fillStyle = MEASURE;
  ctx.font = font(600, 104);
  const gradeText = `${st.awarded}등급`;
  ctx.fillText(gradeText, PAD, y);
  const gradeW = ctx.measureText(gradeText).width;   // 폰트가 아직 그 글자의 것입니다

  ctx.fillStyle = INK_2;
  ctx.font = font(400, 22);
  ctx.fillText('사람이 직접 보고 발급했습니다', PAD + gradeW + 26, y - 8);

  y += 54;
  rule(ctx, y, RULE_STRONG);
  y += 60;

  /* 사실 — 접수번호, 지문, 날짜 */
  const facts = [
    ['접수번호', st.id],
    ['원본 파일 지문', `${st.fingerprint || '없음'}…  (SHA-256 앞자리)`],
    ['심사 완료', dateText(st.updatedAt)],
    ['신청일', dateText(st.createdAt)],
  ];
  for (const [key, value] of facts) {
    ctx.fillStyle = INK_3;
    ctx.font = font(400, 19);
    ctx.fillText(key, PAD, y);
    ctx.fillStyle = INK;
    ctx.font = font(500, 23);
    ctx.fillText(String(value), PAD + 250, y);
    y += 24;
    rule(ctx, y);
    y += 34;
  }

  y += 26;

  /* 사람이 본 기준 */
  const checks = st.checks || {};
  const rows = REVIEW_CHECKS
    .filter((c) => CHECK_STATES[checks[c.id]])
    .map((c) => [CHECK_LABEL[c.id], checks[c.id]]);

  ctx.fillStyle = INK_3;
  ctx.font = font(400, 19);
  ctx.fillText(rows.length ? `사람이 본 기준 ${rows.length}가지` : '기록된 기준이 없습니다', PAD, y);
  y += 40;

  for (const [label, state] of rows) {
    const ok = state === 'pass';
    checkGlyph(ctx, PAD, y - 17, 20, ok);
    ctx.fillStyle = ok ? INK : WARN;
    ctx.font = font(500, 22);
    ctx.fillText(label, PAD + 38, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = INK_3;
    ctx.font = font(400, 19);
    ctx.fillText(CHECK_STATES[state].label, W - PAD, y);
    ctx.textAlign = 'left';
    y += 20;
    rule(ctx, y);
    y += 30;
  }

  /* 심사 소견 */
  if (st.result) {
    y += 22;
    ctx.fillStyle = INK_3;
    ctx.font = font(400, 19);
    ctx.fillText('심사 소견', PAD, y);
    y += 38;
    ctx.fillStyle = INK;
    ctx.font = font(400, 22);
    for (const line of wrap(ctx, st.result, W - PAD * 2)) {
      ctx.fillText(line, PAD, y);
      y += 34;
    }
  }

  /* 바닥 — 보장하지 않는 것. 등급만 적힌 종이가 되지 않게 합니다. */
  const footTop = H - PAD - 210;
  rule(ctx, footTop, RULE_STRONG);

  let fy = footTop + 44;
  ctx.fillStyle = INK_2;
  ctx.font = font(400, 18);
  const notes = [
    '이 인증서는 위 지문을 가진 파일에 대한 판단입니다. 무엇이 찍혔는지, 누가 찍었는지는 확인하지 않았습니다.',
    '마크를 새기면 파일의 바이트가 달라져 지문도 달라집니다. 대조는 원본으로 하십시오.',
    '진위 확인: ultari.pages.dev 에서 신청하실 때 적으신 연락처와 비밀번호로 조회하시면 같은 내용이 나옵니다.',
  ];
  for (const note of notes) {
    for (const line of wrap(ctx, note, W - PAD * 2)) {
      ctx.fillText(line, PAD, fy);
      fy += 26;
    }
    fy += 6;
  }

  ctx.fillStyle = INK_3;
  ctx.font = font(400, 17);
  ctx.fillText(`발급 ${dateText(new Date().toISOString())} · ULTARI`, PAD, H - PAD + 10);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { url: URL.createObjectURL(blob), width: W, height: H, type: 'image/png' };
}

export const certificateFilename = (id, grade) => `ultari-${id}-grade${grade}-인증서.png`;
