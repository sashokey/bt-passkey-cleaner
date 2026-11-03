import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { artifacts, fixture, saved } from './fixture.ts';
import { cleanUrl, dictionary, info, sourceUrl, string, torrent } from './bencode.ts';
import type { Entry } from './bencode.ts';

for (const script of artifacts) {
  void test(script + ': removes every credential and preserves the exact info hash', async () => {
    const f = await fixture(script, torrent(sourceUrl));
    try {
      const output = await saved(f);
      assert.deepEqual(output, torrent(cleanUrl));
      const start = output.indexOf(Buffer.from('4:info')) + 6;
      const actualInfo = output.subarray(start, start + info.length);
      assert.deepEqual(actualInfo, info);
      assert.equal(createHash('sha1').update(actualInfo).digest('hex'), createHash('sha1').update(info).digest('hex'));
      assert.ok(f.requestLog[0]?.cookie.includes('fixture-session=active'));
      assert.deepEqual(f.runtimeErrors, []);
    } finally { await f.close(); }
  });
  void test(script + ': cleans all announce-list tiers with case-insensitive exact parameter names', async () => {
    const first = 'https://tracker.example/announce?UK=a&PassKey=b&passkey_hint=keep';
    const second = 'udp://backup.example:80/announce?passkey=secret&x=1';
    const f = await fixture(script, torrent(first, [[first, second], ['https://other.example/announce']]));
    try {
      assert.deepEqual(await saved(f), torrent('https://tracker.example/announce?passkey_hint=keep', [['https://tracker.example/announce?passkey_hint=keep', 'udp://backup.example:80/announce?x=1'], ['https://other.example/announce']]));
    } finally { await f.close(); }
  });
  void test(script + ': retains a credential-free file byte for byte', async () => {
    const input = torrent('https://tracker.example/announce?keep=%20');
    const f = await fixture(script, input);
    try { assert.deepEqual(await saved(f), input); } finally { await f.close(); }
  });
  void test(script + ': accepts binary dictionary keys without rewriting piece layers', async () => {
    const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 128));
    const layers: Entry[] = [['piece layers', dictionary([[key, string(Buffer.alloc(64, 255))]])]];
    const f = await fixture(script, torrent(sourceUrl, undefined, layers));
    try { assert.deepEqual(await saved(f), torrent(cleanUrl, undefined, layers)); } finally { await f.close(); }
  });
  void test(script + ': preserves distinct raw keys that decode to the same replacement character', async () => {
    const layers: Entry[] = [['piece layers', dictionary([[Buffer.from([128]), string('one')], [Buffer.from([129]), string('two')]])]];
    const f = await fixture(script, torrent(sourceUrl, undefined, layers));
    try { assert.deepEqual(await saved(f), torrent(cleanUrl, undefined, layers)); } finally { await f.close(); }
  });
  void test(script + ': rejects duplicate binary keys instead of treating each byte array as a new key', async () => {
    const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 128));
    const layers: Entry[] = [['piece layers', dictionary([[key, string('one')], [key, string('two')]])]];
    const f = await fixture(script, torrent(sourceUrl, undefined, layers));
    try {
      const error = f.waitError();
      await f.page.locator('#download').click();
      await error;
      assert.equal(f.downloads.length, 0);
      assert.equal(f.errors.length, 1);
    } finally { await f.close(); }
  });
  void test(script + ': cleans cross-origin downloads through the granted transport', async () => {
    const f = await fixture(script, torrent(sourceUrl), { crossOrigin: true });
    try {
      assert.deepEqual(await saved(f), torrent(cleanUrl));
      assert.equal(f.requestLog[0]?.url, 'https://dl.kinozal.guru/download.php?id=42');
      assert.equal(f.requestLog[0]?.method, 'GET');
      assert.equal(await f.page.locator('html').getAttribute('data-gm-calls'), '1');
    } finally { await f.close(); }
  });
  void test(script + ': repeated initialization and middle clicks produce one cleaned file', async () => {
    const f = await fixture(script, torrent(sourceUrl));
    try {
      await f.page.addScriptTag({ content: f.code });
      assert.equal(await f.page.locator('#download').evaluate(link => link.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true, cancelable: true }))), true);
      assert.equal(f.downloads.length, 0);
      assert.deepEqual(await saved(f, 'middle'), torrent(cleanUrl));
      assert.equal(f.downloads.length, 1);
      assert.equal(f.requests(), 1);
    } finally { await f.close(); }
  });
  void test(script + ': concurrent clicks save only one cleaned file', async () => {
    const f = await fixture(script, torrent(sourceUrl));
    try {
      const wait = f.page.waitForEvent('download');
      await f.page.locator('#download').evaluate(link => {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      const download = await wait;
      const path = await download.path();
      assert.ok(path);
      assert.deepEqual(await readFile(path), torrent(cleanUrl));
      assert.equal(f.downloads.length, 1);
      assert.equal(f.requests(), 1);
    } finally { await f.close(); }
  });
  const failures: readonly (readonly [string, Buffer, number])[] = [
    ['HTML login pages', Buffer.from('<html>Sign in</html>'), 200],
    ['truncated files', Buffer.from('d8:announce'), 200],
    ['duplicate dictionary keys', Buffer.from('d4:infod1:ai1e1:ai2eee'), 200],
    ['noncanonical integers', Buffer.from('d4:infod1:ai-0eee'), 200],
    ['bytes after the root', Buffer.concat([torrent(sourceUrl), Buffer.from('garbage')]), 200],
    ['HTTP failures', torrent(sourceUrl), 403]
  ];
  for (const [name, input, status] of failures) {
    void test(script + ': refuses ' + name, async () => {
      const f = await fixture(script, input, { status });
      try {
        const error = f.waitError();
        await f.page.locator('#download').click();
        await error;
        assert.equal(f.downloads.length, 0);
        assert.equal(f.errors.length, 1);
        assert.equal(f.requests(), 1);
      } finally { await f.close(); }
    });
  }
}
