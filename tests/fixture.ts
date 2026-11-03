import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before } from 'node:test';
import { chromium } from 'playwright';
import type { Browser, Download, Page } from 'playwright';

let browser: Browser | undefined;
before(async () => { browser = await chromium.launch({ headless: true, args: ['--mute-audio'] }); });
after(async () => { await browser?.close(); });

export const artifacts = ['.build/bt-passkey-cleaner.js', 'bt-passkey-cleaner.user.js'];
export interface FixtureOptions {
  crossOrigin?: boolean;
  href?: string;
  delayedGM?: boolean;
  holdNetwork?: boolean;
  status?: number;
  ambiguous?: boolean;
  missing?: boolean;
  networkError?: boolean;
  malformedGM?: boolean;
}

export async function fixture(script: string, input: Buffer, options: FixtureOptions = {}) {
  assert.ok(browser);
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addCookies([{ name: 'fixture-session', value: 'active', domain: '.kinozal.guru', path: '/' }]);
  const page = await context.newPage();
  const downloads: Download[] = [];
  const errors: string[] = [];
  const runtimeErrors: string[] = [];
  const failedRequests: string[] = [];
  const requestLog: { url: string; method: string; cookie: string }[] = [];
  let requests = 0;
  let releaseNetwork = (): void => {};
  let networkStarted = (): void => {};
  const heldNetwork = new Promise<void>(resolve => { releaseNetwork = resolve; });
  const started = new Promise<void>(resolve => { networkStarted = resolve; });
  page.on('download', download => downloads.push(download));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('[BT Passkey Cleaner]')) errors.push(message.text()); });
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === '/download.php') failedRequests.push(request.failure()?.errorText ?? 'Unknown request failure');
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/download.php') {
      requests++;
      requestLog.push({ url: url.href, method: route.request().method(), cookie: route.request().headers()['cookie'] ?? '' });
      networkStarted();
      if (options.holdNetwork) await heldNetwork;
      if (options.networkError) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({ status: options.status ?? 200, contentType: 'application/x-bittorrent', body: input, headers: { 'Access-Control-Allow-Origin': 'https://kinozal.guru', 'Access-Control-Allow-Credentials': 'true' } }).catch(() => {});
      return;
    }
    if (url.pathname !== '/details.php') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    const href = options.href ?? (options.crossOrigin ? 'https://dl.kinozal.guru/download.php?id=42' : '/download.php?id=42');
    const link = options.missing ? '' : '<a id="download" href="' + href + '" title="Download release"><img src="/pic/dwn_torrent.gif" width="200" height="25" alt=""></a>';
    const second = options.ambiguous ? '<a href="/download.php?id=43">Other</a>' : '';
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><div id="release"><table class="w100p torrent-download-bar"><tbody><tr><td class="nw">' + link + second + '</td><td>Release information</td></tr></tbody></table></div>' });
  });
  await page.goto('https://kinozal.guru/details.php?id=42');
  await page.evaluate(settings => {
    const pending: (() => void)[] = [];
    document.documentElement.dataset['gmAborts'] = '0';
    document.documentElement.dataset['gmCalls'] = '0';
    document.documentElement.dataset['gmReady'] = '0';
    window.addEventListener('fixture-release-gm', () => { pending.shift()?.(); });
    Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
      value: (options: VMScriptGMXHRDetails<unknown>): VMScriptXHRControl => {
        document.documentElement.dataset['gmCalls'] = String(Number(document.documentElement.dataset['gmCalls']) + 1);
        const controller = new AbortController();
        let settled = false;
        const empty: VMScriptResponseObject<unknown> = {
          status: 0, statusText: '', readyState: 4, responseHeaders: '', response: null,
          responseText: undefined, responseXML: null, finalUrl: options.url
        };
        const timer = window.setTimeout(() => {
          settled = true;
          controller.abort();
          options.ontimeout?.(empty);
        }, options.timeout ?? 0);
        void fetch(options.url, { signal: controller.signal, credentials: 'include' }).then(async response => {
          const value = await response.arrayBuffer();
          const result: VMScriptResponseObject<unknown> = {
            status: response.status, statusText: response.statusText, readyState: 4,
            responseHeaders: 'Content-Type: application/x-bittorrent', response: settings.malformedGM ? 'invalid response' : value,
            responseText: undefined, responseXML: null, finalUrl: response.url
          };
          const complete = (): void => {
            settled = true;
            clearTimeout(timer);
            options.onload?.(result);
          };
          if (settings.delayedGM) {
            pending.push(complete);
            document.documentElement.dataset['gmReady'] = String(pending.length);
          } else complete();
        }).catch(() => {
          clearTimeout(timer);
          if (!settled) { settled = true; options.onerror?.(empty); }
        });
        return {
          abort: () => {
            document.documentElement.dataset['gmAborts'] = String(Number(document.documentElement.dataset['gmAborts']) + 1);
            settled = true;
            clearTimeout(timer);
            controller.abort();
            options.onabort?.(empty);
          }
        };
      }
    });
  }, { delayedGM: options.delayedGM ?? false, malformedGM: options.malformedGM ?? false });
  const code = await readFile(new URL('../' + script, import.meta.url), 'utf8');
  await page.addScriptTag({ content: code });
  return {
    page, context, downloads, errors, runtimeErrors, failedRequests, started, code, requestLog,
    requests: () => requests,
    releaseNetwork,
    waitError() { return page.waitForEvent('console', { predicate: message => message.type() === 'error' && message.text().includes('[BT Passkey Cleaner]') }); },
    async releaseGM(): Promise<void> {
      await page.evaluate(() => { window.dispatchEvent(new Event('fixture-release-gm')); });
      await flush(page);
    },
    async waitGM(): Promise<void> {
      await page.waitForFunction(() => document.documentElement.dataset['gmReady'] === '1');
    },
    async close(): Promise<void> { releaseNetwork(); await context.close(); }
  };
}

export async function flush(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); }));
}

export async function saved(f: Awaited<ReturnType<typeof fixture>>, button: 'left' | 'middle' = 'left'): Promise<Buffer> {
  const download = f.page.waitForEvent('download');
  await f.page.locator('#download img').click({ button });
  const file = await download;
  assert.equal(file.suggestedFilename(), 'bt-id42-clean.torrent');
  const path = await file.path();
  assert.ok(path);
  return readFile(path);
}
