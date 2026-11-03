// ==UserScript==
// @name         BT Passkey Cleaner
// @namespace    bt-passkey-cleaner
// @version      1.0.8
// @homepageURL  https://github.com/sashokey/bt-passkey-cleaner
// @updateURL    https://raw.githubusercontent.com/sashokey/bt-passkey-cleaner/master/bt-passkey-cleaner.user.js
// @downloadURL  https://raw.githubusercontent.com/sashokey/bt-passkey-cleaner/master/bt-passkey-cleaner.user.js
// @description  Violentmonkey: removes uk and passkey from tracker URLs before saving, preserving the info hash.
// @match        *://kinozal.guru/details.php*
// @connect      kinozal.guru
// @connect      dl.kinozal.guru
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// @inject-into  content
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const keyDecoder = new TextDecoder('latin1');
  const encoder = new TextEncoder();
  function invalid(): never { throw new Error('Invalid BT metadata file. Check that you are signed in and try again.'); }
  interface Range { start: number; end: number }
  interface Dictionary extends Range { type: 100; value: Map<string, Node> }
  type Node = Dictionary
    | Range & { type: 108; value: Node[] }
    | Range & { type: 105; value: string }
    | Range & { type: 0; value: Uint8Array<ArrayBuffer> };

  function decode(bytes: Uint8Array<ArrayBuffer>): Dictionary {
    let position = 0;
    function read(depth = 0): Node {
      if (depth > 64 || position >= bytes.length) invalid();
      const start = position, type = bytes[position++];
      if (type === 100) {
        const value = new Map<string, Node>();
        while (bytes[position] !== 101) {
          const key = read(depth + 1);
          if (key.type !== 0) invalid();
          const name = keyDecoder.decode(key.value);
          if (value.has(name)) invalid();
          value.set(name, read(depth + 1));
        }
        position++;
        return { start, end: position, type, value };
      }
      if (type === 108) {
        const value: Node[] = [];
        while (bytes[position] !== 101) value.push(read(depth + 1));
        position++;
        return { start, end: position, type, value };
      }
      if (type === 105) {
        const end = bytes.indexOf(101, position);
        if (end < 0) invalid();
        const value = decoder.decode(bytes.subarray(position, end));
        if (!/^(0|-?[1-9]\d*)$/.test(value)) invalid();
        position = end + 1;
        return { start, end: position, type, value };
      }
      if (type !== undefined && type >= 48 && type <= 57) {
        const colon = bytes.indexOf(58, start);
        if (colon < 0) invalid();
        const text = decoder.decode(bytes.subarray(start, colon));
        if (!/^(0|[1-9]\d*)$/.test(text)) invalid();
        const length = Number(text);
        position = colon + 1;
        if (!Number.isSafeInteger(length) || length > bytes.length - position) invalid();
        const value = bytes.subarray(position, position + length);
        position += length;
        return { start, end: position, type: 0, value };
      }
      return invalid();
    }
    const root = read();
    if (position !== bytes.length || root.type !== 100 || root.value.get('info')?.type !== 100) invalid();
    return root;
  }

  function cleanTorrent(input: ArrayBuffer): { bytes: Uint8Array<ArrayBuffer>; removed: number } {
    const bytes = new Uint8Array(input), root = decode(bytes);
    const replacements: (Range & { prefix: Uint8Array<ArrayBuffer>; content: Uint8Array<ArrayBuffer> })[] = [];
    let removed = 0;
    function clean(node: Node): void {
      if (node.type === 108) { node.value.forEach(clean); return; }
      if (node.type !== 0) invalid();
      const url = new URL(decoder.decode(node.value));
      let changed = false;
      for (const key of new Set(url.searchParams.keys())) {
        if (/^(uk|passkey)$/i.test(key)) {
          removed += url.searchParams.getAll(key).length;
          url.searchParams.delete(key);
          changed = true;
        }
      }
      if (changed) {
        const content = encoder.encode(url.href);
        replacements.push({ start: node.start, end: node.end, prefix: encoder.encode(content.length + ':'), content });
      }
    }
    for (const key of ['announce', 'announce-list']) {
      const node = root.value.get(key);
      if (node) clean(node);
    }
    if (!replacements.length) return { bytes, removed };
    replacements.sort((a, b) => a.start - b.start);
    const output = new Uint8Array(bytes.length + replacements.reduce((n, r) => n + r.prefix.length + r.content.length - (r.end - r.start), 0));
    let cursor = 0, offset = 0;
    for (const item of replacements) {
      const unchanged = bytes.subarray(cursor, item.start);
      output.set(unchanged, offset);
      offset += unchanged.length;
      output.set(item.prefix, offset);
      offset += item.prefix.length;
      output.set(item.content, offset);
      offset += item.content.length;
      cursor = item.end;
    }
    output.set(bytes.subarray(cursor), offset);
    const before = root.value.get('info'), after = decode(output).value.get('info');
    if (!before || !after || before.end - before.start !== after.end - after.start || !bytes.subarray(before.start, before.end).every((byte, index) => byte === output[after.start + index])) {
      throw new Error('File validation failed. Nothing was saved.');
    }
    return { bytes: output, removed };
  }

  interface Response { status: number; response: ArrayBuffer }
  const canceled = (): Error => new Error('Download canceled.');
  const timedOut = (): Error => new Error('The server did not respond within 30 seconds. Try again.');
  async function fetchTorrent(url: URL, signal: AbortSignal): Promise<Response> {
    if (url.origin === location.origin) {
      const controller = new AbortController();
      const abort = (): void => { controller.abort(); };
      signal.addEventListener('abort', abort, { once: true });
      let expired = false;
      const timeout = window.setTimeout(() => { expired = true; controller.abort(); }, 30000);
      try {
        if (signal.aborted) throw canceled();
        const response = await fetch(url.href, { credentials: 'include', signal: controller.signal });
        return { status: response.status, response: await response.arrayBuffer() };
      } catch {
        if (signal.aborted) throw canceled();
        if (expired) throw timedOut();
        throw new Error('Failed to fetch the file using the current login session. Reload the release page and try again.');
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      }
    }
    return new Promise<Response>((resolve, reject) => {
      if (signal.aborted) { reject(canceled()); return; }
      let request: VMScriptXHRControl | undefined;
      const abort = (): void => { request?.abort(); finish(canceled()); };
      const finish = (error?: Error, response?: Response): void => {
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else if (response) resolve(response);
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        request = GM_xmlhttpRequest<unknown>({
          method: 'GET', url: url.href, responseType: 'arraybuffer', timeout: 30000,
          onload: response => {
            if (!Number.isInteger(response.status) || response.status < 0 || response.status > 599 || !(response.response instanceof ArrayBuffer)) {
              finish(new Error('Invalid response from the download host. Nothing was saved.'));
            } else finish(undefined, { status: response.status, response: response.response });
          },
          onerror: () => { finish(new Error('Failed to fetch the file. Check access to the download host.')); },
          ontimeout: () => { finish(timedOut()); },
          onabort: () => { finish(canceled()); }
        });
      } catch {
        finish(new Error('Failed to fetch the file. Check access to the download host.'));
      }
    });
  }

  function downloadURL(link: HTMLAnchorElement): URL | undefined {
    try {
      const url = new URL(link.href);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && ['kinozal.guru', 'dl.kinozal.guru'].includes(url.hostname) && url.pathname === '/download.php' && /^\d+$/.test(url.searchParams.get('id') ?? '')) return url;
    } catch { return undefined; }
    return undefined;
  }
  const links = [...document.querySelectorAll('a[href*="/download.php?"]')].filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement && downloadURL(link) !== undefined);
  if (links.length !== 1) return;
  const container = links[0]?.closest('table');
  if (!container) return;
  const initialized = Symbol.for('bt-passkey-cleaner');
  const registered: unknown = Reflect.get(container, initialized);
  if (registered === true || !Reflect.defineProperty(container, initialized, { value: true })) return;
  interface Operation { controller: AbortController; generation: number }
  let active: Operation | undefined;
  let generation = 0;

  async function download(event: MouseEvent): Promise<void> {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target instanceof Element ? event.target.closest('a[href*="/download.php?"]') : null;
    if (!(link instanceof HTMLAnchorElement) || !container?.contains(link)) return;
    const url = downloadURL(link);
    if (!url) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (active) return;
    const operation = { controller: new AbortController(), generation: ++generation };
    active = operation;
    const route = location.href, href = link.href;
    const current = (): boolean => active === operation && operation.generation === generation && !operation.controller.signal.aborted && link.isConnected && container.isConnected && container.contains(link) && link.href === href && location.href === route;
    const cancel = (): void => {
      if (active === operation) { active = undefined; generation++; }
      operation.controller.abort();
    };
    const routeChange = (): void => { if (location.href !== route) cancel(); };
    const navigation = window.navigation;
    navigation?.addEventListener('currententrychange', routeChange);
    const observer = new MutationObserver(() => { if (!current()) cancel(); });
    const parent = container.parentNode ?? container;
    observer.observe(parent, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    for (let ancestor = parent.parentNode; ancestor; ancestor = ancestor.parentNode) observer.observe(ancestor, { childList: true });
    for (const event of ['pagehide', 'popstate', 'hashchange']) window.addEventListener(event, cancel, { once: true });
    try {
      const response = await fetchTorrent(url, operation.controller.signal);
      if (!current()) return;
      if (response.status !== 200) throw new Error('The server returned HTTP ' + response.status + '. Nothing was saved. Reload the release page and check that ordinary downloads work.');
      const result = cleanTorrent(response.response);
      if (!current()) return;
      const objectUrl = URL.createObjectURL(new Blob([result.bytes], { type: 'application/x-bittorrent' }));
      const save = document.createElement('a');
      save.href = objectUrl;
      save.download = 'bt-id' + url.searchParams.get('id') + '-clean.torrent';
      save.hidden = true;
      try {
        document.body.append(save);
        save.click();
      } finally {
        save.remove();
        window.setTimeout(() => { URL.revokeObjectURL(objectUrl); }, 60000);
      }
    } catch (error) {
      if (current()) console.error('[BT Passkey Cleaner]', error instanceof Error && !(error instanceof TypeError) ? error.message : 'Could not process the file. Check that you are signed in and update Violentmonkey.');
    } finally {
      observer.disconnect();
      navigation?.removeEventListener('currententrychange', routeChange);
      for (const event of ['pagehide', 'popstate', 'hashchange']) window.removeEventListener(event, cancel);
      if (active === operation) active = undefined;
    }
  }
  container.addEventListener('click', event => { void download(event); }, true);
  container.addEventListener('auxclick', event => { if (event instanceof MouseEvent) void download(event); }, true);
})();
