/**
 * rephoto.js — 화면을 다시 찍은 사진인지 의심할 근거를 모읍니다.
 *
 * 생성된 이미지를 모니터에 띄우고 진짜 카메라로 촬영하면,
 * EXIF도 진짜고 노이즈도 진짜고 렌즈 흔적도 진짜입니다.
 * 앞의 검사를 전부 통과합니다. 기계가 여기서 할 수 있는 일은 없습니다.
 *
 * 그래서 이 모듈은 판정하지 않습니다. 플래그만 세우고 2등급 심사로 넘깁니다.
 *
 *   모아레   — 모니터 화소 격자와 센서 화소 격자가 겹치면서 생기는 간섭 무늬.
 *              주파수 영역에서 규칙적인 피크로 나타납니다.
 *   평면성   — 평면을 찍었으므로 화면 전체의 선명도가 이상할 만큼 균일합니다.
 *
 * 둘 다 실제 피사체에서도 나옵니다. 직물, 벽돌, 방충망, 평면 복사물.
 * 그래서 이 신호는 등급을 깎지 않습니다.
 */

/* 합격선 — 화면에 노출하지 않습니다. */
const T = {
  peakThreshold: 6,     // 배경 대비 이 배수 이상이면 피크로 셉니다.
  moireRatio: 12,       // 최고 피크가 배경의 이 배수 이상
  moirePeaks: 2,        // 그런 피크가 둘 이상 (모아레는 대칭으로 나타납니다)
  flatUniformity: 0.88,
  flatRange: 0.5,
  maxTiles: 5,
};

/** 제자리 radix-2 FFT */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const xr = re[i + j + half];
        const xi = im[i + j + half];
        const vr = xr * cr - xi * ci;
        const vi = xr * ci + xi * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + half] = ur - vr;
        im[i + j + half] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

function largestPowerOfTwo(value) {
  let n = 1;
  while (n * 2 <= value) n *= 2;
  return n;
}

/** 한 타일의 스펙트럼에서 규칙적 피크를 셉니다. */
function spectralPeaks(tile) {
  const n = Math.min(256, largestPowerOfTwo(Math.min(tile.width, tile.height)));
  if (n < 64) return null;

  const ox = ((tile.width - n) >> 1);
  const oy = ((tile.height - n) >> 1);

  // 한 윈도우로 자른 조각은 경계에서 불연속이 생기고,
  // 그 불연속이 스펙트럼 축 위에 가짜 선을 만듭니다. 해닝 창으로 눌러 둡니다.
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));

  let sum = 0;
  for (let y = 0; y < n; y++) {
    const row = (oy + y) * tile.width + ox;
    for (let x = 0; x < n; x++) sum += tile.luma[row + x];
  }
  const dc = sum / (n * n);

  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    const row = (oy + y) * tile.width + ox;
    for (let x = 0; x < n; x++) {
      re[y * n + x] = (tile.luma[row + x] - dc) * win[y] * win[x];
    }
  }

  const rowRe = new Float64Array(n);
  const rowIm = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    rowRe.set(re.subarray(y * n, y * n + n));
    rowIm.set(im.subarray(y * n, y * n + n));
    fft(rowRe, rowIm);
    re.set(rowRe, y * n);
    im.set(rowIm, y * n);
  }
  const colRe = new Float64Array(n);
  const colIm = new Float64Array(n);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) { colRe[y] = re[y * n + x]; colIm[y] = im[y * n + x]; }
    fft(colRe, colIm);
    for (let y = 0; y < n; y++) { re[y * n + x] = colRe[y]; im[y * n + x] = colIm[y]; }
  }

  // 스펙트럼은 저주파에서 크고 고주파로 갈수록 작아집니다. 전체 중앙값 하나로
  // 배경을 잡으면 저주파 쪽 값이 전부 피크로 잡힙니다. 반지름 띠별로 따로 잡습니다.
  const half = n >> 1;
  const BANDS = 16;
  const maxR = Math.hypot(half, half);
  const lowCut = Math.max(4, n >> 5);

  const mag = new Float64Array(n * n);
  const band = new Int32Array(n * n).fill(-1);
  const buckets = Array.from({ length: BANDS }, () => []);
  let energy = 0;
  let pooled = 0;

  for (let y = 0; y < n; y++) {
    const fy = y < half ? y : y - n;
    for (let x = 0; x < n; x++) {
      const fx = x < half ? x : x - n;
      const m = Math.hypot(re[y * n + x], im[y * n + x]);
      mag[y * n + x] = m;
      const r = Math.hypot(fx, fy);
      // 저주파(피사체 형태)와 축 위의 값(잔여 경계 효과)은 제외합니다.
      if (r < lowCut) continue;
      if (Math.abs(fx) <= 1 || Math.abs(fy) <= 1) continue;
      const b = Math.min(BANDS - 1, Math.floor((r / maxR) * BANDS));
      band[y * n + x] = b;
      buckets[b].push(m);
      energy += m * m;
      pooled++;
    }
  }
  if (pooled < 256) return null;

  const bandFloor = buckets.map((values) => {
    if (!values.length) return Infinity;
    values.sort((a, b) => a - b);
    return values[values.length >> 1];
  });

  // 배경이 0에 수렴하는 그림(합성 패턴 등)에서 비율이 발산하지 않도록 바닥을 둡니다.
  const rmsFloor = Math.sqrt(energy / pooled) * 1e-3;

  let peakCount = 0;
  let strongest = 0;
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const b = band[y * n + x];
      if (b < 0) continue;
      const background = Math.max(bandFloor[b], rmsFloor, 1e-9);
      const m = mag[y * n + x];
      if (m < background * T.peakThreshold) continue;
      let isPeak = true;
      for (let dy = -1; dy <= 1 && isPeak; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (mag[(y + dy) * n + (x + dx)] > m) { isPeak = false; break; }
        }
      }
      if (!isPeak) continue;
      peakCount++;
      const ratio = m / background;
      if (ratio > strongest) strongest = ratio;
    }
  }

  return { peakCount, peakRatio: Math.min(strongest, 999), size: n };
}

export function analyzeRephoto(pixels, optics) {
  const ordered = [...pixels.tiles].sort((a, b) => a.radius - b.radius).slice(0, T.maxTiles);

  let best = null;
  let analyzed = 0;
  for (const tile of ordered) {
    const result = spectralPeaks(tile);
    if (!result) continue;
    analyzed++;
    if (!best || result.peakRatio > best.peakRatio) best = result;
  }

  const moire = Boolean(best && best.peakRatio >= T.moireRatio && best.peakCount >= T.moirePeaks);

  const focus = optics.focus;
  const flatFocus = focus.uniformity >= T.flatUniformity && focus.logRange < T.flatRange;

  let level = 'none';
  if (moire) level = 'present';
  else if (flatFocus) level = 'weak';

  return {
    measurable: analyzed > 0,
    peakRatio: best ? best.peakRatio : null,
    peakCount: best ? best.peakCount : null,
    windowSize: best ? best.size : null,
    focusUniformity: focus.uniformity,
    flags: { moire, flatFocus },
    level,
  };
}
