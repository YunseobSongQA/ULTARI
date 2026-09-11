/**
 * optics.js — 유리를 통과한 빛만 남기는 흔적을 찾습니다.
 *
 * 렌즈는 완벽하지 않습니다. 그 불완전함이 여기서는 증거가 됩니다.
 *
 *   비네팅   — 주변부로 갈수록 빛이 덜 모입니다.
 *   색수차   — 파장마다 굴절률이 달라 R과 B의 엣지 위치가 어긋납니다.
 *   초점     — 하나의 초점면에서 멀어질수록 선명도가 연속적으로 떨어집니다.
 *
 * 셋 다 "없으면 수상하다"가 아니라 "있으면 렌즈를 지났다"는 쪽으로만 읽습니다.
 * 요즘 카메라는 비네팅과 색수차를 촬영 순간 보정해서 지워 버리고,
 * 크롭한 사진에는 원래의 주변부가 없습니다.
 */

import { median, percentile } from './pixels.js';

/* 합격선 — 화면에 노출하지 않습니다. */
const T = {
  vignetteRatio: 0.92,     // 코너/중앙 휘도비가 이 아래면 비네팅 검출
  caShiftPx: 0.12,         // R-B 엣지 위치 차이가 이 이상이면 색수차 검출
  gradientFloor: 24,       // 엣지로 인정할 최소 기울기
  abruptness: 0.42,        // 초점 맵의 셀 경계 급격함
  meaningfulRange: 0.5,    // 초점 차이가 있다고 볼 최소 로그 범위
};

const GRID = 8;            // 초점 맵 8x8 (명세)

function regionMean(luma, width, x0, y0, w, h) {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y0 + h; y++) {
    const row = y * width;
    for (let x = x0; x < x0 + w; x++) {
      sum += luma[row + x];
      n++;
    }
  }
  return n ? sum / n : NaN;
}

/* ── 비네팅 ──────────────────────────────────────────── */

function measureVignetting(medium) {
  const { luma, width, height } = medium;
  const cw = Math.max(8, Math.round(width * 0.3));
  const ch = Math.max(8, Math.round(height * 0.3));
  const centerMean = regionMean(
    luma, width,
    Math.round((width - cw) / 2), Math.round((height - ch) / 2),
    cw, ch,
  );

  const kw = Math.max(6, Math.round(width * 0.14));
  const kh = Math.max(6, Math.round(height * 0.14));
  const corners = [
    regionMean(luma, width, 0, 0, kw, kh),
    regionMean(luma, width, width - kw, 0, kw, kh),
    regionMean(luma, width, 0, height - kh, kw, kh),
    regionMean(luma, width, width - kw, height - kh, kw, kh),
  ];
  const cornerMean = corners.reduce((a, b) => a + b, 0) / corners.length;

  const ratio = centerMean > 1 ? cornerMean / centerMean : null;
  return {
    ratio,
    // 네 모서리가 서로 얼마나 다른가. 피사체 때문에 한쪽만 어두운 경우를 구분합니다.
    cornerAgreement: centerMean > 1
      ? (Math.max(...corners) - Math.min(...corners)) / centerMean
      : null,
    detected: ratio != null && ratio <= T.vignetteRatio,
  };
}

/* ── 색수차 ──────────────────────────────────────────── */

/**
 * 고립된 강한 엣지를 찾아, 그 주변에서 R과 B의 기울기 무게중심 위치 차이를 잽니다.
 * horizontal=true 이면 가로 방향(세로 엣지)을 봅니다.
 */
function edgeShifts(tile, horizontal) {
  const { image, width, height } = tile;
  const d = image.data;
  const shifts = [];

  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;
  const at = horizontal
    ? (line, i, c) => (line * width + i) * 4 + c
    : (line, i, c) => (i * width + line) * 4 + c;

  const step = 4;
  const W = 3;   // 무게중심 창 반경

  for (let line = W + 1; line < outer - W - 1; line += step) {
    // 녹색 기울기로 엣지 위치를 먼저 찾습니다.
    for (let i = W + 2; i < inner - W - 2; i++) {
      const g = d[at(line, i + 1, 1)] - d[at(line, i - 1, 1)];
      const ag = Math.abs(g);
      if (ag < T.gradientFloor) continue;

      // 국소 최대인지 + 근처에 다른 엣지가 없는지
      let isolated = true;
      let isPeak = true;
      for (let k = -5; k <= 5; k++) {
        if (k === 0) continue;
        const gk = Math.abs(d[at(line, i + k + 1, 1)] - d[at(line, i + k - 1, 1)]);
        if (gk > ag) { isPeak = false; break; }
        if (Math.abs(k) > 2 && gk > ag * 0.6) { isolated = false; break; }
      }
      if (!isPeak || !isolated) continue;

      let sumR = 0, wR = 0, sumB = 0, wB = 0;
      for (let k = -W; k <= W; k++) {
        const gr = Math.abs(d[at(line, i + k + 1, 0)] - d[at(line, i + k - 1, 0)]);
        const gb = Math.abs(d[at(line, i + k + 1, 2)] - d[at(line, i + k - 1, 2)]);
        sumR += gr * k; wR += gr;
        sumB += gb * k; wB += gb;
      }
      if (wR < T.gradientFloor * 2 || wB < T.gradientFloor * 2) continue;

      const shift = sumR / wR - sumB / wB;
      if (Math.abs(shift) < 3) shifts.push(shift);   // 3px 넘는 값은 엣지 오검출
      i += 6;
    }
  }
  return shifts;
}

