import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artifacts, fixture, flush } from './fixture.ts';
import { sourceUrl, torrent } from './bencode.ts';

for (const script of artifacts) {
  for (const removal of ['link', 'container', 'ancestor']) {
    void test(script + ': aborts and discards a queued download after removing the ' + removal, async () => {
      const f = await fixture(script, torrent(sourceUrl), { crossOrigin: true, delayedGM: true });
      try {
        await f.page.locator('#download img').click();
        await f.waitGM();
        await f.page.evaluate(kind => { document.querySelector(kind === 'link' ? '#download' : kind === 'container' ? '.torrent-download-bar' : '#release')?.remove(); }, removal);
        await flush(f.page);
        assert.equal(await f.page.locator('html').getAttribute('data-gm-aborts'), '1');
        await f.releaseGM();
        assert.equal(f.downloads.length, 0);
        assert.deepEqual(f.runtimeErrors, []);
      } finally { await f.close(); }
    });
  }
  for (const navigation of ['pushState', 'popstate', 'pagehide']) {
    void test(script + ': refuses queued success after ' + navigation, async () => {
      const f = await fixture(script, torrent(sourceUrl), { crossOrigin: true, delayedGM: true });
      try {
        await f.page.locator('#download img').click();
        await f.waitGM();
        await f.page.evaluate(kind => {
          if (kind === 'pagehide') window.dispatchEvent(new Event('pagehide'));
          else {
            history.pushState(null, '', '/details.php?id=43');
            if (kind === 'popstate') window.dispatchEvent(new PopStateEvent('popstate'));
          }
        }, navigation);
        await f.releaseGM();
        assert.equal(f.downloads.length, 0);
        assert.equal(await f.page.locator('html').getAttribute('data-gm-aborts'), '1');
        assert.deepEqual(f.runtimeErrors, []);
      } finally { await f.close(); }
    });
  }
  void test(script + ': rejects queued success after changing the download URL', async () => {
    const f = await fixture(script, torrent(sourceUrl), { crossOrigin: true, delayedGM: true });
    try {
      await f.page.locator('#download img').click();
      await f.waitGM();
      await f.page.locator('#download').evaluate(link => { link.setAttribute('href', 'https://dl.kinozal.guru/download.php?id=43'); });
      await f.releaseGM();
      assert.equal(f.downloads.length, 0);
      assert.equal(await f.page.locator('html').getAttribute('data-gm-aborts'), '1');
      assert.deepEqual(f.runtimeErrors, []);
    } finally { await f.close(); }
  });
}
