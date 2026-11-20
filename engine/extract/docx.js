/*
 * Антидефект — этап 7. Чтение DOCX локально (JSZip 3.10.1 из engine/vendor/jszip, без сети).
 *
 * Ограничения (решение от 20.11): файл ≤ 10 МБ; распакованное содержимое ≤ 50 МБ; ≤ 500 элементов архива;
 * степень сжатия каждого элемента ≤ 100:1. При нарушении — отказ с понятным сообщением.
 * Порядок абзацев и таблиц сохраняется (таблица — построчно, ячейки через « | »).
 * Если часть документа прочитать нельзя (надписи, рисунки, внедрённые объекты, колонтитулы с текстом),
 * это сообщается в warnings, и извлечение помечается как неполное (complete:false).
 * Только синтетические данные на этапе 7.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AntidefectDocx = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = { fileBytes: 10 * 1024 * 1024, unpackedBytes: 50 * 1024 * 1024, entries: 500, ratio: 100 };

  class DocxError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const decode = s => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e]);

  /** Разбор word/document.xml в строки текста с сохранением порядка абзацев и таблиц. */
  function documentXmlToText(xml) {
    const lines = [], warnings = [];
    const unread = { 'w:txbxContent': 'надпись (текстовое поле)', 'w:drawing': 'рисунок', 'w:pict': 'рисунок', 'w:object': 'внедрённый объект' };
    const seen = {};
    let para = null, cell = null, row = null, tblDepth = 0, inText = false, skip = 0, fallback = 0;
    const re = /<(\/?)([A-Za-z][\w.-]*:[\w.-]+|[A-Za-z][\w.-]*)((?:\s[^>]*?)?)(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(xml))) {
      if (m[5] !== undefined) { if (inText && !skip && !fallback && para !== null) para += decode(m[5]); continue; }
      const close = m[1] === '/', name = m[2], selfClose = m[4] === '/';
      if (name === 'mc:Fallback') { if (!selfClose) fallback += close ? -1 : 1; continue; }
      if (fallback) continue;
      if (unread[name] && !close) {
        seen[name] = (seen[name] || 0) + 1;
        if (name === 'w:txbxContent' && !selfClose) skip++;
        continue;
      }
      if (name === 'w:txbxContent' && close) { skip = Math.max(0, skip - 1); continue; }
      if (skip) continue;
      switch (name) {
        case 'w:p': if (!close && !selfClose) para = ''; else if (close) { if (cell !== null) cell.push(para); else lines.push(para); para = null; } else if (selfClose) { if (cell !== null) cell.push(''); else lines.push(''); } break;
        case 'w:t': inText = !close && !selfClose; break;
        case 'w:delText': case 'w:instrText': inText = false; break;
        case 'w:tab': if (!close && para !== null) para += '\t'; break;
        case 'w:br': case 'w:cr': if (!close && para !== null) para += '\n'; break;
        case 'w:tbl': tblDepth += close ? -1 : 1; break;
        case 'w:tr': if (!close) row = []; else { if (row) lines.push(row.join(' | ')); row = null; } break;
        case 'w:tc': if (!close) cell = []; else { if (row) row.push(cell.join(' ').trim()); cell = null; } break;
        default: break;
      }
    }
    for (const k of Object.keys(seen)) warnings.push(`не прочитано: ${unread[k]} — ${seen[k]} шт.`);
    return { text: lines.join('\n'), warnings };
  }

  /**
   * readDocx(bytes, {JSZip, limits}) → Promise<{text, warnings[], complete, stats}>
   * bytes — ArrayBuffer | Uint8Array | Buffer.
   */
  async function readDocx(bytes, opts) {
    opts = opts || {};
    const JSZip = opts.JSZip || (typeof self !== 'undefined' && self.JSZip);
    if (!JSZip) throw new DocxError('NO_ZIP', 'Модуль распаковки DOCX не подключён');
    const lim = Object.assign({}, LIMITS, opts.limits || {});
    const size = bytes.byteLength !== undefined ? bytes.byteLength : bytes.length;
    if (!size) throw new DocxError('EMPTY', 'Файл пустой');
    if (size > lim.fileBytes) throw new DocxError('TOO_LARGE', `Файл больше ${Math.round(lim.fileBytes / 1048576)} МБ — не обрабатывается`);
    let zip;
    try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true }); }
    catch (e) { throw new DocxError('CORRUPT', 'Файл повреждён или не является документом DOCX'); }
    const names = Object.keys(zip.files);
    if (names.length > lim.entries) throw new DocxError('TOO_MANY_ENTRIES', `В архиве больше ${lim.entries} элементов — не обрабатывается`);
    let declared = 0;
    for (const n of names) {
      const f = zip.files[n]; if (f.dir) continue;
      const d = f._data || {};
      const un = d.uncompressedSize, co = d.compressedSize;
      if (typeof un !== 'number' || typeof co !== 'number') throw new DocxError('CORRUPT', 'Не удалось проверить размеры элементов архива');
      declared += un;
      if (co > 0 && un / co > lim.ratio) throw new DocxError('RATIO', `Элемент «${n}» сжат сильнее ${lim.ratio}:1 — файл отклонён как небезопасный`);
      if (co === 0 && un > 0) throw new DocxError('RATIO', `Элемент «${n}»: неверные размеры — файл отклонён`);
    }
    if (declared > lim.unpackedBytes) throw new DocxError('TOO_LARGE_UNPACKED', `Распакованное содержимое больше ${Math.round(lim.unpackedBytes / 1048576)} МБ — не обрабатывается`);
    const main = zip.file('word/document.xml');
    if (!main) throw new DocxError('NO_DOCUMENT', 'В файле нет основного текста документа (word/document.xml) — это не DOCX или файл повреждён');
    let xml;
    try { xml = await main.async('string'); }
    catch (e) { throw new DocxError('CORRUPT', 'Основной текст документа не читается (повреждён)'); }
    if (xml.length > lim.unpackedBytes) throw new DocxError('TOO_LARGE_UNPACKED', 'Текст документа слишком большой');
    if (!/<w:body[\s>]/.test(xml)) throw new DocxError('CORRUPT', 'Основной текст документа повреждён (нет тела документа)');
    const r = documentXmlToText(xml);
    const warnings = r.warnings.slice();
    for (const n of names) {
      if (/^word\/(header|footer)\d*\.xml$/.test(n)) {
        const x = await zip.file(n).async('string');
        if (/<w:t[\s>][^<]*\S/.test(x)) warnings.push(`не прочитано: колонтитул (${n.slice(5)})`);
      }
      if (/^word\/(footnotes|endnotes|comments)\.xml$/.test(n)) {
        const x = await zip.file(n).async('string');
        const texts = (x.match(/<w:t[\s>][^<]*/g) || []).filter(t => /\S/.test(t.replace(/<w:t[^>]*>/, '')));
        if (texts.length) warnings.push(`не прочитано: ${{ footnotes: 'сноски', endnotes: 'концевые сноски', comments: 'примечания рецензента' }[n.slice(5, -4)]}`);
      }
    }
    return { text: r.text, warnings, complete: warnings.length === 0, stats: { bytes: size, entries: names.length, declared_unpacked: declared } };
  }

  return { readDocx, documentXmlToText, LIMITS, DocxError };
}));
