#!/usr/bin/env python3
"""Тесты правил реестра на синтетических изменениях. python3 -m unittest registry/test_registry.py"""
import copy, json, os, unittest, sys
sys.path.insert(0, os.path.dirname(__file__))
import verify_registry as V

REG = json.load(open(os.path.join(os.path.dirname(__file__), 'protocols-registry.json'), encoding='utf-8'))


def first(reg, result):
    return next(p for p in reg['protocols'] if p['official_check']['result'] == result)


class RegistryRules(unittest.TestCase):
    def test_candidate_registry_is_valid(self):
        errs, _ = V.check(REG)
        self.assertEqual(errs, [])

    def test_all_not_verified_by_default(self):
        # 29 исходных записей + 2 новые редакции (ГИЭ №257, ГрБН №262); статусы и актуальность не меняются от PDF
        self.assertEqual(len(REG['protocols']), 31)
        self.assertTrue(all(p['registry_status'] == 'не проверен' for p in REG['protocols']))
        self.assertTrue(all(p['currency_check']['result'] == 'не_проверена' for p in REG['protocols']))

    def test_active_requires_expert_confirmation(self):
        r = copy.deepcopy(REG)
        first(r, 'подтверждено_выдержкой_официального_сайта')['registry_status'] = 'действует'
        self.assertTrue(any('без подтверждения эксперта' in e for e in V.check(r)[0]))

    def test_active_with_expert_but_without_currency_check_rejected(self):
        r = copy.deepcopy(REG)
        p = first(r, 'подтверждено_выдержкой_официального_сайта')
        p['registry_status'] = 'действует'
        p['expert_confirmation'] = {'by': 'эксперт-1 (синтетический)', 'at': '2026-11-18', 'basis': 'сверено с PDF nrchd.kz'}
        self.assertTrue(any('проверки актуальности' in e for e in V.check(r)[0]))

    def test_active_with_url_expert_and_currency_ok(self):
        r = copy.deepcopy(REG)
        p = first(r, 'подтверждено_выдержкой_официального_сайта')
        p['registry_status'] = 'действует'
        p['expert_confirmation'] = {'by': 'эксперт-1 (синтетический)', 'at': '2026-11-18', 'basis': 'сверено с PDF nrchd.kz'}
        p['currency_check'] = {'result': 'новее_редакции_не_найдено', 'basis': 'синтетическая проверка перечня пересмотров'}
        self.assertEqual(V.check(r)[0], [])

    def test_url_alone_is_not_status(self):
        # у всех официально подтверждённых есть URL, но ни один не «действует»
        self.assertTrue(all(p['registry_status'] == 'не проверен' for p in REG['protocols'] if p['official_check']['url']))

    def test_active_not_allowed_for_secondary_or_missing(self):
        present = {p['official_check']['result'] for p in REG['protocols']} - V.OFFICIAL
        self.assertIn('официальный_источник_найден_файл_не_верифицирован', present)
        for res in sorted(present):
            r = copy.deepcopy(REG)
            p = first(r, res)
            p['registry_status'] = 'действует'
            p['expert_confirmation'] = {'by': 'э', 'at': '2026-11-18', 'basis': 'x'}
            self.assertTrue(any('без официального подтверждения' in e for e in V.check(r)[0]), res)

    def test_replaced_requires_successor_and_end_date(self):
        r = copy.deepcopy(REG)
        p = first(r, 'подтверждено_выдержкой_официального_сайта')
        p['registry_status'] = 'заменён'
        p['expert_confirmation'] = {'by': 'э', 'at': '2026-11-18', 'basis': 'x'}
        self.assertTrue(any('replaced_by' in e for e in V.check(r)[0]))
        p['replaced_by'] = 'синтетическая новая редакция'
        p['valid_to'] = '2026-01-01'
        self.assertEqual(V.check(r)[0], [])

    def test_official_number_mismatch_detected(self):
        r = copy.deepcopy(REG)
        first(r, 'подтверждено_выдержкой_официального_сайта')['official_check']['official_no'] = '999'
        self.assertTrue(any('≠' in e for e in V.check(r)[0]))

    def test_cannot_mark_complete_with_gaps(self):
        r = copy.deepcopy(REG)
        r['completeness']['state'] = 'полный'
        self.assertTrue(any('помечен «полный»' in e for e in V.check(r)[0]))

    def test_coverage_for_engine_reports_gaps(self):
        cov = V.coverage(REG)
        self.assertEqual(cov['total'], 31)
        self.assertGreaterEqual(len(cov['missing_applicable']), 1)   # → модуль не установит «не урегулировано»

    def test_text_change_detected_by_hash(self):
        texts = {p['id']: 'синтетический текст' for p in REG['protocols']}
        self.assertTrue(any('хэш' in e for e in V.check(REG, texts)[0]))

    def test_official_confirmation_needs_url(self):
        r = copy.deepcopy(REG)
        first(r, 'подтверждено_выдержкой_официального_сайта')['official_check']['url'] = None
        self.assertTrue(any('без ссылки' in e for e in V.check(r)[0]))


