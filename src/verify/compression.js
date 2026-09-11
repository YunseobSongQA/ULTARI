/**
 * compression.js — 파일이 몇 번 저장됐는지를 8x8 격자에서 읽습니다.
 *
 * JPEG는 화면을 8x8 블록으로 잘라 따로 압축합니다. 블록마다 계산이 독립적이라
 * 경계선에서 아주 미세한 단차가 남습니다. 이 단차의 세기가 압축 이력입니다.
 *
 *   격자가 없다  — 무손실 저장이거나, 리사이즈로 격자가 지워졌습니다.
 *   격자가 하나  — 한 번 저장됐습니다.
 *   격자가 둘    — 자르거나 크기를 바꾼 뒤 다시 저장했습니다.
 *                  두 번째 격자는 첫 번째와 어긋난 위치에 나타납니다.
 *
 * 영역마다 격자 세기가 크게 다르면 일부만 다른 이력을 가졌다는 뜻입니다.
 * 다만 매끈한 하늘과 빽빽한 나뭇잎도 격자 세기를 크게 벌려 놓기 때문에,
 * 이 신호는 단독으로 판정을 바꾸지 않습니다.
 */

import { median, percentile } from './pixels.js';

/* 합격선 — 화면에 노출하지 않습니다. */
const T = {
  gridVisible: 0.05,     // 정규화 피크가 1 + 이 값 이상이면 격자가 보인다고 봅니다.
  secondGrid: 0.05,      // 어긋난 위치의 두 번째 피크
  textureFloor: 0.8,     // 판단에 쓸 최소 인접 화소 차이
  spliceMedian: 0.15,    // 전체적으로 격자가 뚜렷할 때만 부분 편차를 따집니다.
  spliceWeakRatio: 0.2,  // 중앙값의 이 비율 아래인 타일
  spliceWeakTiles: 2,
};

/**
 * 한 축에 대한 오프셋별 경계 세기 (8칸).
 *
 * 단순 평균을 쓰면 안 됩니다. 창틀이나 건물 모서리 같은 강한 경계선 몇 개가
 * 평균을 통째로 끌고 가고, 그 경계선이 우연히 8의 배수 위치에 몰려 있으면
 * 있지도 않은 격자가 보입니다. 블록 단차는 밝기 단계로 한두 칸짜리 작은 값이라
 * 큰 차이값을 잘라 내도 살아남습니다. 그래서 상위 10%를 버린 절사평균을 씁니다.
 */
function offsetProfile(luma, width, height, horizontal) {
  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;
  const idx = horizontal ? (o, i) => o * width + i : (o, i) => i * width + o;

  // 오프셋별 정수 차이값 히스토그램
  const hist = new Int32Array(8 * 256);
  const counts = new Int32Array(8);
  for (let o = 0; o < outer; o++) {
    for (let i = 1; i < inner; i++) {
      const diff = Math.min(255, Math.round(Math.abs(luma[idx(o, i)] - luma[idx(o, i - 1)])));
      const k = i & 7;
      hist[k * 256 + diff]++;
      counts[k]++;
    }
  }

  // 전체 분포의 90번째 백분위를 절사 기준으로 삼습니다. 모든 오프셋에 같은 기준.
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let seen = 0;
  let cap = 255;
  for (let v = 0; v < 256; v++) {
    let bin = 0;
    for (let k = 0; k < 8; k++) bin += hist[k * 256 + v];
    seen += bin;
    if (seen >= total * 0.9) { cap = v; break; }
  }
  cap = Math.max(4, cap);

  const profile = new Float64Array(8);
  for (let k = 0; k < 8; k++) {
    let sum = 0;
    let n = 0;
    for (let v = 0; v <= cap; v++) {
      const c = hist[k * 256 + v];
      sum += v * c;
      n += c;
    }
    profile[k] = n ? sum / n : 0;
  }

  const avg = profile.reduce((a, b) => a + b, 0) / 8;
  if (avg < T.textureFloor) return null;   // 너무 평평해서 판단 불가

  const normalized = Array.from(profile, (v) => v / avg);
  let primary = 0;
  for (let k = 1; k < 8; k++) if (normalized[k] > normalized[primary]) primary = k;

  // 1차 피크에서 두 칸 이상 떨어진 위치의 최대값
  let secondary = 0;
  for (let k = 0; k < 8; k++) {
    const dist = Math.min(Math.abs(k - primary), 8 - Math.abs(k - primary));
    if (dist >= 2 && normalized[k] > secondary) secondary = normalized[k];
  }

  return { normalized, primary, peak: normalized[primary], secondary, texture: avg };
}

function analyzeTile(tile) {
  const x = offsetProfile(tile.luma, tile.width, tile.height, true);
  const y = offsetProfile(tile.luma, tile.width, tile.height, false);
  if (!x && !y) return null;

  const peaks = [x, y].filter(Boolean);
  const strength = peaks.reduce((a, p) => a + p.peak, 0) / peaks.length;
  const secondary = peaks.reduce((a, p) => a + p.secondary, 0) / peaks.length;

  return {
    strength,
    secondary,
    offsetX: x ? x.primary : null,
    offsetY: y ? y.primary : null,
    texture: peaks.reduce((a, p) => a + p.texture, 0) / peaks.length,
  };
}

export function analyzeCompression(pixels) {
  const perTile = pixels.tiles.map(analyzeTile).filter(Boolean);

  const result = {
    measurable: perTile.length >= 3,
    gridStrength: null,
    secondaryStrength: null,
    tileCount: perTile.length,
    tileSpread: null,
    weakTiles: 0,
    estimatedPasses: null,   // null = 격자 없음
    flags: {
      recompressed: false,
      regionalBlockDeviation: false,
    },
  };

  if (!result.measurable) return result;

  const strengths = perTile.map((t) => t.strength);
  result.gridStrength = median(strengths);
  result.secondaryStrength = median(perTile.map((t) => t.secondary));

  const excess = strengths.map((s) => Math.max(0, s - 1));
  const medianExcess = median(excess);
  result.tileSpread = medianExcess > 1e-6
    ? (percentile(excess, 0.75) - percentile(excess, 0.25)) / medianExcess
    : null;

  if (result.gridStrength - 1 < T.gridVisible) {
    result.estimatedPasses = null;          // 격자가 보이지 않음
  } else if (result.secondaryStrength - 1 >= T.secondGrid) {
    result.estimatedPasses = 2;             // 어긋난 두 번째 격자
    result.flags.recompressed = true;
  } else {
    result.estimatedPasses = 1;
  }

  // 부분 합성 의심: 전체적으로 격자가 뚜렷한데 특정 영역에만 격자가 없는 경우
  if (medianExcess >= T.spliceMedian && perTile.length >= 6) {
    result.weakTiles = excess.filter((e) => e < medianExcess * T.spliceWeakRatio).length;
    result.flags.regionalBlockDeviation = result.weakTiles >= T.spliceWeakTiles;
  }

  return result;
}
