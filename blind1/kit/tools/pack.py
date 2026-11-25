#!/usr/bin/env python3
"""Сборка архива комплекта 1.4 с UTF-8 именами и проверка: каждый файл манифеста присутствует в архиве с верным SHA-256.
python3 -I -B tools/pack.py <выходной .zip> [дополнительные файлы вне манифеста, например TEST-RESULTS-1.4.txt]"""
import hashlib, json, sys, zipfile
from pathlib import Path
KIT = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]); extra = sys.argv[2:]
m = json.loads((KIT / 'freeze' / 'blind1-manifest-1.4.json').read_text(encoding='utf-8'))
names = sorted(m['kit_files']) + ['freeze/blind1-manifest-1.4.json'] + extra
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for n in names:
        zi = zipfile.ZipInfo(n, (2026, 11, 21, 0, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED; zi.external_attr = 0o444 << 16
        z.writestr(zi, (KIT / n).read_bytes())
bad = []
with zipfile.ZipFile(out) as z:
    for info in z.infolist():
        if any(ord(c) > 127 for c in info.filename) and not info.flag_bits & 0x800:
            bad.append('нет флага UTF-8: ' + info.filename)
    got = set(z.namelist())
    for n, h in m['kit_files'].items():
        if n not in got:
            bad.append('нет в архиве: ' + n)
        elif hashlib.sha256(z.read(n)).hexdigest() != h:
            bad.append('хэш не совпадает: ' + n)
    for n in got:
        if '__pycache__' in n or n.endswith('.pyc'):
            bad.append('непереносимый файл: ' + n)
print(json.dumps({'archive': str(out), 'files': len(names), 'sha256': hashlib.sha256(out.read_bytes()).hexdigest(), 'problems': bad}, ensure_ascii=False, indent=1))
sys.exit(1 if bad else 0)
