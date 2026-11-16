import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('dispatches overlay before shell styles and suppresses only its first paint', () => {
  const entry = readFileSync('src/main.tsx', 'utf8');
  expect(entry).toContain('window.location.pathname === "/overlay/vrm"');
  expect(entry).not.toContain('styles.css');
  expect(entry).toContain('import("./shellBootstrap.js")');
  const shell = readFileSync('src/shellBootstrap.tsx', 'utf8');
  expect(shell).toContain('QueryClientProvider');
  expect(shell).toContain('import "./styles.css"');
  const html = readFileSync('index.html', 'utf8');
  expect(html).toContain('html[data-vrm-overlay] #oc-boot-splash{display:none}');
  expect(html).toContain('"kira-aurora"');
});
