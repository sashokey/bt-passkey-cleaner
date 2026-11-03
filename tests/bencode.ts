export type Entry = readonly [string | Buffer, Buffer];
export const string = (value: string | Buffer): Buffer => {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value;
  return Buffer.concat([Buffer.from(bytes.length + ':'), bytes]);
};
export const list = (values: readonly Buffer[]): Buffer => Buffer.concat([Buffer.from('l'), ...values, Buffer.from('e')]);
export const dictionary = (entries: readonly Entry[]): Buffer => Buffer.concat([Buffer.from('d'), ...entries.flatMap(([key, value]) => [string(key), value]), Buffer.from('e')]);
export const info = dictionary([
  ['length', Buffer.from('i1e')], ['name', string('fixture.bin')],
  ['piece length', Buffer.from('i16384e')], ['pieces', string(Buffer.from(Array.from({ length: 20 }, (_, i) => i + 128)))]
]);
export const torrent = (url: string, tiers?: readonly (readonly string[])[], extra: readonly Entry[] = []): Buffer => dictionary([
  ['announce', string(url)], ...(tiers ? [['announce-list', list(tiers.map(tier => list(tier.map(string))))] satisfies Entry] : []),
  ['comment', string('passkey=keep-this-text')], ['info', info], ...extra
]);
export const sourceUrl = 'https://tracker.example/announce?uk=secret&passkey=one&passkey=two&keep=yes';
export const cleanUrl = 'https://tracker.example/announce?keep=yes';
