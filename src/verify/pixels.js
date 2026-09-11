/**
 * pixels.js — 검사 모듈들이 공유하는 디코더.
 *
 * 측정에는 두 가지 해상도가 필요합니다.
 *
 *  - 노이즈, JPEG 8x8 격자, 색수차, 모아레는 원본 해상도에서만 살아남습니다.
 *    축소하면 픽셀이 평균되면서 측정하려던 신호가 사라집니다.
 *    그래서 원본 배율 타일을 3x3 위치에서 떼어 씁니다.
 *  - 비네팅과 초점 분포는 화면 전체의 저주파 특성이라 축소본으로 충분하고,
 *    축소하는 편이 오히려 안정적입니다.
 *
 * 원본 해상도 전체를 ImageData로 올리면 2400만 화소 사진에서 96MB가 필요합니다.
 * 타일로 나누는 이유는 그 비용을 피하기 위한 것이기도 합니다.
 */

const TILE = 512;          // 원본 배율 타일 한 변 (8의 배수 = JPEG 블록 격자와 정렬)
const MEDIUM_MAX = 1280;   // 축소본 긴 변
const TILE_GRID = [1 / 6, 1 / 2, 5 / 6];

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** RGBA 버퍼에서 휘도(BT.601) 평면을 만듭니다. */
export function lumaOf(imageData) {
  const { data, width, height } = imageData;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return out;
}

export function median(values) {
  if (!values.length) return NaN;
  const a = Float64Array.from(values).sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function percentile(values, p) {
  if (!values.length) return NaN;
  const a = Float64Array.from(values).sort();
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

export function mean(values) {
  if (!values.length) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/**
 * 파일에서 측정용 픽셀 표현을 만듭니다.
 * EXIF 회전은 적용하지 않습니다(imageOrientation: 'none').
 * 센서가 기록한 좌표계 그대로여야 비네팅과 색수차의 방사 방향이 맞습니다.
 */
export async function loadPixels(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'none' });
  } catch (err) {
    throw new Error('DECODE_FAILED');
  }

  const width = bitmap.width;
  const height = bitmap.height;

  // 축소본
  const scale = Math.min(1, MEDIUM_MAX / Math.max(width, height));
  const mw = Math.max(1, Math.round(width * scale));
  const mh = Math.max(1, Math.round(height * scale));
  const mc = canvasOf(mw, mh);
  const mctx = mc.getContext('2d', { willReadFrequently: true });
  mctx.imageSmoothingEnabled = true;
  mctx.imageSmoothingQuality = 'high';
  mctx.drawImage(bitmap, 0, 0, mw, mh);
  const medium = mctx.getImageData(0, 0, mw, mh);

  // 원본 배율 타일
  const tw = Math.min(TILE, width);
  const th = Math.min(TILE, height);
  const tc = canvasOf(tw, th);
  const tctx = tc.getContext('2d', { willReadFrequently: true });
  tctx.imageSmoothingEnabled = false;

  const seen = new Set();
  const tiles = [];
  for (const fy of TILE_GRID) {
    for (const fx of TILE_GRID) {
      // 8의 배수로 내림 — JPEG 블록 경계와 타일 경계를 일치시킵니다.
      const sx = Math.max(0, Math.min(width - tw, Math.round(fx * width - tw / 2))) & ~7;
      const sy = Math.max(0, Math.min(height - th, Math.round(fy * height - th / 2))) & ~7;
      const key = `${sx},${sy}`;
      if (seen.has(key)) continue;
      seen.add(key);

      tctx.clearRect(0, 0, tw, th);
      tctx.drawImage(bitmap, sx, sy, tw, th, 0, 0, tw, th);
      const image = tctx.getImageData(0, 0, tw, th);
      tiles.push({
        image,
        width: tw,
        height: th,
        sx,
        sy,
        // 화면 중심에서의 정규화 거리 — 비네팅·색수차는 방사 방향으로 커집니다.
        radius: Math.hypot(fx - 0.5, fy - 0.5) / Math.hypot(0.5, 0.5),
        luma: lumaOf(image),
      });
    }
  }

  bitmap.close?.();

  return {
    width,
    height,
    megapixels: (width * height) / 1e6,
    medium: { image: medium, width: mw, height: mh, luma: lumaOf(medium) },
    tiles,
    tileSize: { width: tw, height: th },
  };
}
