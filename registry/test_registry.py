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

    def test_all_29_not_verified_by_default(self):
        self.assertEqual(len(REG['protocols']), 29)
        self.assertTrue(all(p['registry_status'] == 'не проверен' for p in REG['protocols']))

    def test_active_requires_expert_confirmation(self):
        r = copy.deepcopy(REG)
        first(r, 'подтверждено_официальным_PDF')['registry_status'] = 'действует'
        self.assertTrue(any('без подтверждения эксперта' in e for e in V.check(r)[0]))

    def test_active_with_expert_but_without_currency_check_rejected(self):
        r = copy.deepcopy(REG)
        p = first(r, 'подтверждено_официальным_PDF')
        p['registry_status'] = 'действует'
        p['expert_confirmation'] = {'by': 'эксперт-1 (синтетический)', 'at': '2026-11-18', 'basis': 'сверено с PDF nrchd.kz'}
        self.assertTrue(any('проверки актуальности' in e for e in V.check(r)[0]))

    def test_active_with_url_expert_and_currency_ok(self):
        r = copy.deepcopy(REG)
        p = first(r, 'подтверждено_официальным_PDF')
        p['registry_status'] = 'действует'
        p['expert_confirmation'] = {'by': 'эксперт-1 (синтетический)', 'at': '2026-11-18', 'basis': 'сверено с PDF nrchd.kz'}
        p['currency_check'] = {'result': 'новее_редакции_не_найдено', 'basis': 'синтетическая проверка перечня пересмотров'}
        self.assertEqual(V.check(r)[0], [])

    def test_url_alone_is_not_status(self):
        # у всех официально подтверждённых есть URL, но ни один не «действует»
        self.assertTrue(all(p['registry_status'] == 'не проверен' for p in REG['protocols'] if p['official_check']['url']))

    def test_active_not_allowed_for_secondary_or_missing(self):
        for res in ('только_вторичный_источник', 'на_официальном_сайте_не_найдено', 'документ_найден_шапка_не_прочитана'):
            r = copy.deepcopy(REG)
            p = first(r, res)
            p['registry_status'] = 'действует'
            p['expert_confirmation'] = {'by': 'э', 'at': '2026-11-18', 'basis': 'x'}
            self.assertTrue(any('без официального подтверждения' in e for e in V.check(r)[0]), res)

    def test_replaced_requires_successor_and_end_date(self):
        r = copy.deepcopy(REG)
        p = first(r, 'подтверждено_официальным_PDF')
        p['registry_status'] = 'заменён'
        p['expert_confirmation'] = {'by': 'э', 'at': '2026-11-18', 'basis': 'x'}
        self.assertTrue(any('replaced_by' in e for e in V.check(r)[0]))
        p['replaced_by'] = 'синтетическая новая редакция'
        p['valid_to'] = '2026-01-01'
        self.assertEqual(V.check(r)[0], [])

    def test_official_number_mismatch_detected(self):
        r = copy.deepcopy(REG)
        first(r, 'подтверждено_официальным_PDF')['official_check']['official_no'] = '999'
        self.assertTrue(any('≠' in e for e in V.check(r)[0]))

    def test_cannot_mark_complete_with_gaps(self):
        r = copy.deepcopy(REG)
        r['completeness']['state'] = 'полный'
        self.assertTrue(any('помечен «полный»' in e for e in V.check(r)[0]))

    def test_coverage_for_engine_reports_gaps(self):
        cov = V.coverage(REG)
        self.assertEqual(cov['total'], 29)
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
        claims = [p for p in REG['protocols'] if p.get('reviewer_claim')]
        self.assertEqual(len(claims), 9)
        for p in claims:
            self.assertIsNone(p['reviewer_claim']['url'])
            self.assertNotIn(p['official_check']['result'], V.OFFICIAL - {'подтверждено_выдержкой_официального_сайта', 'подтверждено_официальным_PDF', 'подтверждено_протоколом_ОКК'} | set())

    def test_engine_entry_carries_evidence(self):
        p = next(x for x in REG['protocols'] if x['official_check']['result'] == 'подтверждено_официальным_PDF')
        e = V.engine_entry(p)
        self.assertEqual(e['currency_verified'], False)
        self.assertIn('doc_id', e)


if __name__ == '__main__':
    unittest.main()
