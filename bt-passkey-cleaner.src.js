// ==UserScript==
// @name         Кинозал — torrent без ключа аккаунта
// @namespace    kinozal-torrent-cleaner
// @version      1.0.2
// @homepageURL  https://github.com/sashokey/bt-passkey-cleaner
// @updateURL    https://raw.githubusercontent.com/sashokey/bt-passkey-cleaner/master/bt-passkey-cleaner.user.js
// @downloadURL  https://raw.githubusercontent.com/sashokey/bt-passkey-cleaner/master/bt-passkey-cleaner.user.js
// @description  Удаляет uk и passkey из адресов трекеров перед сохранением .torrent, сохраняя хеш раздачи.
// @match        *://kinozal.guru/details.php*
// @connect      dl.kinozal.guru
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @run-at       document-end
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  const invalid = () => { throw new Error('Некорректный torrent-файл. Проверьте вход в аккаунт и повторите скачивание.'); };

  function decode(bytes) {
    let position = 0;
    function read(depth = 0) {
      if (depth > 64 || position >= bytes.length) invalid();
      const start = position, type = bytes[position++];
      let value;
      if (type === 100 || type === 108) {
        value = type === 100 ? new Map() : [];
        while (bytes[position] !== 101) {
          if (type === 108) value.push(read(depth + 1));
          else {
            const key = read(depth + 1);
            if (!(key.value instanceof Uint8Array)) invalid();
            const name = decoder.decode(key.value);
            if (value.has(name)) invalid();
            value.set(name, read(depth + 1));
          }
        }
        position++;
      } else if (type === 105) {
        const end = bytes.indexOf(101, position);
        if (end < 0) invalid();
        value = decoder.decode(bytes.subarray(position, end));
        if (!/^(0|-?[1-9]\d*)$/.test(value)) invalid();
        position = end + 1;
      } else if (type >= 48 && type <= 57) {
        const colon = bytes.indexOf(58, start);
        if (colon < 0) invalid();
        const text = decoder.decode(bytes.subarray(start, colon));
        if (!/^(0|[1-9]\d*)$/.test(text)) invalid();
        const length = Number(text);
        position = colon + 1;
        if (!Number.isSafeInteger(length) || length > bytes.length - position) invalid();
        value = bytes.subarray(position, position + length);
        position += length;
      } else invalid();
      return { start, end: position, type, value };
    }
    const root = read();
    if (position !== bytes.length || root.type !== 100 || root.value.get('info')?.type !== 100) invalid();
    return root;
  }

  function cleanTorrent(input) {
    const bytes = new Uint8Array(input), root = decode(bytes), replacements = [];
    let removed = 0;
    function clean(node) {
      if (node.type === 108) { node.value.forEach(clean); return; }
      if (!(node.value instanceof Uint8Array)) invalid();
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
        replacements.push({ ...node, prefix: encoder.encode(content.length + ':'), content });
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
    if (before.end - before.start !== after.end - after.start || !bytes.subarray(before.start, before.end).every((byte, index) => byte === output[after.start + index])) {
      throw new Error('Проверка раздачи не пройдена. Файл не сохранён.');
    }
    return { bytes: output, removed };
  }

  const links = [...document.querySelectorAll('a[href*="/download.php?"]')].filter(link => {
    const url = new URL(link.href);
    return url.hostname === 'dl.kinozal.guru' && url.pathname === '/download.php' && /^\d+$/.test(url.searchParams.get('id') || '');
  });
  if (links.length !== 1) return;
  const container = links[0].closest('table');
  if (!container || container.dataset.kinozalTorrentCleaner) return;
  container.dataset.kinozalTorrentCleaner = '1';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.style.cssText = 'display:block;max-width:210px;margin-top:5px;font-size:12px;white-space:normal;color:#245b2b';
  status.textContent = 'Очистка ключа аккаунта включена';
  links[0].after(status);
  links[0].title = 'Скачать torrent без ключа аккаунта';
  let busy = false;

  async function download(event) {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target.closest?.('a[href*="/download.php?"]');
    if (!link || !container.contains(link)) return;
    const url = new URL(link.href);
    if (url.hostname !== 'dl.kinozal.guru' || url.pathname !== '/download.php' || !/^\d+$/.test(url.searchParams.get('id') || '')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    if (!status.isConnected) link.after(status);
    busy = true;
    link.setAttribute('aria-busy', 'true');
    status.style.color = '#245b2b';
    status.textContent = 'Получение и очистка файла…';
    try {
      const response = await new Promise((resolve, reject) => GM_xmlhttpRequest({
        method: 'GET',
        url: url.href,
        responseType: 'arraybuffer',
        timeout: 30000,
        onload: resolve,
        onerror: () => reject(new Error('Не удалось получить файл. Проверьте доступ к dl.kinozal.guru.')),
        ontimeout: () => reject(new Error('Сайт не ответил за 30 секунд. Повторите скачивание.')),
        onabort: () => reject(new Error('Получение файла отменено.'))
      }));
      if (response.status !== 200) throw new Error('Сайт вернул ошибку HTTP ' + response.status + '. Проверьте вход в аккаунт.');
      const result = cleanTorrent(response.response);
      await new Promise((resolve, reject) => GM_download({
        url: new Blob([result.bytes], { type: 'application/x-bittorrent' }),
        name: 'bt-id' + url.searchParams.get('id') + '-clean.torrent',
        saveAs: false,
        onload: resolve,
        onerror: () => reject(new Error('Файл не сохранён. Разрешите скачивания и расширение .torrent в Tampermonkey; нужна версия 5.4.6226 или новее.')),
        ontimeout: () => reject(new Error('Истекло время сохранения файла. Повторите скачивание.'))
      }));
      status.textContent = result.removed ? 'Сохранено без ключа аккаунта' : 'Сохранено: uk и passkey отсутствуют';
    } catch (error) {
      status.style.color = '#a12323';
      status.textContent = error instanceof Error && !(error instanceof TypeError) ? error.message : 'Не удалось обработать файл. Проверьте вход в аккаунт и обновите Tampermonkey.';
    } finally {
      busy = false;
      link.removeAttribute('aria-busy');
    }
  }
  container.addEventListener('click', download, true);
  container.addEventListener('auxclick', download, true);
})();
