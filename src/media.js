/**
 * media.js — 영상과 음악의 판정, 환산 수치, 판별 근거.
 *
 * 사진 쪽 grade.js / score.js와 같은 구조입니다. 다른 것은 재는 대상뿐입니다.
 *
 * 여기 있는 기준은 실제 파일로 재서 남긴 것만입니다. 버린 것도 적어 둡니다.
 *
 *  영상에서 버린 것
 *    CFA(베이어 흔적)  아이폰 원본에서 0/5. 4:2:0 크로마 서브샘플링과 프레임 간
 *                     압축이 베이어 위상 잔차를 지웁니다. 사진에서는 되지만
 *                     영상에서는 안 됩니다.
 *    모아레            아이폰 원본에서 5/5 오탐. 사진용 검출기가 영상의 크로마
 *                     격자를 주기 신호로 봅니다. 카카오톡 영상에서는 0/5이라
 *                     방향도 일정하지 않습니다.
 *
 *  음악에서 버린 것
 *    디지털 무음       실제 상업 음원에서 1.3%, 2.3%로 나옵니다. 곡 앞뒤 패딩이라
 *                     "사람이 만들지 않았다"의 근거가 될 수 없습니다.
 *
 * 남긴 기준의 근거는 각 항목 주석에 있습니다.
 */

import { VERDICT } from './grade.js';

/* ── 가중치 ─────────────────────────────────────────── */

/**
 * 촬영·녹음 흔적의 강도를 100점으로 나눕니다.
 *
 * 가중치는 측정한 판별력 순서입니다. 영상에서 가장 잘 갈린 것은 컨테이너
 * 기록(아이폰 5건 대 나머지 0건)이고, 그다음이 광학 흔적(편집 영상만 전무),
 * 압축 이력(화면 녹화만 재인코딩)입니다.
 */
export const VIDEO_WEIGHTS = {
  record: 40,      // 기기·위치·촬영 메타 트랙 기록
  optics: 25,      // 비네팅·색수차
  light: 15,       // 하이라이트 날림
  history: 20,     // 압축 이력 (재인코딩 흔적이 없을수록 원본에 가깝습니다)
  /* 기록은 편집해서 내보내면 지워지지만 이건 남습니다. 빛이 알갱이로
     도착해서 생기는 곡선이라 렌즈와 센서를 지난 그림에만 있습니다. */
  noise: 25,       // 노이즈-밝기 곡선 (광자 산탄 잡음)
};

/**
 * 음악은 기록이 남는 형식(WAV bext, iXML)과 남지 않는 형식(MP3)이 갈립니다.
 * 그래서 기록의 비중을 영상보다 낮추고 파형 쪽을 높였습니다.
 */
export const AUDIO_WEIGHTS = {
  record: 25,      // 녹음기·기기 기록
  floor: 30,       // 노이즈 플로어 — 방과 마이크의 소리
  band: 20,        // 대역 한계 — 어디까지 살아 있는가
  dynamics: 25,    // 크레스트 팩터 — 눌리지 않은 다이내믹
  /* 변환 도구 기록은 영상에서만 점수에 넣고 있었습니다. 소리에서는 근거 줄로만
     보이고 수치에는 반영되지 않아, 유튜브에서 받은 파일도 절반을 넘겼습니다. */
  history: 20,     // 압축·변환 이력 (다시 만든 파일일수록 잴 것이 없습니다)
};

const FACTOR = { match: 1, unknown: 0.5, against: 0 };

/* ── 영상 ──────────────────────────────────────────── */

/**
 * 프레임에서 나온 값을 세 갈래로 나눕니다.
 * match = 촬영 쪽, against = 생성·재가공 쪽, unknown = 판단 보류.
 */
