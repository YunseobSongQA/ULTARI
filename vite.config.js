import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const page = (...parts) => resolve(root, ...parts);

/**
 * Cloudflare Pages는 `/how` 요청을 `how.html`로 서빙합니다.
 * 개발/프리뷰 서버에서도 같은 경로가 동작하도록 맞춰 둡니다.
 */
function cleanUrls() {
  const rewrite = (req, _res, next) => {
    const [path, query = ''] = (req.url || '/').split('?');
    if (path === '/' || /\.[a-z0-9]+$/i.test(path) || path.startsWith('/@') || path.startsWith('/src/') || path.startsWith('/node_modules/')) {
      return next();
    }
    const bare = path.replace(/\/$/, '');
    for (const candidate of [`${bare}.html`, `${bare}/index.html`]) {
      if (existsSync(resolve(root, candidate.slice(1)))) {
        req.url = query ? `${candidate}?${query}` : candidate;
        break;
      }
    }
    next();
  };
  // 훅이 값을 반환하면 Vite가 그것을 후처리 함수로 취급합니다.
  // `.use()`는 connect 앱을 돌려주므로 반드시 반환하지 않아야 합니다.
  return {
    name: 'ultari-clean-urls',
    configureServer(server) { server.middlewares.use(rewrite); },
    configurePreviewServer(server) { server.middlewares.use(rewrite); },
  };
}

export default defineConfig({
  plugins: [cleanUrls()],
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        index: page('index.html'),
        how: page('how.html'),
        grades: page('grades.html'),
        archive: page('archive.html'),
        roadmap: page('roadmap.html'),
        limits: page('limits.html'),
        privacy: page('privacy.html'),
        admin: page('admin.html'),
        terms: page('terms.html'),
        articles: page('articles/index.html'),
        exifIsNotProof: page('articles/exif-is-not-proof.html'),
        noisePhysics: page('articles/noise-physics.html'),
        lensTraces: page('articles/lens-traces.html'),
      },
    },
  },
});
