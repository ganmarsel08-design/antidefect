#!/usr/bin/env node
// Антидефект — слепое тестирование №1. ПРОГОН неизменной программы (раздел 2, шаг 5 метода 1.1).
// node run.js --repo <рабочая копия> --input <распакованный архив> --freeze <blind1-freeze.json> --out <results-v1>
// Отказ (метод 1.4): изменён комплект оценщика, методика, программа или входные данные; неполный комплект; каталог результатов уже существует.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const C = require('./common.js');
const R = require('./reading.js');
const V = require('./verify.js');

const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
const die = m => { console.error('ОСТАНОВ: ' + m); process.exit(2); };

async function main() {
  const repo = path.resolve(arg('repo')), input = path.resolve(arg('input')), out = path.resolve(arg('out'));
  if (fs.existsSync(out)) die(`каталог результатов уже существует: ${out} (первый прогон выполняется один раз)`);
  let ver;
  try { ver = V.verifyAll({ repo, input, freeze: arg('freeze'), technical: process.argv.includes('--technical-test') }); }
  catch (e) { if (e instanceof V.IntegrityError) die(e.message); throw e; }
  const head = ver.head;
  const X = require(path.join(repo, 'engine/extract/extract.js'));
  const DX = require(path.join(repo, 'engine/extract/docx.js'));
  const JSZip = require(path.join(repo, 'engine/vendor/jszip/jszip.min.js'));
  const gold = JSON.parse(fs.readFileSync(path.join(input, 'blind1-gold.json'), 'utf8'));
  const tz = gold.facility_utc_offset;
  fs.mkdirSync(path.join(out, 'extraction'), { recursive: true });
  for (const h of gold.histories) {
    const p = path.join(input, 'histories', h.file);
    const rec = { id: h.id, file: h.file, format: h.format, extract_version: X.VERSION, tz };
    if (h.format === 'txt') {
      rec.text = C.normText(fs.readFileSync(p, 'utf8'));
      rec.extraction = X.extract(rec.text, { tz, documentId: h.file });
    } else {
      try {
        const r = await DX.readDocx(fs.readFileSync(p), { JSZip });
        rec.text = r.text; rec.docx = { warnings: r.warnings, complete: r.complete, stats: r.stats };
        rec.extraction = X.extract(r.text, { tz, documentId: h.file, warnings: r.warnings });
      } catch (e) { rec.docx = { error: e.code || 'ERROR', message: e.message }; rec.text = ''; rec.extraction = { candidates: [], warnings: [] }; }
      const refp = path.join(input, 'docx-text', h.id + '.json');
      if (fs.existsSync(refp)) {
        const ref = JSON.parse(fs.readFileSync(refp, 'utf8'));
        const t = R.refText(ref);
        rec.ref = { text: t, extraction: X.extract(t, { tz, documentId: h.id + ' (эталон чтения)' }) };
      } else rec.ref = { missing: true };
    }
    fs.writeFileSync(path.join(out, 'extraction', h.id + '.json'), JSON.stringify(rec, null, 1) + '\n');
  }
  const info = { schema: 'blind1-run-1.4', run_at: new Date().toISOString(), node: process.version, base_commit: head, kit_manifest_sha256: ver.manifest_sha256, freeze_sha256: ver.freeze_sha256, technical_test: !ver.freeze_sha256, histories: gold.histories.length };
  fs.writeFileSync(path.join(out, 'run-info.json'), JSON.stringify(info, null, 1) + '\n');
  const outs = V.listFiles(out);
  fs.writeFileSync(path.join(out, 'RUN-MANIFEST.json'), JSON.stringify({ schema: 'blind1-run-manifest-1.4', files: Object.fromEntries(outs.map(f => [f, C.sha256File(path.join(out, f))])) }, null, 1) + '\n');
  for (const f of [...outs, 'RUN-MANIFEST.json']) fs.chmodSync(path.join(out, f), 0o444);
  console.log(`прогон выполнен: ${gold.histories.length} историй → ${out}`);
}
main().catch(e => { console.error(e); process.exit(1); });