class Stage4Requirements(unittest.TestCase):
    def test_meeting_number_is_not_id(self):
        from collections import Counter
        c = Counter(p['okk_meeting_no'] for p in REG['protocols'])
        self.assertGreater(c['185'], 1)
        self.assertEqual(len({p['doc_id'] for p in REG['protocols']}), len(REG['protocols']))

    def test_duplicate_doc_id_rejected(self):
        r = copy.deepcopy(REG)
        r['protocols'][1]['doc_id'] = r['protocols'][0]['doc_id']
        self.assertTrue(any('doc_id не уникален' in e for e in V.check(r)[0]))

    def test_protocol_type_required_and_valid(self):
        r = copy.deepcopy(REG)
        r['protocols'][0]['protocol_type'] = 'лечение'
        self.assertTrue(any('тип протокола' in e for e in V.check(r)[0]))
        types = {p['protocol_type'] for p in REG['protocols']}
        self.assertTrue({'диагностика_и_лечение', 'медицинское_вмешательство'} <= types)

    def test_nek_154_is_neonatal_and_not_replaced(self):
        p = next(x for x in REG['protocols'] if x['id'] == 'nek-pediatriya')
        self.assertEqual(p['patient_category'], 'новорожденные')
        self.assertNotEqual(p['registry_status'], 'заменён')
        self.assertIsNone(p['replaced_by'])

    def test_nek_editions_by_care_date(self):
        before = V.editions_for(REG, 'nek', '2022-06-01')
        self.assertEqual([e['approved'] for e in before], ['2021-12-23'])
        after = V.editions_for(REG, 'nek', '2024-01-15')
        self.assertEqual([e['approved'] for e in after], ['2023-07-28', '2021-12-23'])
        self.assertTrue(all(not e['replaced'] and not e['history_verified'] for e in after))

    def test_reviewer_claims_without_url_stay_unconfirmed(self):
        # п. 7: проверяется против всего V.OFFICIAL (не против пустого множества)
        self.assertEqual(len(V.OFFICIAL), 3)
        claims = [p for p in REG['protocols'] if p.get('reviewer_claim')]
        self.assertEqual(len(claims), 9)
        for p in claims:
            self.assertNotIn(p['official_check']['result'], V.OFFICIAL, p['id'])
            self.assertIsNone(p['file_checksum']['value'], p['id'])
        local = [p for p in claims if p['reviewer_claim'].get('local_document_sha256')]
        rest = [p for p in claims if not p['reviewer_claim'].get('local_document_sha256')]
        self.assertEqual((len(local), len(rest)), (8, 1))
        for p in local:
            st = p['reviewer_claim']['status']
            self.assertTrue(st.startswith('предоставлен локальный документ'), p['id'])
            self.assertIn('побайтовое тождество официальному PDF не проверено', st)
            self.assertEqual(p['reviewer_claim']['local_document_sha256'], p['local_pdf']['sha256'])
        g = rest[0]
        self.assertEqual(g['id'], 'gemorragicheskaya-bolezn')
        self.assertTrue(g['reviewer_claim']['status'].startswith('не подтверждено'))
        self.assertNotIn('local_pdf', g)

    def test_reviewer_claim_negative_scenarios(self):
        # неподтверждённое заявление + официальный результат → ошибка
        r = copy.deepcopy(REG)
        p = next(x for x in r['protocols'] if x['id'] == 'gemorragicheskaya-bolezn')
        p['official_check']['result'] = 'подтверждено_официальным_PDF'
        p['official_check']['url'] = 'https://nrchd.kz/synthetic.pdf'
        self.assertTrue(any('заявление проверяющего не подтверждено' in e for e in V.check(r)[0]))
        # ссылка на локальный документ, которого нет
        r = copy.deepcopy(REG)
        p = next(x for x in r['protocols'] if x['id'] == 'rds')
        p['reviewer_claim']['local_document_sha256'] = '0' * 64
        self.assertTrue(any('которого нет в local_pdf' in e for e in V.check(r)[0]))
        # заявлено побайтовое совпадение с официальным PDF без хэша официального файла
        r = copy.deepcopy(REG)
        p = next(x for x in r['protocols'] if x['id'] == 'rds')
        p['reviewer_claim']['status'] = 'локальный файл побайтово совпадает с официальным PDF'
        self.assertTrue(any('побайтовое совпадение' in e for e in V.check(r)[0]))

    def test_nek_154_not_marked_cancelled(self):
        p = next(x for x in REG['protocols'] if x['id'] == 'nek-pediatriya')
        self.assertNotIn(p['registry_status'], ('отменён', 'заменён'))
        self.assertIsNone(p['replaced_by'])

    def test_source_found_but_file_not_verified_is_not_official(self):
        r = copy.deepcopy(REG)
        p = next(x for x in r['protocols'] if x.get('reviewer_claim'))
        p['reviewer_claim']['status'] = 'подтверждено: официальный источник найден'
        p['official_check']['result'] = 'официальный_источник_найден_файл_не_верифицирован'
        p['official_check']['url'] = 'https://nrchd.kz/synthetic.pdf'
        self.assertEqual(V.check(r)[0], [])
        self.assertNotIn(p['official_check']['result'], V.OFFICIAL)
        p['registry_status'] = 'действует'
        p['expert_confirmation'] = {'by': 'э', 'at': '2026-11-18', 'basis': 'x'}
        p['currency_check'] = {'result': 'новее_редакции_не_найдено', 'basis': 'x'}
        self.assertTrue(any('без официального подтверждения' in e for e in V.check(r)[0]))

    def test_file_sha256_must_be_of_file(self):
        r = copy.deepcopy(REG)
        p = r['protocols'][0]
        p['file_checksum']['value'] = p['official_check']['quote_sha256']   # подмена хэшем текста
        p['file_checksum']['source'] = 'текст'
        self.assertTrue(any('хэш файла' in e for e in V.check(r)[0]))

    def test_engine_entry_carries_evidence(self):
        p = next(x for x in REG['protocols'] if x['official_check']['result'] == 'подтверждено_выдержкой_официального_сайта')
        e = V.engine_entry(p)
        self.assertEqual(e['currency_verified'], False)
        self.assertIn('doc_id', e)



