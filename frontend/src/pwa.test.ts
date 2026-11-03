// @vitest-environment node
// These are plain files on disk, so the test reads them with Node rather than through a browser DOM.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// These files are what makes the app installable, and a wrong name or a missing
// icon only shows up on a phone, so the test checks the parts the browser needs.
// Vitest runs with the frontend folder as its root, where public/ lives.
const publicDir = path.resolve(process.cwd(), 'public');
const publicPath = (name: string) => path.join(publicDir, name);
const readPublic = (name: string) => readFileSync(publicPath(name), 'utf8');

describe('installable web app', () => {
  const manifest = JSON.parse(readPublic('manifest.webmanifest'));

  it('opens at the overview in a standalone window', () => {
    expect(manifest.name).toBe('Mazzy Money');
    expect(manifest.short_name).toBe('Mazzy Money');
    expect(manifest.start_url).toBe('/overview');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('uses the paper colour for the background and the browser bar', () => {
    expect(manifest.background_color).toBe('#f6f4ef');
    expect(manifest.theme_color).toBe('#f6f4ef');
  });

  it('ships a 192, a 512, and a padded maskable icon', () => {
    const icons: { src: string; sizes: string; purpose?: string }[] = manifest.icons;
    const find = (sizes: string, purpose: string) =>
      icons.find((icon) => icon.sizes === sizes && (icon.purpose ?? 'any') === purpose);

    expect(find('192x192', 'any')?.src).toBe('/icon-192.png');
    expect(find('512x512', 'any')?.src).toBe('/icon-512.png');
    expect(find('512x512', 'maskable')?.src).toBe('/icon-maskable-512.png');

    for (const icon of icons) {
      expect(existsSync(publicPath(icon.src.replace(/^\//, '')))).toBe(true);
    }
    expect(existsSync(publicPath('apple-touch-icon.png'))).toBe(true);
  });

  it('keeps API calls and writes out of the service worker', () => {
    const worker = readPublic('sw.js');

    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("request.method !== 'GET'");
    expect(worker).toMatch(/const CACHE_VERSION = '[^']+'/);
    expect(worker).toMatch(/caches\s*\.keys\(\)/);
  });
});