function videoCategories(bundle) {
  const c = bundle.container || {};
  const s = bundle.frames?.summary || {};
  const n = bundle.frames?.frameCount || 0;

  /* 1. 기록 — 컨테이너가 남긴 것. 아이폰 MOV 5건 / 카카오톡·화면녹화·편집
        0건 (실측). 있으면 강한 근거지만, 없는 것은 근거가 아닙니다.
        편집해서 내보내면 지워지므로 없다고 반대쪽으로 세면 손을 댄 작업일수록
        감점부터 받습니다. 발급 문턱은 따로 잠가 두었습니다. */
  // 영상 컨테이너는 기기 이름 하나만 남기는 경우가 많습니다. 기기 기록 한 건은
  // 촬영 쪽 근거로 읽되, 다른 물리 신호와 함께 등급 문턱에서 다시 확인합니다.
  const record = c.cameraSigns?.length >= 1 ? 'match' : 'unknown';

  /* 2. 광학 흔적 — 렌즈를 거친 그림에만 남습니다.
        편집 영상 720p만 5/5로 전무했습니다. */
  const opticsHit = (s.vignetteFrames || 0) + (s.caFrames || 0);
  const optics = opticsHit >= 3 ? 'match' : 'unknown';

  /* 3. 하이라이트 날림 — 실제 빛에서 생깁니다. 전 파일에서 4~5/5로 나와
        판별력이 약합니다. 그래서 가중치를 낮게 두었습니다. */
  const light = (s.clipFrames || 0) >= n && n > 0 ? 'match' : 'unknown';

  /* 4. 압축 이력 — 변환 도구 기록은 다시 만든 파일의 흔적입니다.
        겹친 격자만으로는 "편집을 거쳤다"까지입니다. 편집한 영상은 전부
        여기 걸리므로 그것만으로 반대쪽으로 세지 않습니다. */
  const history = (c.toolSigns?.length || 0) > 0 ? 'against'
    : (s.recompressed || 0) > 0 || c.editor ? 'unknown'
      : (s.gridStrength != null ? 'match' : 'unknown');

  /* 5. 노이즈-밝기 곡선 — 프레임 절반 이상에서 밝을수록 노이즈가 커지면
        센서를 지난 그림입니다. 뒤집힌 곡선은 센서에서 나오지 않습니다. */
  const mostFrames = Math.max(1, Math.ceil(n / 2));
  const noise = (s.noiseRising || 0) >= mostFrames ? 'match' : 'unknown';

  return { record, optics, light, history, noise };
}

/* ── 음악 ──────────────────────────────────────────── */

/**
 * 녹음 기록이 들어갈 자리가 있는 형식.
 *
 * WAV에는 bext·iXML, FLAC에는 주석 블록, M4A·MP4에는 태그 상자가 있어
 * 녹음기와 기기 이름이 남습니다. MP3·AAC·OGG에는 그런 자리가 없습니다.
 *
 * 이 구분이 없으면 "기록이 없다"와 "기록이 어긋난다"를 같게 세게 됩니다.
 * 자리가 없는 형식에서 없는 것을 반대쪽 근거로 세면, mp3로 내보낸 것은
 * 사람이 만들었든 아니든 감점부터 받고 시작합니다 — 실제로 320kbps로
 * 내보낸 사람의 곡이 그렇게 50%가 됐습니다.
 */
export const RECORD_SLOT = /^(wav|flac|m4a|mp4|mov|webm)$/;

/**
 * 더 낮은 품질을 한 번 거쳐 온 소리인지.
 *
 * 인코더는 자기가 로우패스를 몇 Hz에 걸었는지 LAME 헤더에 적어 둡니다.
 * 그런데 실제로 잰 대역이 그보다 한참 낮으면, 이 인코더가 자른 것이 아니라
 * 이미 좁아진 소리를 받아 다시 인코딩한 것입니다. 태그를 지워도 남습니다.
 *
 * 헤더에 적힌 값이 없으면 비트율로 갈음합니다. 256kbps 이상으로 저장해
 * 놓고 17.5kHz에서 끊기는 파일은 그 비트율이 만들어 낸 소리가 아닙니다.
 * 낮은 비트율에서는 원래 일찍 끊기므로 이 판단을 하지 않습니다.
 */
export function recompressed(bundle) {
  const fa = bundle.container?.facts || {};
  const a = bundle.sound;
  if (!a || !a.rateTrusted || !a.band) return false;
  const roomy = fa.lowpassHz ? fa.lowpassHz - 2500
    : (fa.bitrate >= 256 ? 17500 : null);
  return Boolean(roomy && a.band.cutoffHz < roomy);
}

