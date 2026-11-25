import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Open Design daemon to proxy `/api/*` to when the preview is pointed at a
 * live project (source = "daemon"). Mirrors apps/web/next.config.ts, which
 * rewrites `/api/*`, `/artifacts/*` and `/frames/*` to `OD_PORT`.
 */
const daemonTarget =
  process.env.OD_DAEMON_URL ??
  (process.env.OD_PORT ? `http://127.0.0.1:${process.env.OD_PORT}` : 'http://127.0.0.1:7456');

/**
 * Static "projects" under public/ (the bundled demo, or any folder you drop
 * there) are listed through a generated manifest.json so the StaticSource can
 * enumerate files without a server API.
 */
function staticProjectManifests(dirs: string[]): Plugin {
  const write = (root: string) => {
    for (const dir of dirs) {
      const abs = path.join(root, 'public', dir);
      if (!fs.existsSync(abs)) continue;
      const files: Array<{ name: string; size: number; mtime: number }> = [];
      const walk = (rel: string) => {
        for (const entry of fs.readdirSync(path.join(abs, rel), { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.name === 'manifest.json') continue;
          const childRel = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) walk(childRel);
          else {
            const stat = fs.statSync(path.join(abs, childRel));
            files.push({ name: childRel, size: stat.size, mtime: Math.round(stat.mtimeMs) });
          }
        }
      };
      walk('');
      files.sort((a, b) => a.name.localeCompare(b.name));
      const next = `${JSON.stringify({ files }, null, 2)}\n`;
      const target = path.join(abs, 'manifest.json');
      const prev = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      if (prev !== next) fs.writeFileSync(target, next);
    }
  };
  let root = process.cwd();
  return {
    name: 'od-static-project-manifests',
    configResolved(config) {
      root = config.root;
      write(root);
    },
    configureServer(server) {
      const publicDirs = dirs.map((dir) => path.join(root, 'public', dir));
      server.watcher.add(publicDirs);
      const onChange = (file: string) => {
        if (file.endsWith('manifest.json')) return;
        if (publicDirs.some((dir) => file.startsWith(dir))) write(root);
      };
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
      server.watcher.on('change', onChange);
    },
  };
}

const proxy = {
  '/api': { target: daemonTarget, changeOrigin: true, ws: true },
  '/artifacts': { target: daemonTarget, changeOrigin: true },
  '/frames': { target: daemonTarget, changeOrigin: true },
};

export default defineConfig({
  root: here,
  plugins: [vue(), staticProjectManifests(['demo-project'])],
  define: {
    // vue-i18n esm-bundler feature flags (composition API only).
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
  resolve: {
    // The component library ships as source (workspace package); keep one Vue.
    // (React is only the library's own dependency — the Excalidraw island — so
    // it resolves from the library package; nothing to dedupe for the app.)
    dedupe: ['vue', 'vue-i18n', 'axios', 'ant-design-vue'],
  },
  css: {
    preprocessorOptions: {
      scss: { api: 'modern-compiler' },
    },
  },
  optimizeDeps: {
    // Pre-bundle the heavy CommonJS-ish deps the library pulls in lazily.
    // Deps of the source-distributed library are named through it
    // (`pkg > dep`): with pnpm they are not resolvable from the app root.
    include: [
      'ant-design-vue',
      'ant-design-vue/es/locale/en_US',
      'ant-design-vue/es/locale/zh_CN',
      'axios',
      'pinia',
      'vue-i18n',
      'vue-router',
      '@od-design/preview > dompurify',
      '@od-design/preview > micromark',
      '@od-design/preview > micromark-extension-gfm',
      '@od-design/preview > react',
      '@od-design/preview > react-dom',
      '@od-design/preview > react-dom/client',
      '@od-design/preview > jspdf',
      '@od-design/preview > @excalidraw/excalidraw',
    ],
  },
  server: {
    host: true,
    port: Number(process.env.PORT ?? 5178),
    // Preview iframes run on an opaque origin (sandbox without
    // allow-same-origin), so web fonts / fetches they make against this
    // server arrive with `Origin: null` and need permissive CORS.
    cors: true,
    proxy,
    fs: { allow: [path.resolve(here, '../..')] },
  },
  preview: {
    host: true,
    port: Number(process.env.PORT ?? 5178),
    cors: true,
    proxy,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Excalidraw's own font-subset chunk is ~1.8 MB and only loads with a sketch.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](\.pnpm[\\/])?(ant-design-vue|@ant-design|@ctrl|dayjs|vue-types|scroll-into-view-if-needed|compute-scroll-into-view|@emotion|stylis|resize-observer-polyfill|throttle-debounce|dom-align|dom-scroll-into-view|async-validator|lodash-es)/.test(id)) {
            return 'antdv';
          }
          if (/[\\/]node_modules[\\/](\.pnpm[\\/])?(vue|@vue|vue-router|pinia|vue-i18n|@intlify)[@\\/]/.test(id)) return 'vue';
          return undefined;
        },
      },
    },
  },
});
