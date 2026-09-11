/**
 * watermark.js — 발급된 등급을 사진 위에 새깁니다.
 *
 * 합성도 브라우저 안에서 합니다. 원본도 결과물도 서버로 가지 않습니다.
 *
 * 새겨진 마크는 장식이 아니라 주장입니다. "이 파일은 ULTARI에서 3등급을 받았다."
 * 다만 마크를 넣는 순간 파일의 바이트가 달라지므로 지문도 달라집니다.
 * 그래서 마크에는 원본의 지문 앞자리를 같이 새기고, 화면에도 그 사실을 적습니다.
 */

/* 마크 도형 — public/favicon.svg와 같은 좌표계(32x32)를 씁니다. */
const PALINGS = [
  { x: 3.4,  w: 2.4, top: 9.8,  tilt: -1.0 },
  { x: 9.2,  w: 2.2, top: 5.2,  tilt: 0.7 },
  { x: 15.0, w: 2.5, top: 12.4, tilt: -0.5 },
  { x: 20.8, w: 2.2, top: 6.6,  tilt: 1.1 },
  { x: 26.6, w: 2.4, top: 10.4, tilt: -0.8 },
];
const RAIL = { x: 2.3, y: 17.3, w: 27.3, h: 1.9 };
const BOTTOM = 27.6;
const BOX = { x: 1, y: 4, w: 30, h: 24.6 };   // 마크가 실제로 차지하는 상자

const FONT = '"Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif';
const PAPER = '#F5F4F1';
const INK = '#14161A';
const INK_2 = '#5E6166';

function roundedTop(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, [r, r, 0, 0]);
    return;
  }
  ctx.beginPath();                               // roundRect가 없는 브라우저용
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

export const markAspect = BOX.w / BOX.h;

/** 왼쪽 위 모서리 (x, y)에 높이 h로 울타리 마크를 그립니다. */
export function drawMark(ctx, x, y, h, color = INK) {
  const s = h / BOX.h;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.translate(-BOX.x, -BOX.y);
  ctx.fillStyle = color;

  const spin = (cx, cy, deg, draw) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.translate(-cx, -cy);
    draw();
    ctx.fill();
    ctx.restore();
  };

  for (const p of PALINGS) {
    const r = p.w / 2;
    spin(p.x + r, BOTTOM, p.tilt, () => roundedTop(ctx, p.x, p.top, p.w, BOTTOM - p.top, r));
  }
  spin(16, RAIL.y + RAIL.h / 2, -1.2, () => {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(RAIL.x, RAIL.y, RAIL.w, RAIL.h, 0.55);
    } else {
      ctx.beginPath();
      ctx.rect(RAIL.x, RAIL.y, RAIL.w, RAIL.h);
    }
  });
  ctx.restore();
}

/**
 * 사진 오른쪽 아래에 인증 명판을 새긴 이미지를 만듭니다.
 * @returns {Promise<{blob: Blob, type: string, width: number, height: number, url: string}>}
 */
export async function renderMarkedImage(file, { grade, shortHash, dateText }) {
  const bitmap = await createImageBitmap(file);   // 보이는 방향 그대로
  const W = bitmap.width;
  const H = bitmap.height;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  // 웹폰트가 아직 안 왔으면 명판 글자가 대체 글꼴로 그려집니다.
  try { await document.fonts?.ready; } catch { /* 무시 */ }

  const line1 = `ULTARI ${grade}등급`;
  const line2 = `${shortHash} · ${dateText}`;

  // 사진 크기에 맞춰 명판을 키웁니다. 명판 높이가 짧은 변의 5~6%가 되도록 잡았습니다.
  // 사진에 얹는 서명은 이 정도가 읽히면서도 화면을 잡아먹지 않습니다.
  let unit = Math.max(11, Math.min(40, Math.round(Math.min(W, H) * 0.013)));
  let plate = measurePlate(ctx, unit, line1, line2);
  if (plate.w > W * 0.72) {
    unit = Math.max(9, Math.floor(unit * (W * 0.72) / plate.w));
    plate = measurePlate(ctx, unit, line1, line2);
  }

  const margin = Math.round(unit * 1.35);
  const px = Math.max(margin, W - plate.w - margin);
  const py = Math.max(margin, H - plate.h - margin);

  ctx.fillStyle = PAPER;
  ctx.fillRect(px, py, plate.w, plate.h);
  ctx.strokeStyle = 'rgba(20, 22, 26, 0.26)';
  ctx.lineWidth = Math.max(1, Math.round(unit * 0.07));
  ctx.strokeRect(px + ctx.lineWidth / 2, py + ctx.lineWidth / 2, plate.w - ctx.lineWidth, plate.h - ctx.lineWidth);

  drawMark(ctx, px + plate.pad, py + (plate.h - plate.markH) / 2, plate.markH);

  const tx = px + plate.pad + plate.markW + plate.gap;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = plate.f1;
  ctx.fillText(line1, tx, py + plate.pad + plate.s1);
  ctx.fillStyle = INK_2;
  ctx.font = plate.f2;
  ctx.fillText(line2, tx, py + plate.pad + plate.s1 + plate.lead + plate.s2);

  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.95));
  return { blob, type, width: W, height: H, url: URL.createObjectURL(blob) };
}

function measurePlate(ctx, unit, line1, line2) {
  const pad = Math.round(unit * 0.95);
  const gap = Math.round(unit * 0.8);
  const s1 = Math.round(unit * 1.2);
  const s2 = Math.round(unit * 0.92);
  const lead = Math.round(unit * 0.34);
  const f1 = `600 ${s1}px ${FONT}`;
  const f2 = `400 ${s2}px ${FONT}`;

  ctx.font = f1;
  const w1 = ctx.measureText(line1).width;
  ctx.font = f2;
  const w2 = ctx.measureText(line2).width;

  const markH = Math.round(unit * 2.05);
  const markW = Math.round(markH * markAspect);

  return {
    pad, gap, s1, s2, lead, f1, f2, markH, markW,
    w: Math.round(pad * 2 + markW + gap + Math.max(w1, w2)),
    h: Math.round(pad * 2 + s1 + lead + s2),
  };
}

export function markedFilename(originalName, grade, type) {
  const ext = type === 'image/png' ? 'png' : 'jpg';
  const base = (originalName || 'photo').replace(/\.[^.]+$/, '').slice(0, 60) || 'photo';
  return `${base}-ultari-grade${grade}.${ext}`;
}

/** 내려받기. 서버를 거치지 않고 브라우저가 직접 파일을 씁니다. */
export function downloadBlobUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