function audioCategories(bundle) {
  const c = bundle.container || {};
  const a = bundle.sound || {};

  const record = c.cameraSigns?.length >= 2 ? 'match' : 'unknown';

  /* 노이즈 플로어 — 실제 녹음은 방 소리와 프리앰프 잡음이 남습니다.
     실측 -15.8 ~ -44.0dB. 완전히 지워진 것은 손을 댄 것입니다. */
  const floor = a.roomTone ? 'match' : a.deadSilence ? 'against' : 'unknown';

  /* 대역 한계 — 실측 14.0~20.1kHz. 20kHz 위까지 살아 있으면 손실 압축을
     거치지 않은 것이고, 14kHz에서 끊기면 여러 번 압축된 것입니다. */
  const band = a.lossless ? 'match'
    : a.band && a.band.cutoffHz < 15000 ? 'against' : 'unknown';

  /* 크레스트 팩터 — 실측 11.1(눌린 마스터) ~ 20.1(손대지 않은 녹음) */
  const dynamics = a.natural ? 'match' : a.squashed ? 'against' : 'unknown';

  /* 변환 이력 — 변환 도구가 적혀 있거나, 담긴 소리가 비트율이 허용하는
     것보다 좁으면 원본이 아닙니다. */
  const history = (c.toolSigns?.length || 0) > 0 || recompressed(bundle) ? 'against' : 'unknown';

  return { record, floor, band, dynamics, history };
}

/* ── 환산 수치 ─────────────────────────────────────── */

/**
 * 촬영·녹음 흔적 강도와 그 반대값. 사진 쪽 scoreTraces와 같은 방식입니다.
 * 파일이 스스로 AI라고 밝혔으면 계산하지 않고 100으로 둡니다.
 */
export function mediaScore(bundle) {
  const kind = bundle.kind;
  const weights = kind === 'audio' ? AUDIO_WEIGHTS : VIDEO_WEIGHTS;
  const categories = kind === 'audio' ? audioCategories(bundle) : videoCategories(bundle);

  if (bundle.container?.declaresAi) {
    return { trace: 0, ai: 100, declared: true, categories, weights };
  }

  let got = 0;
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += weight;
    got += weight * FACTOR[categories[key]];
  }
  const trace = total > 0 ? Math.round((got / total) * 100) : 0;
  return { trace, ai: 100 - trace, declared: false, categories, weights };
}

/* ── 판별 근거 ─────────────────────────────────────── */

const SIDE = { camera: 'camera', unknown: 'unknown', ai: 'ai' };

/**
 * 화면에 한 줄씩 나가는 근거. 검출된 것만 넣습니다 —
 * 검출되지 않는 기준을 늘어놓으면 목록만 길어집니다.
 */
