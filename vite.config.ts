import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig({
  plugins: [react(), staticProjectManifests(['demo-project'])],
  server: {
    host: true,
    port: 5178,
    // Preview iframes run on an opaque origin (sandbox without
    // allow-same-origin), so web fonts / fetches they make against this
    // server arrive with `Origin: null` and need permissive CORS.
    cors: true,
    proxy: {
      '/api': { target: daemonTarget, changeOrigin: true, ws: true },
      '/artifacts': { target: daemonTarget, changeOrigin: true },
      '/frames': { target: daemonTarget, changeOrigin: true },
    },
  },
  preview: {
    host: true,
    port: 5178,
    cors: true,
    proxy: {
      '/api': { target: daemonTarget, changeOrigin: true, ws: true },
      '/artifacts': { target: daemonTarget, changeOrigin: true },
      '/frames': { target: daemonTarget, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
  },
});
