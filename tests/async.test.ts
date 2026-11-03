import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { artifacts, fixture, flush, saved } from './fixture.ts';
import { cleanUrl, sourceUrl, torrent } from './bencode.ts';

for (const script of artifacts) {
  for (const removal of ['target', 'ancestor']) {
    void test(script + ': cancels native fetch when its ' + removal + ' is removed', async () => {
      const f = await fixture(script, torrent(sourceUrl), { holdNetwork: true });
      try {
        const aborted = f.page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname === '/download.php', timeout: 1500 });
        await f.page.locator('#download img').click();
        await f.started;
        await f.page.locator(removal === 'target' ? '#download' : '#release').evaluate(target => { target.remove(); });
        f.releaseNetwork();
        await aborted;
        await flush(f.page);
        assert.equal(f.downloads.length, 0);
        assert.deepEqual(f.runtimeErrors, []);
      } finally { await f.close(); }
    });
  }
  for (const crossOrigin of [false, true]) {
    const transport = crossOrigin ? 'GM' : 'native fetch';
    void test(script + ': refuses HTTP failure from ' + transport, async () => {
      const f = await fixture(script, torrent(sourceUrl), { crossOrigin, status: 403 });
      try {
        const error = f.waitError();
        await f.page.locator('#download img').click();
        await error;
        assert.equal(f.downloads.length, 0);
        assert.ok(f.errors[0]?.includes('HTTP 403'));
        assert.deepEqual(f.runtimeErrors, []);
      } finally { await f.close(); }
    });
    void test(script + ': refuses transport failure from ' + transport, async () => {
      const f = await fixture(script, torrent(sourceUrl), { crossOrigin, networkError: true });
      try {
        const error = f.waitError();
        await f.page.locator('#download img').click();
        await error;
        assert.equal(f.downloads.length, 0);
        assert.equal(f.errors.length, 1);
        assert.deepEqual(f.runtimeErrors, []);
      } finally { await f.close(); }
    });
    void test(script + ': times out ' + transport + ' at 30 seconds and permits a fresh attempt', async () => {
      const f = await fixture(script, torrent(sourceUrl), { crossOrigin, holdNetwork: true });
      try {
        await f.page.clock.install();
        await f.page.locator('#download img').click();
        await f.started;
        const error = f.waitError();
        await f.page.clock.fastForward(30000);
        await error;
        assert.equal(f.downloads.length, 0);
        assert.ok(f.errors[0]?.includes('30 seconds'));
        f.releaseNetwork();
        await f.page.clock.resume();
        assert.deepEqual(await saved(f), torrent(cleanUrl));
        assert.deepEqual(f.runtimeErrors, []);
      } finally { await f.close(); }
    });
  }
  void test(script + ': refuses a malformed GM response without saving', async () => {
    const f = await fixture(script, torrent(sourceUrl), { crossOrigin: true, malformedGM: true });
    try {
      const error = f.waitError();
      await f.page.locator('#download img').click();
      await error;
      assert.equal(f.downloads.length, 0);
      assert.equal(f.errors.length, 1);
      assert.deepEqual(f.runtimeErrors, []);
    } finally { await f.close(); }
  });
  void test(script + ': discards an earlier response while the replacement target downloads once', async () => {
    const f = await fixture(script, torrent(sourceUrl), { crossOrigin: true, delayedGM: true });
    try {
      await f.page.locator('#download img').click();
      await f.waitGM();
      await f.page.locator('#download').evaluate(link => { link.replaceWith(link.cloneNode(true)); });
      await flush(f.page);
      await f.page.locator('#download img').click();
      await f.page.waitForFunction(() => document.documentElement.dataset['gmReady'] === '2', undefined, { timeout: 1500 });
      await f.releaseGM();
      assert.equal(f.downloads.length, 0);
      const download = f.page.waitForEvent('download');
      await f.releaseGM();
      const file = await download;
      const path = await file.path();
      assert.ok(path);
      assert.deepEqual(await readFile(path), torrent(cleanUrl));
      assert.equal(f.downloads.length, 1);
      assert.equal(f.requests(), 2);
      assert.deepEqual(f.runtimeErrors, []);
    } finally { await f.close(); }
  });
}