export function mediaSignals(bundle) {
  const rows = [];
  const c = bundle.container || {};
  const push = (side, title, detail) => rows.push({ side, title, detail });

  /* 파일이 스스로 밝힌 것 */
  if (c.declaresAi) {
    push(SIDE.ai, 'AI 생성 기록',
      `파일이 스스로 생성물이라고 적고 있습니다${c.generator ? ` — ${c.generator}` : ''}.`);
  } else if (c.c2pa) {
    push(SIDE.unknown, 'C2PA 매니페스트', '출처 서명이 들어 있습니다. 내용은 아래 사실 목록에 있습니다.');
  }

  /* 컨테이너가 남긴 촬영·녹음 기록.
     같은 제목을 여러 번 쓰지 않습니다 — 근거 다섯 줄이 모두 "기록된 촬영 흔적"이면
     무엇이 나왔는지 읽을 수 없습니다. 각 근거의 앞부분을 제목으로 씁니다. */
  const split = (sign) => {
    const at = sign.indexOf(' · ');
    return at > 0
      ? [sign.slice(0, at), sign.slice(at + 3)]
      : [sign.replace(/\s*\(.*\)$/, ''), sign];
  };
  for (const sign of c.cameraSigns || []) {
    const [title, detail] = split(sign);
    push(SIDE.camera, title, detail);
  }
  for (const sign of c.toolSigns || []) {
    const [title, detail] = split(sign);
    push(SIDE.ai, title, `${detail} — 원본이 아니라 다시 만든 파일입니다.`);
  }
  /* 편집 도구는 사람이 손을 댄 흔적입니다. 변환 도구와 같게 세지 않습니다. */
  for (const sign of c.editSigns || []) {
    const [title, detail] = split(sign);
    push(SIDE.unknown, title, `${detail} — 편집을 거친 파일입니다. 촬영하지 않았다는 뜻은 아닙니다.`);
  }

  if (bundle.kind === 'audio') {
    const a = bundle.sound || {};
    if (a.roomTone) {
      push(SIDE.camera, '방 소리가 남아 있음',
        `조용한 구간이 ${a.floor.floorDb.toFixed(1)}dB입니다. 마이크와 방의 소리입니다.`);
    }
    if (a.noQuietPart) {
      push(SIDE.unknown, '쉬는 구간이 없음',
        `가장 조용한 구간도 ${a.floor.floorDb.toFixed(1)}dB입니다. 방 소리를 잴 자리가 없어 이 항목은 판단하지 않았습니다.`);
    }
    if (a.deadSilence) {
      push(SIDE.ai, '잡음이 지워진 무음',
        `조용한 구간이 ${a.floor.floorDb.toFixed(1)}dB로 잡음이 없습니다. 마이크는 이렇게 조용하지 않습니다.`);
    }
    if (a.lossless && a.band) {
      push(SIDE.camera, '대역이 끝까지 살아 있음',
        `${(a.band.cutoffHz / 1000).toFixed(1)}kHz까지 에너지가 있습니다. 손실 압축을 거치지 않았습니다.`);
    }
    if (recompressed(bundle)) {
      const lp = c.facts?.lowpassHz;
      push(SIDE.ai, '비트율보다 좁은 소리',
        `${c.facts?.bitrate ? `${c.facts.bitrate}kbps로 저장돼 있는데 ` : ''}실제 소리는 ${(a.band.cutoffHz / 1000).toFixed(1)}kHz에서 끊깁니다${
          lp ? ` — 인코더는 ${(lp / 1000).toFixed(1)}kHz까지 남기도록 걸려 있었습니다` : ''}. 더 낮은 품질을 한 번 거친 뒤 다시 인코딩된 파일입니다.`);
    }
    if (a.band && a.band.cutoffHz < 15000) {
      push(SIDE.ai, '대역이 일찍 끊김',
        `${(a.band.cutoffHz / 1000).toFixed(1)}kHz에서 끊깁니다. 여러 번 압축된 파일입니다.`);
    }
    if (a.natural) {
      push(SIDE.camera, '눌리지 않은 다이내믹',
        `크레스트 팩터 ${a.level.crestDb.toFixed(1)}dB. 마스터링으로 눌린 음원은 이보다 낮습니다.`);
    }
    if (a.squashed) {
      push(SIDE.unknown, '눌린 마스터',
        `크레스트 팩터 ${a.level.crestDb.toFixed(1)}dB. 상업 음원의 마스터링에서도 나오는 값입니다.`);
    }
    if (a.fakeStereo) {
      push(SIDE.ai, '두 채널이 사실상 같음',
        `상관 ${a.stereo.correlation.toFixed(4)}. 스테레오로 저장했지만 한 소리를 복사한 것입니다.`);
    }
    /* 두 채널이 다른 것은 녹음의 근거가 아닙니다. 편곡한 음원이든 생성한
       음원이든 스테레오로 만들면 상관이 떨어집니다. 예전에는 이것을 녹음 쪽
       근거로 세어, 유튜브에서 받은 비트가 0.881로 통과했습니다.
       가짜 스테레오(한 소리를 복사한 것)만 반대쪽 근거로 씁니다. */
    if (a.wideStereo) {
      push(SIDE.unknown, '두 채널이 서로 다름',
        `상관 ${a.stereo.correlation.toFixed(3)}. 스테레오로 만든 소리입니다 — 녹음인지 아닌지는 이 값으로 알 수 없습니다.`);
    }
    if (a.clipping) {
      push(SIDE.camera, '클리핑',
        `최대치에 붙은 표본이 ${(a.level.clipShare * 100).toFixed(3)}%입니다. 과입력이나 리마스터의 흔적입니다.`);
    }
    if (a.paddingSilence) {
      push(SIDE.unknown, '앞뒤 디지털 무음',
        `정확히 0인 표본이 ${(a.level.zeroShare * 100).toFixed(2)}%입니다. 실제 음원에서도 나오는 패딩입니다.`);
    }
    return rows;
  }

  /* 영상 */
  const s = bundle.frames?.summary || {};
  const n = bundle.frames?.frameCount || 0;
  if ((s.vignetteFrames || 0) > 0) {
    push(SIDE.camera, '비네팅',
      `프레임 ${s.vignetteFrames}/${n}에서 모서리가 어두워집니다. 렌즈를 거친 빛의 흔적입니다.`);
  }
  if ((s.caFrames || 0) > 0) {
    push(SIDE.camera, '색수차',
      `프레임 ${s.caFrames}/${n}에서 색이 ${s.caShiftPx.toFixed(2)}화소 어긋납니다. 유리를 통과한 빛에서만 생깁니다.`);
  }
  if (n > 0 && (s.noOpticalTrace || 0) >= n) {
    push(SIDE.unknown, '광학 흔적을 찾지 못함',
      `프레임 ${n}장 모두에서 비네팅과 색수차를 찾지 못했습니다. 휴대폰 보정과 압축으로도 사라집니다.`);
  }
  if ((s.clipFrames || 0) >= n && n > 0) {
    push(SIDE.camera, '하이라이트 날림',
      `밝은 부분이 흰색으로 눌렸습니다(${(s.clipWhite * 100).toFixed(3)}%). 실제 빛에서 생깁니다.`);
  }
  /* 편집한 영상은 전부 여기 걸립니다. "다시 저장됐다"까지가 사실이고,
     생성물이라는 뜻이 아닙니다. 판단 보류로 둡니다. */
  if ((s.recompressed || 0) > 0) {
    push(SIDE.unknown, '두 번 인코딩된 격자',
      `프레임 ${s.recompressed}장에서 어긋난 압축 격자가 겹칩니다. 편집이나 변환을 거쳐 다시 저장된 파일입니다 — 촬영하지 않았다는 뜻은 아닙니다.`);
  }
  if ((s.noiseRising || 0) > 0 && (s.noiseRising || 0) >= Math.ceil(n / 2)) {
    push(SIDE.camera, '밝을수록 커지는 노이즈',
      `프레임 ${s.noiseRising}/${n}에서 밝은 구간일수록 노이즈가 큽니다(상관 ${s.noiseCorr.toFixed(2)}). 빛이 알갱이로 도착해서 생기는 곡선이라 센서를 지난 그림에만 남습니다.`);
  } else if ((s.noiseInverted || 0) >= Math.ceil(n / 2)) {
    push(SIDE.unknown, '뒤집힌 노이즈 곡선',
      `밝은 구간일수록 노이즈가 줄어듭니다(상관 ${s.noiseCorr.toFixed(2)}). HDR·노이즈 제거를 거친 실제 영상에서도 생깁니다.`);
  } else if ((s.noiseFrames || 0) > 0) {
    push(SIDE.unknown, '노이즈가 밝기와 무관',
      `상관 ${s.noiseCorr != null ? s.noiseCorr.toFixed(2) : '—'}, 퍼짐 ${s.noiseSpread != null ? s.noiseSpread.toFixed(2) : '—'}. 균일하게 얹은 그레인도, 강한 노이즈 제거를 거친 실제 영상도 이렇게 나옵니다.`);
  } else {
    push(SIDE.unknown, '노이즈를 재지 못함',
      '잴 만한 구간이 모자랐습니다. 화면이 지나치게 매끈하거나 어두우면 이렇게 됩니다.');
  }
  if (s.alpha != null && s.alphaNatural === 0 && n > 0) {
    push(SIDE.unknown, '주파수 감쇠가 자연 범위 밖',
      `기울기 ${s.alpha.toFixed(2)}. 압축으로 뭉개졌을 때도 이렇게 나옵니다.`);
  }
  return rows;
}

