/**
 * container.js — 영상·음성 파일이 스스로 밝힌 것을 읽습니다.
 *
 * 사진의 EXIF에 해당하는 자리입니다. 카메라와 녹음기는 파일에 자기 흔적을
 * 남깁니다. MOV라면 제조사와 모델이 `udta`에, 촬영 위치가 `©xyz`에, 노출과
 * 자이로가 `mebx` 트랙에 들어갑니다. WAV라면 녹음기가 `bext`에 기기와 시각을
 * 적습니다. 생성 모델은 그런 것을 적을 이유가 없습니다.
 *
 * 이 모듈은 추측하지 않습니다. 파일에 적힌 것을 옮기고, 없으면 없다고 합니다.
 *
 * 못 하는 것 — 중요합니다
 *   적힌 것은 고칠 수 있고 지울 수 있습니다. 메신저를 거치면 대부분 사라집니다.
 *   그래서 "흔적 있음"은 강한 증거지만 "흔적 없음"은 아무 증거도 아닙니다.
 *   위치는 존재 여부만 봅니다. 좌표는 읽지 않습니다 — 사진과 같은 규칙입니다.
 *
 * DOM을 쓰지 않습니다. 브라우저와 서버(Workers)가 같은 답을 냅니다.
 */

/* ── 바이트 도우미 ──────────────────────────────────── */

const latin1 = (bytes) => {
  let out = '';
  const step = 8192;
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return out;
};

const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

const ascii = (b, i, n) => latin1(b.subarray(i, i + n));

/**
 * 읽을 수 있는 글자만 남깁니다. 태그에는 널 바이트와 제어 문자가 섞입니다.
 * 제어 문자를 정규식에 직접 넣지 않습니다 — 소스 파일에 그 바이트가 박히면
 * 파일이 바이너리로 취급돼 도구가 읽지 못합니다.
 */