P = {p['id']: p for p in REG['protocols']}
LOCAL = [p for p in REG['protocols'] if p.get('local_pdf')]
MANIFEST = json.load(open(os.path.join(os.path.dirname(__file__), 'local-pdfs', 'antidefect_pdf_manifest_31.json'), encoding='utf-8'))


def synthetic_pdf_registry(tmp, content=b'%PDF-1.4 synthetic test file, not a real protocol'):
    """Копия реестра с одной записью local_pdf, указывающей на синтетический файл во временной папке."""
    import hashlib
    r = copy.deepcopy(REG)
    for p in r['protocols']:
        p.pop('local_pdf', None)
        if p.get('reviewer_claim'):
            p['reviewer_claim'].pop('local_document_sha256', None)
    p = r['protocols'][0]
    p['local_pdf'] = copy.deepcopy(P[p['id']]['local_pdf'])
    open(os.path.join(tmp, 'synthetic.pdf'), 'wb').write(content)
    p['local_pdf'].update(file_name='synthetic.pdf', byte_size=len(content), sha256=hashlib.sha256(content).hexdigest())
    return r, p


class LocalPdfRequirements(unittest.TestCase):
    def test_manifest_matches_registry(self):
        rows = [x for x in MANIFEST['files'] if not x['duplicate_of_file']]
        self.assertEqual((MANIFEST['total_files'], len(rows), len(LOCAL)), (31, 29, 29))
        by_sha = {p['local_pdf']['sha256']: p for p in LOCAL}
        for x in rows:
            p = by_sha[x['sha256_pdf']]
            self.assertEqual((p['local_pdf']['file_name'], p['local_pdf']['byte_size'], p['local_pdf']['pages']), (x['file_name'], x['bytes'], x['pages']))
            self.assertEqual((str(p['approval']['no']), p['approval']['date_iso']), (x['approval_number_pdf'], x['approval_date_pdf']))

    def test_rds_three_copies_are_one_document(self):
        rds = [x for x in MANIFEST['files'] if x['registry_id'] == 'rds']
        self.assertEqual(len(rds), 3)
        self.assertEqual(len({x['sha256_pdf'] for x in rds}), 1)
        self.assertEqual(len(P['rds']['local_pdf']['duplicates']), 2)

    def test_local_pdf_is_separate_evidence(self):
        for p in LOCAL:
            lp = p['local_pdf']
            self.assertEqual(lp['origin'], 'user_upload')
            self.assertEqual(lp['identity_with_official_file'], 'не установлено')
            self.assertTrue(lp['verified_header'])
            self.assertNotIn(lp['sha256'], (p.get('text_sha256'), p['official_check'].get('quote_sha256')))
            self.assertEqual(p['registry_status'], 'не проверен')

    def test_types_from_headers(self):
        from collections import Counter
        self.assertEqual(Counter(p['local_pdf']['header']['protocol_type'] for p in LOCAL),
                         Counter({'диагностика_и_лечение': 23, 'медицинское_вмешательство': 5, 'реабилитация': 1}))
        self.assertEqual(P['reanimaciya-nedonoshennyh-detey']['protocol_type'], 'реабилитация')
        self.assertEqual(P['reanimaciya-novorozhdennyh']['protocol_type'], 'медицинское_вмешательство')
        self.assertNotEqual(P['reanimaciya-nedonoshennyh-detey']['doc_id'], P['reanimaciya-novorozhdennyh']['doc_id'])

    def test_wrong_type_rejected(self):
        r = copy.deepcopy(REG)
        p = next(x for x in r['protocols'] if x['id'] == 'reanimaciya-nedonoshennyh-detey')
        p['protocol_type'] = 'медицинское_вмешательство'
        self.assertTrue(any('тип в шапке PDF' in e for e in V.check(r)[0]))

    def test_header_mismatch_rejected(self):
        r = copy.deepcopy(REG)
        p = next(x for x in r['protocols'] if x['id'] == 'gie-2026')
        p['local_pdf']['header']['approval_no'] = '74'
        self.assertTrue(any('не совпадает с записью' in e for e in V.check(r)[0]))

    def test_old_and_new_editions_kept(self):
        for old, new, old_no, new_no in (('gie', 'gie-2026', '74', '257'), ('gemorragicheskaya-bolezn', 'gemorragicheskaya-bolezn-2026', '1', '262')):
            o, n = P[old], P[new]
            self.assertEqual((o['approval']['no'], n['approval']['no']), (old_no, new_no))
            self.assertNotEqual(o['doc_id'], n['doc_id'])
            self.assertEqual(o['topic'], n['topic'])
            for x in (o, n):
                self.assertEqual(x['registry_status'], 'не проверен')
                self.assertIsNone(x['replaced_by'])
                self.assertIsNone(x['valid_to'])
                self.assertFalse(x['edition_history_verified'])
            self.assertTrue(o['historical_unconfirmed'])
            self.assertNotIn('local_pdf', o)
            self.assertEqual(n['related_editions'], [o['doc_id']])
        self.assertEqual([e['approved'] for e in V.editions_for(REG, 'gie', '2025-01-01')], ['2019-10-03'])
        after = V.editions_for(REG, 'gie', '2026-08-01')
        self.assertEqual([e['approved'] for e in after], ['2026-07-01', '2019-10-03'])
        self.assertTrue(all(not e['replaced'] for e in after))

    def test_replacing_old_edition_without_history_rejected(self):
        r = copy.deepcopy(REG)
        p = next(x for x in r['protocols'] if x['id'] == 'gie')
        p['registry_status'] = 'заменён'
        p['expert_confirmation'] = {'by': 'э', 'at': '2026-11-18', 'basis': 'вышла новая редакция'}
        errs = V.check(r)[0]
        self.assertTrue(any('replaced_by' in e for e in errs))
        self.assertTrue(any('без официального подтверждения' in e for e in errs))

    def test_gie_2026_icd_codes(self):
        g = P['gie-2026']
        self.assertTrue(all(c.startswith('P') and 'Р' not in c for c in g['icd']))
        self.assertEqual(g['icd_primary'], 'P91.6')
        self.assertIn('P21', g['icd'])
        self.assertEqual(P['gie']['icd'], ['Р91.0'])   # старая запись не переписана

    def test_hdn_2014_date_question_kept(self):
        o = P['gemorragicheskaya-bolezn']
        self.assertEqual(o['approval']['date_iso'], '2014-01-21')
        q = o['open_questions'][0]
        self.assertEqual((q['secondary_value'], q['decision']), ('2014-01-20', 'не исправлять без оригинального документа'))

    def test_same_number_different_documents(self):
        tens = [p for p in REG['protocols'] if str(p['approval']['no']) == '10']
        self.assertGreaterEqual(len(tens), 5)
        self.assertEqual(len({p['doc_id'] for p in tens}), len(tens))
        self.assertEqual(len({p['approval']['body'] for p in tens}), 2)

    def test_sha_format_and_reuse_rejected(self):
        r = copy.deepcopy(REG)
        p = next(x for x in r['protocols'] if x['id'] == 'cmv')
        p['local_pdf']['sha256'] = p['text_sha256']   # подмена хэшем текста
        self.assertTrue(any('совпадает с хэшем текста' in e for e in V.check(r)[0]))
        r = copy.deepcopy(REG)
        next(x for x in r['protocols'] if x['id'] == 'cmv')['local_pdf']['sha256'] = 'abc'
        self.assertTrue(any('не SHA-256' in e for e in V.check(r)[0]))
        r = copy.deepcopy(REG)
        a, b = (next(x for x in r['protocols'] if x['id'] == k) for k in ('sepsis', 'cmv'))
        a['local_pdf']['sha256'] = b['local_pdf']['sha256']
        self.assertTrue(any('привязан к нескольким записям' in e for e in V.check(r)[0]))

    def test_identity_with_official_requires_official_hash(self):
        r = copy.deepcopy(REG)
        next(x for x in r['protocols'] if x['id'] == 'nek')['local_pdf']['identity_with_official_file'] = 'установлено'
        self.assertTrue(any('тождество официальному файлу' in e for e in V.check(r)[0]))

    def test_local_pdf_does_not_make_active(self):
        # неаутентифицированное подтверждение: локальный PDF + «эксперт» без официального документа
        r = copy.deepcopy(REG)
        p = next(x for x in r['protocols'] if x['id'] == 'rds')
        p['registry_status'] = 'действует'
        p['expert_confirmation'] = {'by': 'э', 'at': '2026-11-18', 'basis': 'локальный PDF'}
        p['currency_check'] = {'result': 'новее_редакции_не_найдено', 'basis': 'x'}
        self.assertTrue(any('без официального подтверждения' in e for e in V.check(r)[0]))
        r = copy.deepcopy(REG)
        p = next(x for x in r['protocols'] if x['id'] == 'rds')
        p['registry_status'] = 'действует'
        p['expert_confirmation'] = {'by': '', 'at': '', 'basis': ''}
        self.assertTrue(any('без подтверждения эксперта' in e for e in V.check(r)[0]))

    def test_pdf_dir_sha_check_synthetic(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            r, p = synthetic_pdf_registry(tmp)
            self.assertEqual([e for e in V.check(r, pdf_dir=tmp)[0] if 'local' in e or 'PDF' in e or 'файл' in e], [])
            open(os.path.join(tmp, 'synthetic.pdf'), 'ab').write(b'x')           # изменён один байт в конце
            errs = V.check(r, pdf_dir=tmp)[0]
            self.assertTrue(any('SHA-256 файла' in e for e in errs))
            self.assertTrue(any('размер файла' in e for e in errs))
            os.remove(os.path.join(tmp, 'synthetic.pdf'))                       # оригинал отсутствует
            self.assertTrue(any('оригинал локального PDF отсутствует' in e for e in V.check(r, pdf_dir=tmp)[0]))

    @unittest.skipUnless(os.environ.get('ANTIDEFECT_PDF_DIR'), 'папка с PDF пользователя не задана (ANTIDEFECT_PDF_DIR)')
    def test_pdf_dir_sha_check_user_files(self):
        self.assertEqual(V.check(REG, pdf_dir=os.environ['ANTIDEFECT_PDF_DIR'])[0], [])

    def test_completeness_not_cleared(self):
        comp = REG['completeness']
        self.assertEqual(comp['state'], 'неполный')
        self.assertTrue(comp.get('applicable_not_in_registry'))
        self.assertTrue(comp.get('not_assessed'))
        self.assertIn('полный перечень P00–P96 не оценён', V.coverage(REG)['missing_applicable'])


if __name__ == '__main__':
    unittest.main()