/* ── 판정 ──────────────────────────────────────────── */

const HEADLINE = {
  [VERDICT.PASS]: {
    video: '이 영상은 카메라로 촬영된 것으로 보입니다',
    audio: '이 소리는 마이크로 녹음된 것으로 보입니다',
  },
  [VERDICT.HOLD]: {
    video: '촬영 흔적이 남아 있지 않습니다',
    audio: '녹음 흔적이 남아 있지 않습니다',
  },
  [VERDICT.INSUFFICIENT]: {
    video: '이 파일로는 판정할 수 없습니다',
    audio: '이 파일로는 판정할 수 없습니다',
  },
  [VERDICT.DECLARED_AI]: {
    video: '이 파일은 스스로 AI 생성물이라고 기록하고 있습니다',
    audio: '이 파일은 스스로 AI 생성물이라고 기록하고 있습니다',
  },
};

/**
 * 등급을 냅니다. 사진과 같은 문턱을 씁니다 — 자동 검증은 3등급까지입니다.
 *
 * 통과 조건
 *   1. 파일이 스스로 AI라고 적지 않았고
 *   2. 기기·녹음 기록이 남아 있으며 (없으면 발급하지 않습니다)
 *   3. 영상은 촬영 쪽 근거 1건·환산 수치 50% 이상,
 *      소리는 녹음 쪽 근거 2건·환산 수치 60% 이상이며
 *
 * 이 넷을 모두 넘어야 3등급입니다. 하나라도 걸리면 보류입니다.
 * 보류는 "AI"가 아니라 "자동으로는 못 가렸다"는 뜻입니다.
 *
 * 2번을 넣은 이유 — 실측에서 출처를 알 수 없는 mp3가 3등급을 받았습니다.
 * 방 소리, 다이내믹, 스테레오 상관은 실제 음원이면 대부분 통과하지만,
 * 잘 만든 생성물도 통과할 수 있는 값입니다. 사진에서 촬영 정보(제조사·모델)가
 * 없으면 발급하지 않는 것과 같은 자리이므로 같은 규칙을 둡니다.
 */