const clean = (text, max = 120) => {
  let out = '';
  for (const ch of String(text || '')) {
    const code = ch.codePointAt(0);
    out += (code < 32 || code === 127) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
};

/* ── 파일 종류 ─────────────────────────────────────── */

const FORMATS = [
  { id: 'mp4', kind: 'video', test: (b) => b.length > 12 && ascii(b, 4, 4) === 'ftyp' },
  { id: 'webm', kind: 'video', test: (b) => b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { id: 'wav', kind: 'audio', test: (b) => b.length > 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE' },
  { id: 'flac', kind: 'audio', test: (b) => b.length > 4 && ascii(b, 0, 4) === 'fLaC' },
  { id: 'ogg', kind: 'audio', test: (b) => b.length > 4 && ascii(b, 0, 4) === 'OggS' },
  { id: 'mp3', kind: 'audio', test: (b) => (b.length > 3 && ascii(b, 0, 3) === 'ID3') || (b.length > 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
];

/* MP4 브랜드로 영상과 음성을 가릅니다. M4A는 같은 상자를 쓰는 음성 파일입니다. */
const AUDIO_BRANDS = /^(M4A|M4B|M4P|F4A|F4B)/;

/* ── 생성 도구 ─────────────────────────────────────── */

/**
 * 생성기 이름이 그대로 박히는 자리들.
 * 영상·음악 생성 도구는 대부분 `©too`, `TSSE`, `WritingApp`, C2PA 매니페스트 중
 * 한 곳에 이름을 남깁니다. 여기 없는 도구는 이 목록으로 잡히지 않습니다.
 */
const GENERATORS = [
  { re: /\bSora\b/i, name: 'OpenAI Sora' },
  { re: /Runway(?:ML)?|Gen-?[234]/i, name: 'Runway' },
  { re: /\bPika\b/i, name: 'Pika' },
  { re: /\bKling\b/i, name: 'Kling' },
  { re: /\bLuma\b|Dream ?Machine/i, name: 'Luma Dream Machine' },
  { re: /\bVeo\b|Imagen ?Video/i, name: 'Google Veo' },
  { re: /Stable ?Video|SVD\b/i, name: 'Stable Video Diffusion' },
  { re: /HeyGen|Synthesia|\bD-?ID\b/i, name: '아바타 생성 도구' },
  { re: /\bSuno\b/i, name: 'Suno' },
  { re: /\bUdio\b/i, name: 'Udio' },
  { re: /ElevenLabs|Eleven ?Labs/i, name: 'ElevenLabs' },
  { re: /MusicGen|AudioCraft/i, name: 'Meta MusicGen' },
  { re: /Stable ?Audio/i, name: 'Stable Audio' },
  { re: /Mubert|Soundraw|Boomy|Riffusion/i, name: 'AI 음악 생성 도구' },
  { re: /OpenAI|gpt-image|DALL/i, name: 'OpenAI' },
];

/** 촬영·녹음 기기가 남기는 이름. 있으면 카메라 쪽 근거입니다. */
const DEVICES = [
  { re: /Apple|iPhone|iPad/i, name: 'Apple' },
  { re: /samsung|SM-[A-Z0-9]+/i, name: 'Samsung' },
  { re: /GoPro|HERO\d/i, name: 'GoPro' },
  { re: /DJI|Osmo/i, name: 'DJI' },
  { re: /Canon|Nikon|SONY|FUJIFILM|Panasonic|Olympus|Leica|Sigma|Insta360/i, name: '카메라 제조사' },
  { re: /Xiaomi|Redmi|OPPO|vivo|Pixel|LG-|Motorola|OnePlus/i, name: '휴대폰 제조사' },
  { re: /Zoom [HF]\d|TASCAM|Sound ?Devices|RODE|Zoom Corp/i, name: '녹음기 제조사' },
];

/** 재인코딩 도구. 있으면 원본이 아니라 다시 만든 파일입니다. */
const MUXERS = [
  { re: /Lavf(\d+\.\d+\.\d+)?/i, name: 'FFmpeg (libavformat)' },
  { re: /HandBrake/i, name: 'HandBrake' },
  { re: /x264|x265/i, name: 'x264/x265' },
  { re: /Chrome|Google/i, name: 'Chrome 미디어 인코더' },
  { re: /Lame|LAME\d/i, name: 'LAME (MP3)' },
  { re: /Adobe|Premiere|After ?Effects|Media ?Encoder/i, name: 'Adobe' },
  { re: /Final ?Cut|Compressor|AVFoundation|CoreMedia/i, name: 'Apple 편집·변환' },
  { re: /DaVinci|Resolve/i, name: 'DaVinci Resolve' },
  { re: /CapCut|Kapwing|VLLO|VivaVideo|InShot/i, name: '모바일 편집 앱' },
  { re: /yt-dlp|youtube-dl/i, name: '내려받기 도구' },
  { re: /OBS|Game ?Bar|NVIDIA|ShadowPlay|Xbox/i, name: '화면 녹화 도구' },
];

/* ── MP4 / MOV ──────────────────────────────────────── */

/**
 * 상자를 훑습니다. 촬영 파일은 `moov`를 파일 끝에 두는 경우가 많아
 * 앞과 뒤 두 조각을 따로 받아 각각 훑습니다.
 */
function walkBoxes(bytes, at, end, depth, out) {
  let i = at;
  while (i + 8 <= end) {
    let size = u32(bytes, i);
    const type = ascii(bytes, i + 4, 4);
    let head = 8;
    if (size === 1) {                       // 64비트 크기
      if (i + 16 > end) break;
      const hi = u32(bytes, i + 8);
      const lo = u32(bytes, i + 12);
      size = hi * 4294967296 + lo;
      head = 16;
    } else if (size === 0) {
      size = end - i;                       // 마지막 상자
    }
    if (size < head) break;

    out.push({ type, at: i, head, size, depth, src: bytes });

    // 이 상자들 안에 또 상자가 있습니다. mdat(화소·표본)은 들어가지 않습니다.
    if (/^(moov|trak|mdia|minf|stbl|udta|meta|ilst|edts|dinf|gmhd|tref|mvex|moof|traf)$/.test(type)
      && depth < 8) {
      walkBoxes(bytes, i + head + metaSkip(bytes, i, head, type), Math.min(i + size, end), depth + 1, out);
    }
    if (i + size <= i) break;
    i += size;
  }
}

/**
 * `meta` 상자는 두 모양이 있습니다. ISO 규격은 앞에 버전·플래그 4바이트를 두고,
 * QuickTime(촬영 MOV)은 두지 않습니다. 4바이트를 잘못 건너뛰면 그 안의 `keys`를
 * 못 찾고, 그러면 아이폰 영상의 제조사·모델이 "기록 없음"으로 나옵니다.
 * 그래서 4바이트 뒤에 상자 타입이 보이는지 직접 확인합니다.
 */
const INNER_TYPES = /^(hdlr|keys|ilst|mdta|free|skip|dinf|iloc|pitm|iinf|iref|idat)$/;

function metaSkip(bytes, at, head, type) {
  if (type !== 'meta') return 0;
  const asIs = ascii(bytes, at + head + 4, 4);
  return INNER_TYPES.test(asIs) ? 0 : 4;
}

/** 상자 목록에서 처음 맞는 것을 돌려줍니다. */
const findBox = (boxes, type) => boxes.find((b) => b.type === type) || null;

/** QuickTime 메타데이터 값. 길이·언어 4바이트를 건너뛰고 문자열을 읽습니다. */
function udtaText(bytes, box) {
  const from = box.at + box.head;
  const len = box.size - box.head;
  if (len <= 4) return null;
  // ©xxx 상자는 [길이 2][언어 2][문자열] 또는 [data 상자] 두 모양이 있습니다.
  if (len > 16 && ascii(bytes, from + 4, 4) === 'data') {
    return clean(latin1(bytes.subarray(from + 16, from + len)));
  }
  const n = u16(bytes, from);
  if (n > 0 && n + 4 <= len) return clean(latin1(bytes.subarray(from + 4, from + 4 + n)));
  return clean(latin1(bytes.subarray(from + 4, from + len)));
}

/**
 * QuickTime 메타데이터 keys/ilst.
 *
 * iPhone은 `©mak` 같은 네 글자 상자를 쓰지 않습니다. `keys` 상자에
 * `com.apple.quicktime.make` 같은 이름을 순서대로 적고, `ilst`의 자식 상자
 * 타입을 그 순번(1, 2, 3…)으로 씁니다.
 *
 * 짝을 meta 상자별로 맞춰야 합니다. 촬영 파일은 트랙마다 keys/ilst를 따로
 * 두어서(실측: 한 파일에 keys 7개), 처음 찾은 것끼리 맞추면 이름과 값이
 * 어긋나 제조사가 "기록 없음"으로 나옵니다.
 */
const APPLE_KEYS = {
  'com.apple.quicktime.make': 'make',
  'com.apple.quicktime.model': 'model',
  'com.apple.quicktime.software': 'software',
  'com.apple.quicktime.creationdate': 'createdText',
  'com.apple.quicktime.location.ISO6709': 'gps',
  'com.apple.quicktime.camera.identifier': 'cameraId',
  'com.apple.quicktime.camera.lens_model': 'lens',
  'com.apple.quicktime.camera.focal_length.35mm_equivalent': 'focal35',
  'com.apple.quicktime.camera.framereadouttimeinmicroseconds': 'rollingShutter',
  'com.android.version': 'androidVersion',
  'com.android.capture.fps': 'captureFps',
  'com.android.manufacturer': 'make',
  'com.android.model': 'model',
};

/** keys 상자의 이름 목록. [크기 4][namespace 4][이름] 이 반복됩니다. */
function keyNames(src, box) {
  const names = [];
  let i = box.at + box.head + 8;
  const end = box.at + box.size;
  while (i + 8 <= end) {
    const size = u32(src, i);
    if (size < 8 || i + size > end) break;
    names.push(latin1(src.subarray(i + 8, i + size)));
    i += size;
  }
  return names;
}

/** ilst 상자의 값 목록. 자식 상자의 타입 4바이트가 순번입니다. */
function ilstValues(src, box, names, facts) {
  let i = box.at + box.head;
  const end = box.at + box.size;
  while (i + 8 <= end) {
    const size = u32(src, i);
    if (size < 8 || i + size > end) break;
    const name = names[u32(src, i + 4) - 1];
    const key = name && APPLE_KEYS[name];
    if (key && size > 24 && ascii(src, i + 12, 4) === 'data') {
      const value = clean(latin1(src.subarray(i + 24, i + size)));
      if (key === 'gps') facts.gpsPresent = true;          // 좌표는 읽지 않습니다
      else if (value && !facts[key]) facts[key] = value;
      if (key === 'cameraId' || key === 'rollingShutter' || key === 'lens') facts.appleCameraMeta = true;
      if (key === 'androidVersion' || key === 'captureFps') facts.androidCameraMeta = true;
    }
    i += size;
  }
}

function readKeysIlst(src, boxes, facts) {
  const inside = (box, parent) => box.at > parent.at && box.at < parent.at + parent.size;
  for (const meta of boxes.filter((x) => x.type === 'meta')) {
    const keysBox = boxes.find((x) => x.type === 'keys' && inside(x, meta));
    const ilstBox = boxes.find((x) => x.type === 'ilst' && inside(x, meta));
    if (!keysBox || !ilstBox) continue;
    const names = keyNames(src, keysBox);
    if (names.length) ilstValues(src, ilstBox, names, facts);
  }
}

/* 1904년 1월 1일 기준 초 → ISO. QuickTime의 시간 기준입니다. */
const QT_EPOCH = -2082844800;
const qtTime = (secs) => {
  if (!secs) return null;
  const ms = (secs + QT_EPOCH) * 1000;
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  return year > 1990 && year < 2100 ? d.toISOString() : null;
};

function readMp4(head, tail, size, facts) {
  const boxes = [];
  walkBoxes(head, 0, head.length, 0, boxes);
  const tailBoxes = [];
  let tailMoovAt = -1;
  if (tail && tail.length) {
    /* 뒤 조각은 상자 경계에서 시작하지 않습니다. 'moov' 네 글자는 압축된 화소
       안에도 우연히 나오므로, 앞 4바이트의 크기가 들어맞고 안에 mvhd가 있는
       자리만 진짜 상자로 봅니다. */
    const hay = latin1(tail);
    for (let at = hay.indexOf('moov'); at >= 0; at = hay.indexOf('moov', at + 1)) {
      if (at < 4) continue;
      const boxSize = u32(tail, at - 4);
      if (boxSize < 16 || at - 4 + boxSize > tail.length) continue;
      const probe = [];
      walkBoxes(tail, at - 4, Math.min(at - 4 + boxSize, tail.length), 0, probe);
      if (probe.some((b) => b.type === 'mvhd')) {
        tailMoovAt = at - 4;
        tailBoxes.push(...probe);
        break;
      }
    }
  }
  const all = [...boxes, ...tailBoxes];

  const ftyp = findBox(boxes, 'ftyp');
  if (ftyp) {
    facts.brand = ascii(head, ftyp.at + 8, 4).trim();
    const brands = [];
    for (let i = ftyp.at + 16; i + 4 <= ftyp.at + ftyp.size; i += 4) {
      const b = ascii(head, i, 4).trim();
      if (b) brands.push(b);
    }
    facts.brands = brands;
  }

  const mvhd = findBox(all, 'mvhd');
  if (mvhd) {
    const src = tailBoxes.includes(mvhd) ? tail : head;
    const v = src[mvhd.at + mvhd.head];
    const off = mvhd.at + mvhd.head + 4;
    if (v === 0) {
      facts.createdAt = qtTime(u32(src, off));
      const scale = u32(src, off + 8);
      const dur = u32(src, off + 12);
      if (scale) facts.duration = dur / scale;
    } else {
      facts.createdAt = qtTime(u32(src, off + 4));       // 64비트의 하위 32비트만 씁니다
      const scale = u32(src, off + 16);
      const hi = u32(src, off + 20);
      const lo = u32(src, off + 24);
      if (scale) facts.duration = (hi * 4294967296 + lo) / scale;
    }
  }

  /* 트랙 — 종류와 크기, 코덱 */
  const tracks = [];
  for (const box of all) {
    if (box.type !== 'hdlr') continue;
    const src = tailBoxes.includes(box) ? tail : head;
    const sub = ascii(src, box.at + box.head + 8, 4);
    if (sub === 'vide' || sub === 'soun' || sub === 'meta' || sub === 'sbtl') tracks.push(sub);
  }
  facts.tracks = tracks;
  facts.hasVideo = tracks.includes('vide');
  facts.hasAudio = tracks.includes('soun');
  facts.metaTracks = tracks.filter((t) => t === 'meta').length;

  const tkhd = findBox(all, 'tkhd');
  if (tkhd) {
    const src = tailBoxes.includes(tkhd) ? tail : head;
    const v = src[tkhd.at + tkhd.head];
    const base = tkhd.at + tkhd.head + (v === 0 ? 76 : 88);
    const w = u32(src, base) / 65536;
    const h = u32(src, base + 4) / 65536;
    if (w > 0 && h > 0 && w < 20000 && h < 20000) { facts.width = Math.round(w); facts.height = Math.round(h); }
  }

  const stsd = findBox(all, 'stsd');
  if (stsd) {
    const src = tailBoxes.includes(stsd) ? tail : head;
    facts.codec = ascii(src, stsd.at + stsd.head + 12, 4).replace(/[^\x20-\x7e]/g, '');
  }

  /* udta / ilst — 제조사, 모델, 소프트웨어, 위치 */
  const keys = {
    '©mak': 'make', '©mod': 'model', '©swr': 'software', '©too': 'tool',
    '©xyz': 'gps', '©nam': 'title', '©day': 'date', '©ART': 'artist', '©alb': 'album',
  };
  for (const box of all) {
    const key = keys[box.type];
    if (!key) continue;
    const src = tailBoxes.includes(box) ? tail : head;
    const value = udtaText(src, box);
    if (!value) continue;
    if (key === 'gps') facts.gpsPresent = true;          // 좌표는 읽지 않습니다
    else if (!facts[key]) facts[key] = value;
  }

  /* mebx·gpmd는 stsd 안의 표본 항목이라 상자 훑기로는 안 잡혀 글자로 찾습니다.
     생성 도구가 만들 이유가 없는 트랙입니다. */
  const moovText = tailMoovAt >= 0
    ? latin1(tail.subarray(tailMoovAt, Math.min(tail.length, tailMoovAt + (1 << 22))))
    : latin1(head.subarray(0, Math.min(head.length, 1 << 22)));
  facts.hasMebx = moovText.includes('mebx');
  facts.hasGpmd = moovText.includes('gpmd');

  /* moov 위치는 사실로만 적습니다. 촬영기는 끝에 두지만 FFmpeg 기본값도
     끝에 둡니다 — 카카오톡을 거친 실제 영상에서 그렇게 측정됐습니다.
     이것만으로는 촬영 흔적이라고 할 수 없습니다. */
  const headMoov = boxes.findIndex((b) => b.type === 'moov' && b.depth === 0);
  const headMdat = boxes.findIndex((b) => b.type === 'mdat' && b.depth === 0);
  facts.faststart = headMoov >= 0 && (headMdat < 0 || headMoov < headMdat);
  facts.moovAtEnd = headMoov < 0 && tailMoovAt >= 0;
  facts.uuidBoxes = all.filter((b) => b.type === 'uuid').length;

  readKeysIlst(tailMoovAt >= 0 ? tail : head, tailMoovAt >= 0 ? tailBoxes : boxes, facts);
  return all;
}

/* ── Matroska / WebM ────────────────────────────────── */

function readWebm(head, facts) {
  const hay = latin1(head);
  /* EBML 요소 아이디는 바이트입니다. 소스에 그 바이트를 박지 않고 만들어 씍니다. */
  const tag = (...codes) => String.fromCharCode(...codes);
  const grab = (id) => {
    const at = hay.indexOf(id);
    if (at < 0) return null;
    const len = head[at + id.length] & 0x7f;
    if (!len || len > 100) return null;
    return clean(latin1(head.subarray(at + id.length + 1, at + id.length + 1 + len)));
  };
  facts.muxingApp = grab(tag(0x4d, 0x80));     // MuxingApp
  facts.writingApp = grab(tag(0x57, 0x41));    // WritingApp
  facts.hasVideo = hay.includes('V_');
  facts.hasAudio = hay.includes('A_');
}

/* ── MP3 / ID3 ─────────────────────────────────────── */

const ID3_KEYS = {
  TSSE: 'tool', TENC: 'encoder', TDRC: 'date', TYER: 'date', TIT2: 'title',
  TPE1: 'artist', TALB: 'album', TCON: 'genre', COMM: 'comment', TXXX: 'extra',
  WXXX: 'url', TCOP: 'copyright', TPUB: 'publisher',
};

function readId3(head, facts) {
  if (ascii(head, 0, 3) !== 'ID3') return 0;
  const major = head[3];
  const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
  facts.id3 = `v2.${major}`;
  let i = 10;
  const end = Math.min(10 + size, head.length);
  while (i + 10 <= end) {
    const id = ascii(head, i, 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = major >= 4
      ? ((head[i + 4] & 0x7f) << 21) | ((head[i + 5] & 0x7f) << 14) | ((head[i + 6] & 0x7f) << 7) | (head[i + 7] & 0x7f)
      : u32(head, i + 4);
    if (len <= 0 || i + 10 + len > end) break;
    const key = ID3_KEYS[id];
    if (key) {
      const raw = head.subarray(i + 10, i + 10 + len);
      // 첫 바이트는 인코딩 표시입니다. UTF-16이면 널 바이트를 지웁니다.
      const text = clean(latin1(raw.subarray(1)));
      if (text && !facts[key]) facts[key] = text;
    }
    i += 10 + len;
  }
  return 10 + size;
}

/** MPEG 오디오 프레임 머리 — 비트율과 표본율이 여기 있습니다. */
const MP3_RATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_FREQ = [44100, 48000, 32000];

function readMp3Frame(head, from, facts) {
  for (let i = from; i < Math.min(from + 200000, head.length - 4); i++) {
    if (head[i] !== 0xff || (head[i + 1] & 0xe0) !== 0xe0) continue;
    const layer = (head[i + 1] >> 1) & 3;
    const bitrateIx = (head[i + 2] >> 4) & 0xf;
    const freqIx = (head[i + 2] >> 2) & 3;
    const mode = (head[i + 3] >> 6) & 3;
    if (layer !== 1 || bitrateIx === 0 || bitrateIx === 15 || freqIx === 3) continue;
    facts.bitrate = MP3_RATES[bitrateIx];
    facts.sampleRate = MP3_FREQ[freqIx];
    facts.channelMode = ['스테레오', '조인트 스테레오', '듀얼 모노', '모노'][mode];
    // Xing/Info 헤더가 있으면 가변 비트율로 인코딩된 파일입니다.
    const tag = latin1(head.subarray(i, i + 200));
    facts.vbr = tag.includes('Xing');
    facts.cbrTag = tag.includes('Info');
    const lame = tag.match(/LAME\d[\d.a-z]*/i);
    if (lame) facts.tool = facts.tool || lame[0];
    return;
  }
}

/* ── WAV ───────────────────────────────────────────── */

/**
 * WAV는 녹음기가 가장 많이 적는 형식입니다. `bext`(Broadcast Wave)에는
 * 녹음 기기와 시각, 심지어 편집 이력(CodingHistory)이 들어갑니다.
 * 생성 도구는 이 덩어리를 쓰지 않습니다.
 */
function readWav(head, facts) {
  let i = 12;
  while (i + 8 <= head.length) {
    const id = ascii(head, i, 4);
    const size = u32le(head, i + 4);
    if (size < 0 || i + 8 + size > head.length + 8) break;
    const from = i + 8;
    if (id === 'fmt ') {
      facts.channels = u16(head, from + 2 + 0) === 0 ? head[from + 2] : (head[from + 2] | (head[from + 3] << 8));
      facts.sampleRate = u32le(head, from + 4);
      facts.bitDepth = head[from + 14] | (head[from + 15] << 8);
    } else if (id === 'bext') {
      facts.bext = true;
      facts.description = clean(latin1(head.subarray(from, from + 256)));
      facts.originator = clean(latin1(head.subarray(from + 256, from + 288)));
      facts.codingHistory = clean(latin1(head.subarray(from + 602, from + 1200)), 300);
    } else if (id === 'iXML' || id === 'aXML') {
      facts.ixml = true;
      const xml = latin1(head.subarray(from, from + Math.min(size, 4000)));
      const device = xml.match(/<DEVICE_MODEL_NAME>([^<]+)</i) || xml.match(/<MANUFACTURER>([^<]+)</i);
      if (device) facts.model = facts.model || clean(device[1]);
    } else if (id === 'LIST') {
      const info = latin1(head.subarray(from, from + Math.min(size, 2000)));
      const soft = info.match(/ISFT([\s\S]{4})([\x20-\x7e]{2,60})/);
      if (soft) facts.tool = facts.tool || clean(soft[2]);
    } else if (id === 'ID3 ' || id === 'id3 ') {
      readId3(head.subarray(from, from + size), facts);
    }
    i += 8 + size + (size % 2);
  }
}

/* ── FLAC / OGG ────────────────────────────────────── */

function readVorbisComments(head, facts) {
  const hay = latin1(head);
  const keys = {
    ENCODER: 'tool', TITLE: 'title', ARTIST: 'artist', ALBUM: 'album',
    DATE: 'date', DESCRIPTION: 'comment', COMMENT: 'comment',
  };
  for (const [tag, key] of Object.entries(keys)) {
    const re = new RegExp(`${tag}=([\\x20-\\x7e]{1,200})`, 'i');
    const m = hay.match(re);
    if (m && !facts[key]) facts[key] = clean(m[1]);
  }
}

/* ── 조립 ──────────────────────────────────────────── */

/**
 * 표식을 찾을 영역만 모읍니다. 화소·표본(mdat)은 넣지 않습니다.
 * MP4는 메타데이터 상자에서, 태그 형식은 태그가 있는 앞부분에서 걷습니다.
 */
function metaRegions(head, tail, boxes, format, facts) {
  const CARRY = /^(udta|meta|keys|ilst|uuid|free|skip|ftyp|hdlr|mdta|©...)$/;
  if (format === 'mp4' || format === 'mov' || format === 'm4a') {
    const parts = [];
    for (const box of boxes) {
      if (!CARRY.test(box.type)) continue;
      if (box.size > (1 << 20)) continue;                 // 지나치게 큰 상자는 건너뜁니다
      const src = box.src || null;
      const bytes = src || head;
      if (box.at + box.size > bytes.length) continue;
      parts.push(latin1(bytes.subarray(box.at, box.at + box.size)));
    }
    return parts.join(' ');
  }
  // ID3·RIFF·Vorbis는 태그가 파일 앞에 모여 있습니다.
  const n = Math.min(head.length, 1 << 19);
  return latin1(head.subarray(0, n));
}

const EMPTY = {
  format: 'unknown', kind: 'unknown', facts: {}, cameraSigns: [], toolSigns: [],
  declaresAi: false, generator: null, c2pa: false, markers: [], gpsPresent: false,
};

/**
 * @param {Uint8Array} head 파일 앞 조각
 * @param {Uint8Array|null} tail 파일 뒤 조각 (MOV는 moov가 뒤에 있습니다)
 * @param {number} size 전체 바이트 수
 * @param {string} name 파일 이름 — 형식 판단에만 씁니다
 */
export function scanContainer(head, tail = null, size = 0, name = '') {
  if (!head || head.length < 16) return { ...EMPTY };

  const found = FORMATS.find((f) => f.test(head));
  const out = {
    ...EMPTY,
    format: found ? found.id : 'unknown',
    kind: found ? found.kind : 'unknown',
    facts: { bytes: size || head.length },
    cameraSigns: [],
    toolSigns: [],
    markers: [],
  };
  const facts = out.facts;

  let boxes = [];
  if (out.format === 'mp4') {
    boxes = readMp4(head, tail, size, facts);
    if (AUDIO_BRANDS.test(facts.brand || '') || (facts.hasAudio && !facts.hasVideo)) {
      out.kind = 'audio';
      out.format = 'm4a';
    }
    if ((facts.brand || '').startsWith('qt')) out.format = 'mov';
  } else if (out.format === 'webm') {
    readWebm(head, facts);
  } else if (out.format === 'mp3') {
    const after = readId3(head, facts);
    readMp3Frame(head, after, facts);
  } else if (out.format === 'wav') {
    readWav(head, facts);
  } else if (out.format === 'flac' || out.format === 'ogg') {
    readVorbisComments(head.subarray(0, Math.min(head.length, 1 << 18)), facts);
  }
  if (name && !facts.name) facts.name = name;

  /* 문자열 근거 — 상자 안에 적힌 이름들을 한 번에 봅니다. */
  const hay = [
    facts.make, facts.model, facts.software, facts.tool, facts.encoder,
    facts.muxingApp, facts.writingApp, facts.originator, facts.description,
    facts.codingHistory, facts.comment, facts.extra, facts.title,
  ].filter(Boolean).join(' | ');

  /* 표식은 메타데이터 상자 안에서만 찾습니다.
     압축된 화소를 정규식으로 훑으면 오탐이 납니다 — 실제 촬영 MOV에서
     "아바타 생성 도구"가 잡혔고, 원인은 H.265 데이터에 우연히 들어 있던
     세 글자였습니다. 파일이 스스로 밝힌 자리만 봅니다. */
  const scan = metaRegions(head, tail, boxes, out.format, facts);
  out.c2pa = scan.includes('c2pa') || scan.includes('jumbf') || scan.includes('urn:uuid:c2pa');
  if (out.c2pa) out.markers.push('C2PA 매니페스트');

  const sourceType = scan.match(/digitalsourcetype[/:]([A-Za-z]+)/);
  if (sourceType) {
    out.sourceType = sourceType[1];
    out.markers.push(`digitalSourceType · ${sourceType[1]}`);
  }
  const aiDeclared = /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia/.test(scan);

  const named = GENERATORS.find((g) => g.re.test(`${hay} ${scan}`));
  if (named) {
    out.generator = named.name;
    out.markers.push(`생성기 · ${named.name}`);
  }
  out.declaresAi = Boolean(aiDeclared) || Boolean(named && out.c2pa);

  /* 촬영·녹음 기기 흔적 */
  const device = DEVICES.find((d) => d.re.test(hay));
  if (facts.make || facts.model) {
    out.cameraSigns.push(`기기 기록 · ${[facts.make, facts.model].filter(Boolean).join(' ')}`);
  } else if (device) {
    out.cameraSigns.push(`기기 이름 · ${device.name}`);
  }
  if (facts.gpsPresent) out.cameraSigns.push('촬영 위치 기록 있음 (좌표는 읽지 않습니다)');
  if (facts.hasMebx) out.cameraSigns.push('촬영 메타 트랙 (mebx) — 노출·자이로를 함께 기록');
  if (facts.hasGpmd) out.cameraSigns.push('텔레메트리 트랙 (gpmd)');
  if (facts.appleCameraMeta) out.cameraSigns.push('카메라 식별자·롤링셔터 읽기 시간 기록');
  if (facts.androidCameraMeta) out.cameraSigns.push('안드로이드 촬영 기록');
  if (facts.createdText) out.cameraSigns.push('촬영 시각이 시간대와 함께 기록됨');
  if (facts.bext) out.cameraSigns.push('방송용 WAV 덩어리 (bext)');
  if (facts.ixml) out.cameraSigns.push('녹음기 메타데이터 (iXML)');
  if (facts.bitDepth >= 24) out.cameraSigns.push(`${facts.bitDepth}비트 녹음`);

  /* 재인코딩·편집 도구 흔적 */
  const muxer = MUXERS.find((m) => m.re.test(hay));
  if (muxer) {
    out.muxer = muxer.name;
    out.toolSigns.push(`변환 도구 · ${muxer.name}`);
  }
  if (facts.tool) out.toolSigns.push(`기록된 도구 · ${facts.tool}`);
  if (facts.software && !device) out.toolSigns.push(`기록된 소프트웨어 · ${facts.software}`);

  return out;
}

/**
 * File에서 앞뒤 조각만 읽습니다. 영상은 수백 MB라 전체를 메모리에 올리지 않습니다.
 * moov가 끝에 있는 촬영 파일 때문에 뒤도 읽습니다.
 */
export async function readContainer(file, headBytes = 3 << 20, tailBytes = 6 << 20) {
  try {
    const size = file.size;
    const head = new Uint8Array(await file.slice(0, Math.min(headBytes, size)).arrayBuffer());
    const tail = size > headBytes
      ? new Uint8Array(await file.slice(Math.max(0, size - tailBytes)).arrayBuffer())
      : null;
    return scanContainer(head, tail, size, file.name || '');
  } catch {
    return { ...EMPTY };
  }
}