function measureChromaticAberration(tiles) {
  const outerShifts = [];
  const allShifts = [];
  for (const tile of tiles) {
    const s = [...edgeShifts(tile, true), ...edgeShifts(tile, false)];
    allShifts.push(...s);
    if (tile.radius >= 0.5) outerShifts.push(...s);
  }

  const pool = outerShifts.length >= 120 ? outerShifts : allShifts;
  const abs = pool.map(Math.abs);
  const shiftPx = abs.length >= 40 ? median(abs) : null;

  return {
    shiftPx,
    edgeCount: pool.length,
    // 엣지가 부족하면 판단 자체를 하지 않습니다.
    measurable: abs.length >= 40,
    detected: shiftPx != null && shiftPx >= T.caShiftPx,
  };
}

/* ── 초점 연속성 ─────────────────────────────────────── */

function measureFocus(medium) {
  const { luma, width, height } = medium;
  const cw = Math.floor(width / GRID);
  const chh = Math.floor(height / GRID);
  const map = new Float64Array(GRID * GRID);

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x0 = gx * cw;
      const y0 = gy * chh;
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let y = y0 + 1; y < y0 + chh - 1; y++) {
        const row = y * width;
        for (let x = x0 + 1; x < x0 + cw - 1; x++) {
          const lap =
            4 * luma[row + x] -
            luma[row + x - 1] - luma[row + x + 1] -
            luma[row - width + x] - luma[row + width + x];
          sum += lap;
          sumSq += lap * lap;
          n++;
        }
      }
      const m = n ? sum / n : 0;
      map[gy * GRID + gx] = n ? Math.max(0, sumSq / n - m * m) : 0;
    }
  }

  const logs = Array.from(map, (v) => Math.log(1 + v));
  const lo = Math.min(...logs);
  const hi = Math.max(...logs);
  const range = hi - lo;

  let deltaSum = 0;
  let pairs = 0;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const here = logs[gy * GRID + gx];
      if (gx + 1 < GRID) { deltaSum += Math.abs(here - logs[gy * GRID + gx + 1]); pairs++; }
      if (gy + 1 < GRID) { deltaSum += Math.abs(here - logs[(gy + 1) * GRID + gx]); pairs++; }
    }
  }
  const neighborDelta = pairs ? deltaSum / pairs : 0;
  const abruptness = range > 1e-6 ? neighborDelta / range : 0;

  // 선명도가 전 화면에서 똑같은 정도. rephoto.js가 평면성 판단에 씁니다.
  const mid = median(logs);
  const uniformity = mid > 1e-6
    ? 1 - (percentile(logs, 0.9) - percentile(logs, 0.1)) / mid
    : 0;

  return {
    map: Array.from(map),
    logRange: range,
    neighborDelta,
    abruptness,
    uniformity: Math.max(0, Math.min(1, uniformity)),
    // 초점 차이가 실제로 있는 화면에서만 "급격함"을 따집니다.
    discontinuous: range >= T.meaningfulRange && abruptness >= T.abruptness,
  };
}

export function analyzeOptics(pixels) {
  const vignetting = measureVignetting(pixels.medium);
  const chromaticAberration = measureChromaticAberration(pixels.tiles);
  const focus = measureFocus(pixels.medium);

  return {
    vignetting,
    chromaticAberration,
    focus,
    flags: {
      // 렌즈 흔적이 하나도 없음. 단독으로는 판정을 바꾸지 않습니다.
      noOpticalTrace: !vignetting.detected && !chromaticAberration.detected,
      focusDiscontinuity: focus.discontinuous,
    },
  };
}