export const MEDIA_GATE = {
  // 영상은 기기 기록 한 건만 남는 경우가 흔합니다. 소리는 별도 녹음기 기록이
  // 상대적으로 잘 남아 기존 문턱을 유지합니다.
  videoSigns: 1,
  videoTrace: 50,
  signs: 2,
  trace: 60,
  requireRecord: true,
};

export function gradeMedia(bundle) {
  const kind = bundle.kind === 'audio' ? 'audio' : 'video';
  const score = mediaScore(bundle);
  const signals = mediaSignals(bundle);
  const cameraSide = signals.filter((r) => r.side === SIDE.camera).length;
  const aiSide = signals.filter((r) => r.side === SIDE.ai).length;
  const requiredSigns = kind === 'video' ? MEDIA_GATE.videoSigns : MEDIA_GATE.signs;
  const requiredTrace = kind === 'video' ? MEDIA_GATE.videoTrace : MEDIA_GATE.trace;

  const blockers = [];
  /* 변환 도구만 적혀 있고 기기 기록이 없는 파일 — 유튜브에서 받았거나 다시
     인코딩한 것입니다. 잴 것이 지워진 뒤라 무엇을 재도 같은 답이 나옵니다.
     그 사실을 제목에서부터 말해 줘야 다음에 무엇을 하면 되는지 압니다. */
  /* LAME은 mp3를 만든 인코더입니다. mp3라면 당연히 적혀 있으므로 그것만으로
     "다시 만든 파일"이라고 하면 처음 내보낸 파일까지 그렇게 됩니다.
     변환 도구가 따로 적혀 있거나, 담긴 소리가 실제로 좁아져 있어야 합니다. */
  const transcoded = (bundle.container?.muxer && bundle.container.muxer !== 'LAME (MP3)')
    || recompressed(bundle);
  const remade = Boolean(transcoded) && (bundle.container?.cameraSigns?.length || 0) === 0;
  /* 녹음 기록이 들어갈 자리가 아예 없는 형식 — mp3로 받으면 여기서 멈춥니다.
     "녹음 흔적이 없다"가 아니라 "이 파일로는 가릴 수 없다"가 사실입니다. */
  const noRecord = (bundle.container?.cameraSigns?.length || 0) === 0;
  const noRecordSlot = kind === 'audio' && noRecord
    && !RECORD_SLOT.test(bundle.container?.format || '');
  /* 짧은 세로 영상은 메신저·갤러리를 거치며 기기 기록이 사라지는 일이
     흔합니다. 그 경우에도 비네팅이나 색수차처럼 실제로 검출된 촬영 흔적이
     하나 있고, 환산 수치가 영상 문턱을 넘으면 통과시킵니다. 노이즈 곡선은
     HDR과 노이즈 제거에 쉽게 뒤집혀 둘을 모두 요구하면 실제 영상이 탈락합니다.
     소리에는 같은 물리 근거가 없어 이 완화 규칙을 적용하지 않습니다. */
  const physicsProof = kind === 'video'
    && cameraSide >= requiredSigns
    && score.trace >= requiredTrace;
  const measurable = kind === 'audio'
    ? Boolean(bundle.sound)
    : Boolean(bundle.frames?.frameCount);

  let verdict;
  if (bundle.container?.declaresAi) {
    verdict = VERDICT.DECLARED_AI;
  } else if (!measurable) {
    verdict = VERDICT.INSUFFICIENT;
    blockers.push({
      title: '측정하지 못했습니다',
      detail: kind === 'audio'
        ? '브라우저가 이 소리를 디코딩하지 못했습니다.'
        : '브라우저가 이 영상에서 프레임을 떼어내지 못했습니다.',
    });
  } else if (noRecordSlot) {
    /* 가릴 수 없다는 답은 같지만 이유가 다릅니다. 다시 만든 파일이면
       그 사실이 더 구체적이라 그쪽을 먼저 적습니다. */
    verdict = VERDICT.INSUFFICIENT;
    blockers.push(remade ? {
      title: '다시 만든 파일입니다',
      detail: `변환 도구 기록만 남아 있습니다${bundle.container?.muxer ? ` — ${bundle.container.muxer}` : ''}. 유튜브에서 받았거나 다시 인코딩한 파일이 이렇습니다. 다시 만드는 과정에서 잴 것이 지워지므로 어떤 파일이든 같은 답이 나옵니다. 만드실 때 나온 원본으로 올려 주십시오.`,
    } : {
      title: '이 형식에는 녹음 기록이 남지 않습니다',
      detail: 'MP3·AAC 같은 형식에는 녹음기나 기기 이름을 적어 두는 자리가 없습니다. 파형만으로는 사람이 녹음한 것인지 만들어 낸 것인지 가릴 수 없어, 어느 쪽으로도 판정하지 않습니다. 만드실 때 나온 WAV나 FLAC 원본이 있으면 그것으로 올려 주십시오 — 녹음 기록이 살아 있으면 3등급까지 바로 나옵니다. 원본이 없으면 상세 검사로 사람이 봅니다.',
    });
  } else if (MEDIA_GATE.requireRecord && noRecord && !physicsProof) {
    verdict = VERDICT.HOLD;
    blockers.push(remade ? {
      title: '다시 만든 파일입니다',
      detail: kind === 'audio'
        ? `변환 도구 기록만 남아 있고 녹음 기기 기록은 없습니다${bundle.container?.muxer ? ` — ${bundle.container.muxer}` : ''}. 유튜브에서 받았거나 다시 인코딩한 파일이 이렇습니다. 다시 만드는 과정에서 잴 것이 지워지므로, 어떤 파일이든 여기서는 같은 답이 나옵니다. 만드실 때 나온 원본으로 올려 주십시오.`
        : `변환 도구 기록만 남아 있고 촬영 기기 기록은 없습니다${bundle.container?.muxer ? ` — ${bundle.container.muxer}` : ''}. 메신저나 편집 도구를 거친 파일입니다. 촬영 원본으로 올려 주십시오.`,
    } : {
      title: '기기 기록이 없습니다',
      detail: kind === 'audio'
        ? '녹음기나 기기 이름이 파일에 적혀 있지 않습니다. 파형만으로는 발급하지 않습니다 — 실제 음원이면 대부분 통과하는 값이라 생성물도 통과할 수 있습니다.'
        : '촬영 기기 기록이 파일에 남아 있지 않습니다. 편집해서 내보내면 지워집니다. 기록이 없어도 실제로 검출된 광학 흔적과 충분한 촬영 흔적 점수가 함께 나오면 그것으로 갈음합니다.',
    });
  } else if (cameraSide >= requiredSigns && score.trace >= requiredTrace) {
    verdict = VERDICT.PASS;
  } else {
    verdict = VERDICT.HOLD;
    if (cameraSide < requiredSigns) {
      blockers.push({
        title: `${kind === 'audio' ? '녹음' : '촬영'} 쪽 근거가 ${cameraSide}건`,
        detail: `${requiredSigns}건 이상이어야 발급합니다. 메신저나 편집을 거치면 흔적이 지워집니다.`,
      });
    }
    if (score.trace < requiredTrace) {
      blockers.push({
        title: `환산 수치 ${score.trace}%`,
        detail: `${requiredTrace}% 이상이어야 발급합니다.`,
      });
    }
  }

  return {
    kind,
    verdict,
    grade: verdict === VERDICT.PASS ? 3 : null,
    headline: holdHeadline(verdict, kind, cameraSide, remade),
    statement: statementFor(verdict, kind, score, cameraSide, aiSide, measurable),
    blockers,
    contradictions: [],
    softSignals: [],
    hints: hintsFor(verdict, kind, bundle),
    score,
    signals,
    cameraSide,
    aiSide,
  };
}

