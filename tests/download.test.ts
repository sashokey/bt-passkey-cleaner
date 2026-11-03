import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { artifacts, fixture, saved } from './fixture.ts';
import { cleanUrl, dictionary, info, sourceUrl, string, torrent } from './bencode.ts';
import type { Entry } from './bencode.ts';

for (const script of artifacts) {
  void test(script + ': removes all credential parameters and preserves exact info bytes', async () => {
    const f = await fixture(script, torrent(sourceUrl));
    try {
      const output = await saved(f);
      assert.deepEqual(output, torrent(cleanUrl));
      const start = output.indexOf(Buffer.from('4:info')) + 6;
      assert.deepEqual(output.subarray(start, start + info.length), info);
      assert.equal(createHash('sha1').update(output.subarray(start, start + info.length)).digest('hex'), createHash('sha1').update(info).digest('hex'));
      assert.equal(f.requests(), 1);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
  void test(script + ': cleans every tracker tier while retaining unrelated query names', async () => {
    const first = 'https://tracker.example/announce?UK=one&PassKey=two&passkey_hint=keep';
    const second = 'udp://backup.example:80/announce?passkey=secret&x=1';
    const f = await fixture(script, torrent(first, [[first, second], ['https://other.example/announce']]));
    try {
      assert.deepEqual(await saved(f), torrent('https://tracker.example/announce?passkey_hint=keep', [['https://tracker.example/announce?passkey_hint=keep', 'udp://backup.example:80/announce?x=1'], ['https://other.example/announce']]));
    } finally { await f.close(); }
  });
  void test(script + ': preserves a credential-free torrent byte for byte', async () => {
    const input = torrent('https://tracker.example/announce?keep=%20');
    const f = await fixture(script, input);
    try { assert.deepEqual(await saved(f), input); } finally { await f.close(); }
  });
  void test(script + ': preserves arbitrary binary dictionary keys in piece layers', async () => {
    const root = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 128));
    const layers: Entry[] = [['piece layers', dictionary([[root, string(Buffer.alloc(64, 255))]])]];
    const f = await fixture(script, torrent(sourceUrl, undefined, layers));
    try { assert.deepEqual(await saved(f), torrent(cleanUrl, undefined, layers)); } finally { await f.close(); }
  });
  void test(script + ': downloads through the allowed cross-origin host', async () => {
    const f = await fixture(script, torrent(sourceUrl), { crossOrigin: true });
    try { assert.deepEqual(await saved(f), torrent(cleanUrl)); } finally { await f.close(); }
  });
  void test(script + ': accepts a middle click without leaking the credential-bearing original', async () => {
    const f = await fixture(script, torrent(sourceUrl));
    try {
      assert.deepEqual(await saved(f, 'middle'), torrent(cleanUrl));
      assert.equal(f.requests(), 1);
      assert.equal(f.downloads.length, 1);
    } finally { await f.close(); }
  });
  void test(script + ': repeated initialization keeps one download handler', async () => {
    const f = await fixture(script, torrent(sourceUrl));
    try {
      await f.page.addScriptTag({ content: f.code });
      assert.deepEqual(await saved(f), torrent(cleanUrl));
      assert.equal(f.requests(), 1);
      assert.equal(f.downloads.length, 1);
    } finally { await f.close(); }
  });
  const failures: readonly (readonly [string, Buffer, number])[] = [
    ['HTML login response', Buffer.from('<html>Sign in</html>'), 200],
    ['truncated bencode', Buffer.from('d8:announce'), 200],
    ['duplicate dictionary key', Buffer.from('d4:infod1:ai1e1:ai2eee'), 200],
    ['invalid integer', Buffer.from('d4:infod1:ai-0eee'), 200],
    ['trailing bytes', Buffer.concat([torrent(sourceUrl), Buffer.from('garbage')]), 200],
    ['HTTP failure', torrent(sourceUrl), 403]
  ];
  for (const [name, input, status] of failures) {
    void test(script + ': refuses to save ' + name, async () => {
      const f = await fixture(script, input, { status });
      try {
        const error = f.waitError();
        await f.page.locator('#download').click();
        await error;
        assert.equal(f.downloads.length, 0);
        assert.equal(f.requests(), 1);
      } finally { await f.close(); }
    });
  }
  void test(script + ': recovers after a failed response', async () => {
    const f = await fixture(script, Buffer.from('<html>Sign in</html>'));
    try {
      const error = f.waitError();
      await f.page.locator('#download').click();
      await error;
      await f.page.route('**/download.php?*', route => route.fulfill({ contentType: 'application/x-bittorrent', body: torrent(sourceUrl) }));
      assert.deepEqual(await saved(f), torrent(cleanUrl));
    } finally { await f.close(); }
  });
}
