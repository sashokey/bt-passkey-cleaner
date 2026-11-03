import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { artifacts, fixture, flush } from './fixture.ts';
import { cleanUrl, sourceUrl, torrent } from './bencode.ts';

for (const script of artifacts) {
  for (const href of ['ftp://dl.kinozal.guru/download.php?id=42', 'https://user:fixture@dl.kinozal.guru/download.php?id=42', 'https://kinozal.guru.example/download.php?id=42', 'https://kinozal.guru/download.php?id=invalid']) {
    void test(script + ': leaves a disallowed download URL untouched: ' + href, async () => {
      const f = await fixture(script, torrent(sourceUrl), { href });
      try {
        const intercepted = await f.page.locator('#download').evaluate(link => {
          let intercepted = true;
          link.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault(); }, { once: true });
          link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return intercepted;
        });
        assert.equal(intercepted, false);
        assert.equal(f.requests(), 0);
        assert.equal(f.downloads.length, 0);
      } finally { await f.close(); }
    });
  }
  void test(script + ': ignores malformed download URLs without a runtime error', async () => {
    const f = await fixture(script, torrent(sourceUrl), { href: 'https://[/download.php?id=42' });
    try {
      assert.deepEqual(f.runtimeErrors, []);
      assert.equal(f.requests(), 0);
    } finally { await f.close(); }
  });
  for (const target of ['missing', 'ambiguous']) {
    void test(script + ': does not install handlers when the download target is ' + target, async () => {
      const f = await fixture(script, torrent(sourceUrl), { missing: target === 'missing', ambiguous: target === 'ambiguous' });
      try {
        if (target === 'missing') await f.page.locator('td.nw').evaluate(cell => {
          const link = document.createElement('a');
          link.id = 'download';
          link.href = '/download.php?id=42';
          cell.append(link);
        });
        const intercepted = await f.page.locator('#download').evaluate(link => {
          let intercepted = true;
          link.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault(); }, { once: true });
          link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return intercepted;
        });
        assert.equal(intercepted, false);
        assert.equal(f.requests(), 0);
        assert.equal(f.downloads.length, 0);
        assert.deepEqual(f.runtimeErrors, []);
      } finally { await f.close(); }
    });
  }
  void test(script + ': initializes a replaced container even when its attributes were cloned', async () => {
    const f = await fixture(script, torrent(sourceUrl));
    try {
      await f.page.locator('.torrent-download-bar').evaluate(table => { table.replaceWith(table.cloneNode(true)); });
      await f.page.addScriptTag({ content: f.code });
      const download = f.page.waitForEvent('download', { timeout: 1500 });
      await f.page.locator('#download img').click();
      const file = await download;
      const path = await file.path();
      assert.ok(path);
      assert.deepEqual(await readFile(path), torrent(cleanUrl));
      assert.equal(f.requests(), 1);
      assert.equal(f.downloads.length, 1);
    } finally { await f.close(); }
  });
  void test(script + ': retains a pending download when only history state changes', async () => {
    const f = await fixture(script, torrent(sourceUrl), { crossOrigin: true, delayedGM: true });
    try {
      await f.page.locator('#download img').click();
      await f.waitGM();
      await f.page.evaluate(() => { history.replaceState({ fixture: true }, ''); });
      await flush(f.page);
      assert.equal(await f.page.locator('html').getAttribute('data-gm-aborts'), '0');
      const download = f.page.waitForEvent('download');
      await f.releaseGM();
      const file = await download;
      const path = await file.path();
      assert.ok(path);
      assert.deepEqual(await readFile(path), torrent(cleanUrl));
      assert.equal(f.downloads.length, 1);
    } finally { await f.close(); }
  });
}