/**
 * 보류 화면의 제목.
 *
 * "흔적이 남아 있지 않습니다"는 근거가 하나도 안 나왔을 때만 맞는 말입니다.
 * 비네팅이 3/3으로 잡힌 영상에까지 그렇게 적으면, 화면 안에서 스스로 모순
 * 됩니다 — 직접 촬영한 뮤직비디오를 올린 분이 그 화면을 봤습니다.
 */
function holdHeadline(verdict, kind, cameraSide, remade) {
  if (verdict !== VERDICT.HOLD) return HEADLINE[verdict][kind];
  const what = kind === 'audio' ? '녹음' : '촬영';
  if (cameraSide >= 1) return `${what} 흔적은 있지만 발급 조건에는 모자랍니다`;
  if (remade) return `다시 만든 파일이라 ${what} 흔적이 남아 있지 않습니다`;
  return HEADLINE[verdict][kind];
}

function statementFor(verdict, kind, score, cameraSide, aiSide, measurable = true) {
  const what = kind === 'audio' ? '녹음' : '촬영';
  if (verdict === VERDICT.DECLARED_AI) {
    return [
      '측정한 값 때문이 아니라 파일에 적힌 것 때문입니다.',
      '이 기록은 만든 쪽이 규격(C2PA)에 따라 남긴 것입니다.',
    ];
  }
  if (verdict === VERDICT.PASS) {
    return [
      `${what} 쪽 근거 ${cameraSide}건, 환산 수치 ${score.trace}%.`,
      '무엇이 담겼는지는 확인하지 않았습니다.',
    ];
  }
  if (verdict === VERDICT.INSUFFICIENT) {
    return measurable
      ? [
        `잴 수 있는 것은 다 쟀습니다 — ${what} 쪽 근거 ${cameraSide}건, 반대쪽 ${aiSide}건.`,
        '그래도 이 파일만으로는 어느 쪽인지 말할 수 없습니다. AI라는 뜻이 아닙니다.',
      ]
      : ['측정을 하지 못해 판정하지 않았습니다.'];
  }
  return [
    `${what} 쪽 근거 ${cameraSide}건, 반대쪽 ${aiSide}건, 환산 수치 ${score.trace}%.`,
    '자동으로 가리지 못했다는 뜻이고, AI라는 단정이 아닙니다.',
  ];
}

