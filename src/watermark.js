/**
 * watermark.js — 발급된 등급을 사진 위에 새깁니다.
 *
 * 합성도 브라우저 안에서 합니다. 원본도 결과물도 서버로 가지 않습니다.
 *
 * 두 가지를 만들 수 있습니다.
 *   1. 마크를 얹은 사진      — 그대로 올리시면 됩니다.
 *   2. 마크만 담은 투명 PNG  — 편집 프로그램에서 직접 배치하실 때.
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

export const POSITIONS = [
  { id: 'bl', label: '좌측 하단' },
  { id: 'br', label: '우측 하단' },
  { id: 'tl', label: '좌측 상단' },
  { id: 'tr', label: '우측 상단' },
];
export const DEFAULT_POSITION = 'bl';

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
    unit, pad, gap, s1, s2, lead, f1, f2, markH, markW,
    border: Math.max(1, Math.round(unit * 0.07)),
    w: Math.round(pad * 2 + markW + gap + Math.max(w1, w2)),
    h: Math.round(pad * 2 + s1 + lead + s2),
  };
}

/**
 * 명판 크기를 정합니다. 명판 높이가 짧은 변의 5~6%가 되도록 잡았습니다.
 * 사진에 얹는 서명은 이 정도가 읽히면서도 화면을 잡아먹지 않습니다.
 */
function planPlate(ctx, W, H, line1, line2) {
  let unit = Math.max(11, Math.min(40, Math.round(Math.min(W, H) * 0.013)));
  let plate = measurePlate(ctx, unit, line1, line2);
  if (plate.w > W * 0.72) {
    unit = Math.max(9, Math.floor((unit * W * 0.72) / plate.w));
    plate = measurePlate(ctx, unit, line1, line2);
  }
  return plate;
}

function drawPlate(ctx, x, y, plate, line1, line2) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(x, y, plate.w, plate.h);
  ctx.strokeStyle = 'rgba(20, 22, 26, 0.26)';
  ctx.lineWidth = plate.border;
  ctx.strokeRect(x + plate.border / 2, y + plate.border / 2, plate.w - plate.border, plate.h - plate.border);

  drawMark(ctx, x + plate.pad, y + (plate.h - plate.markH) / 2, plate.markH);

  const tx = x + plate.pad + plate.markW + plate.gap;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = plate.f1;
  ctx.fillText(line1, tx, y + plate.pad + plate.s1);
  ctx.fillStyle = INK_2;
  ctx.font = plate.f2;
  ctx.fillText(line2, tx, y + plate.pad + plate.s1 + plate.lead + plate.s2);
}

function placeAt(position, W, H, plate, margin) {
  const left = margin;
  const right = Math.max(margin, W - plate.w - margin);
  const top = margin;
  const bottom = Math.max(margin, H - plate.h - margin);
  switch (position) {
    case 'br': return { x: right, y: bottom };
    case 'tl': return { x: left, y: top };
    case 'tr': return { x: right, y: top };
    case 'bl':
    default: return { x: left, y: bottom };
  }
}

const lines = ({ grade, shortHash, dateText }) => [`ULTARI ${grade}등급`, `${shortHash} · ${dateText}`];
const waitForFonts = async () => { try { await document.fonts?.ready; } catch { /* 무시 */ } };

/**
 * 사진에 인증 명판을 얹은 이미지를 만듭니다.
 * @param {File} file
 * @param {{grade:number, shortHash:string, dateText:string, position?:string, maxEdge?:number}} opt
 *   maxEdge를 주면 그 크기로 줄여 그립니다. 미리보기용입니다.
 *   명판은 출력 크기에 비례하므로 줄여도 보이는 비율은 같습니다.
 */
export async function renderMarkedImage(file, opt) {
  const bitmap = await createImageBitmap(file);   // 보이는 방향 그대로
  const scale = opt.maxEdge ? Math.min(1, opt.maxEdge / Math.max(bitmap.width, bitmap.height)) : 1;
  const W = Math.max(1, Math.round(bitmap.width * scale));
  const H = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, W, H);
  bitmap.close?.();

  await waitForFonts();

  const [line1, line2] = lines(opt);
  const plate = planPlate(ctx, W, H, line1, line2);
  const margin = Math.round(plate.unit * 1.35);
  const { x, y } = placeAt(opt.position || DEFAULT_POSITION, W, H, plate, margin);
  drawPlate(ctx, x, y, plate, line1, line2);

  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.95));
  return { blob, type, width: W, height: H, url: URL.createObjectURL(blob) };
}

/**
 * 마크만 담은 투명 PNG. 편집 프로그램에서 직접 배치하실 때 씁니다.
 * 크기는 원본 사진에 얹었을 때와 같게 잡으므로 1:1로 올리시면 됩니다.
 */
export async function renderMarkOnly({ width, height, ...opt }) {
  await waitForFonts();
  const probe = document.createElement('canvas').getContext('2d');
  const [line1, line2] = lines(opt);
  const plate = planPlate(probe, width, height, line1, line2);

  const canvas = document.createElement('canvas');
  canvas.width = plate.w;
  canvas.height = plate.h;
  const ctx = canvas.getContext('2d');
  drawPlate(ctx, 0, 0, plate, line1, line2);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { blob, type: 'image/png', width: plate.w, height: plate.h, url: URL.createObjectURL(blob) };
}

export function markedFilename(originalName, grade, type) {
  const ext = type === 'image/png' ? 'png' : 'jpg';
  const base = (originalName || 'photo').replace(/\.[^.]+$/, '').slice(0, 60) || 'photo';
  return `${base}-ultari-grade${grade}.${ext}`;
}

export function markOnlyFilename(grade) {
  return `ultari-grade${grade}-mark.png`;
}
