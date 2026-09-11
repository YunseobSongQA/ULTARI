/**
 * exif.js — 파일에 남아 있는 촬영 메타데이터를 읽습니다.
 *
 * EXIF는 텍스트 필드입니다. 누구나 한 줄로 고쳐 쓸 수 있습니다.
 * 그래서 여기서 읽은 값은 증거가 아니라 "주장"입니다.
 * 이 주장이 픽셀과 맞는지 보는 것은 consistency.js가 합니다.
 *
 * GPS는 존재 여부만 반환합니다. 좌표값은 이 모듈 밖으로 나가지 않습니다.
 */

import exifr from 'exifr';

/** 촬영 기기가 아니라 후보정 도구임을 알려 주는 이름들. 감점 사유가 아닙니다. */
const EDITOR_HINTS = [
  'photoshop', 'lightroom', 'capture one', 'darktable', 'rawtherapee',
  'affinity', 'gimp', 'luminar', 'dxo', 'snapseed', 'vsco', 'pixelmator',
];

function firstDefined(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

/** 값이 실제로 있을 때만 숫자로 바꿉니다. Number(null)이 0이 되는 함정을 피합니다. */
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clean(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.replace(/\0/g, '').trim();
  return trimmed === '' ? null : trimmed;
}

/** "1/250초" 또는 "2.5초" */
export function formatExposure(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds >= 1) return `${Number(seconds.toFixed(1))}초`;
  return `1/${Math.round(1 / seconds)}초`;
}

export function formatCamera(exif) {
  const make = exif.make;
  const model = exif.model;
  if (!make && !model) return null;
  if (!model) return make;
  if (!make) return model;
  // "Canon" + "Canon EOS R6" -> "Canon EOS R6"
  return model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
}

export function formatSettings(exif) {
  const parts = [];
  // 휴대폰 렌즈는 6.7mm처럼 소수점이 의미를 가집니다. 반올림해서 7mm로 쓰면 값이 달라집니다.
  if (Number.isFinite(exif.focalLength)) {
    parts.push(`${Number(exif.focalLength.toFixed(exif.focalLength < 10 ? 1 : 0))}mm`);
  }
  if (Number.isFinite(exif.fNumber)) parts.push(`f/${Number(exif.fNumber.toFixed(1))}`);
  const shutter = formatExposure(exif.exposureTime);
  if (shutter) parts.push(shutter);
  if (Number.isFinite(exif.iso)) parts.push(`ISO ${exif.iso}`);
  return parts.length ? parts.join(' · ') : null;
}

export async function readExif(file) {
  let raw = null;
  try {
    raw = await exifr.parse(file, {
      tiff: true,
      ifd0: true,
      exif: true,
      gps: true,
      xmp: false,
      icc: false,
      iptc: false,
      jfif: true,
      mergeOutput: true,
      translateKeys: true,
      translateValues: true,
      reviveValues: true,
      silentErrors: true,
    });
  } catch {
    raw = null;
  }

  const source = raw || {};
  const keys = Object.keys(source);

  const make = clean(firstDefined(source, ['Make']));
  const model = clean(firstDefined(source, ['Model']));
  const lensModel = clean(firstDefined(source, ['LensModel', 'Lens', 'LensID', 'LensInfo']));
  const software = clean(firstDefined(source, ['Software', 'ProcessingSoftware', 'CreatorTool']));

  // ApertureValue와 ShutterSpeedValue는 APEX 단위라 초·F값과 섞어 쓰면 안 됩니다.
  const fNumber = num(firstDefined(source, ['FNumber']));
  const exposureTime = num(firstDefined(source, ['ExposureTime']));
  const iso = num(firstDefined(source, ['ISO', 'ISOSpeedRatings', 'PhotographicSensitivity']));
  const focalLength = num(firstDefined(source, ['FocalLength']));

  const dateTimeOriginal = firstDefined(source, ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized']);

  // 좌표는 읽는 즉시 버립니다. 존재 여부만 남깁니다.
  const hasGps = ['latitude', 'longitude', 'GPSLatitude', 'GPSLongitude'].some(
    (k) => source[k] !== undefined && source[k] !== null,
  );

  const softwareLower = (software || '').toLowerCase();
  const editorNamed = EDITOR_HINTS.find((hint) => softwareLower.includes(hint)) || null;

  const hasCameraId = Boolean(make || model);
  const hasCaptureTime = Boolean(dateTimeOriginal);
  const present = keys.length > 0;

  return {
    present,
    tagCount: keys.length,

    make,
    model,
    lensModel,
    software,
    editorNamed,

    fNumber: fNumber != null && fNumber > 0 ? fNumber : null,
    exposureTime: exposureTime != null && exposureTime > 0 ? exposureTime : null,
    iso: iso != null && iso > 0 ? iso : null,
    focalLength: focalLength != null && focalLength > 0 ? focalLength : null,

    dateTimeOriginal: dateTimeOriginal instanceof Date ? dateTimeOriginal : null,
    dateTimeOriginalRaw: dateTimeOriginal instanceof Date ? null : clean(dateTimeOriginal),

    hasGps,
    hasCameraId,
    hasCaptureTime,

    flags: {
      // 촬영 기기를 특정할 수 없음 — 자동 검증의 출발점 자체가 없는 상태입니다.
      noCameraId: !hasCameraId,
      // 촬영 시각이 없음
      noCaptureTime: !hasCaptureTime,
      // 메타데이터가 통째로 사라진 상태
      stripped: !present || (!hasCameraId && !hasCaptureTime),
    },
  };
}