function hintsFor(verdict, kind, bundle) {
  const hints = [];
  if (kind === 'video') {
    hints.push('프레임 5장만 봅니다. 중간 한 장면만 바꿔 넣은 영상은 뽑은 자리에 걸리지 않으면 놓칩니다.');
    if (bundle.container?.toolSigns?.length) {
      hints.push('변환 도구를 거치면 촬영 기록이 지워집니다. 카메라에서 바로 꺼낸 원본으로 다시 보시면 결과가 달라집니다.');
    }
  } else {
    hints.push('마스터링을 거친 음원은 녹음 흔적이 많이 지워집니다. 편집 전 원본이 있으면 그쪽이 정확합니다.');
    /* 발매 등록은 녹음의 증거가 아니라 유통 절차의 흔적입니다. 문턱에는
       넣지 않고, 사람이 볼 때 참고가 되도록 여기 적어 둡니다. */
    if (bundle.container?.releaseSigns?.length) {
      hints.push(`발매 등록 기록이 있습니다 — ${bundle.container.releaseSigns.join(' · ')}. 유통 절차를 거친 파일이라는 뜻입니다. 녹음 자체의 증거는 아니지만 상세 검사에서는 이것도 함께 봅니다.`);
    }
    if (bundle.sound && !bundle.sound.rateTrusted) {
      hints.push('이 브라우저가 파일의 표본율로 디코딩하지 못해 대역 한계는 참고만 하십시오.');
    }
  }
  return hints;
}
