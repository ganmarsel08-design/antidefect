#!/usr/bin/env python3
"""Тесты проверки базы правил. python3 -m unittest rules/test_rules.py
Сверка цитат с PDF выполняется, если задан ANTIDEFECT_PDF_DIR (папка с PDF владельца проекта)."""
import copy, json, os, sys, unittest
sys.path.insert(0, os.path.dirname(__file__))
import verify_rules as V

HERE = os.path.dirname(__file__)
DB = json.load(open(os.path.join(HERE, 'pilot-rules.json'), encoding='utf-8'))
REG = json.load(open(os.path.join(HERE, '..', 'registry', 'protocols-registry.json'), encoding='utf-8'))
PDF_DIR = os.environ.get('ANTIDEFECT_PDF_DIR')
R = {r['rule_id']: r for r in DB['rules']}


def errs(db, **kw):
    return V.check(db, REG, **kw)[0]


class Structure(unittest.TestCase):
    def test_candidate_db_is_valid(self):
        self.assertEqual(errs(DB), [])

    def test_counts_per_protocol(self):
        for p in ('rds', 'nek', 'sepsis'):
            self.assertEqual(sum(r['protocol'] == p for r in DB['rules']), 10)

    def test_all_candidates_unconfirmed(self):
        self.assertFalse(DB['authenticated'])
        for r in DB['rules']:
            self.assertEqual(r['status'], V.CANDIDATE)
            self.assertIsNone(r['expert_confirmation'])
            self.assertTrue(all(a['decision'] is None for a in r['ambiguities']))

    def test_required_fields_present(self):
        for r in DB['rules']:
            for k in ('rule_id', 'doc_id', 'source', 'applicability', 'requirement', 'exceptions_and_caveats',
                      'required_data', 'evidence_level', 'normativity', 'status'):
                self.assertIn(k, r, r['rule_id'])
            self.assertTrue(r['source']['section'])
            self.assertTrue(r['required_data'])

    def test_protocol_editions_match_registry(self):
        reg = {p['id']: p for p in REG['protocols']}
        self.assertEqual(DB['protocols']['nek']['edition']['approval_no'], '185')
        self.assertEqual(DB['protocols']['nek']['edition']['approval_date'], '2023-07-28')
        self.assertEqual(DB['protocols']['sepsis']['edition']['approval_no'], '185')
        self.assertEqual(DB['protocols']['sepsis']['edition']['approval_date'], '2023-07-28')
        self.assertEqual(DB['protocols']['rds']['edition']['approval_no'], '4')
        for pid, pr in DB['protocols'].items():
            self.assertEqual(pr['pdf']['identity_with_official_file'], 'не установлено')
            self.assertEqual(pr['registry_official_check'], reg[pid]['official_check']['result'])

    def test_normativity_is_not_all_mandatory(self):
        classes = {r['normativity'] for r in DB['rules']}
        self.assertTrue({'обязательно', 'рекомендуется', 'не_рекомендуется'} <= classes)
        # слово «противопоказ» в выбранных цитатах отсутствует — класс не присвоен ни одному правилу
        self.assertNotIn('противопоказано', classes)

    def test_evidence_level_only_where_stated(self):
        with_level = sorted(r['rule_id'] for r in DB['rules'] if r['evidence_level']['value'])
        self.assertEqual(with_level, ['NEC-007', 'RDS-009'])


class NegativeScenarios(unittest.TestCase):
    def test_changed_quote_detected_by_hash(self):
        db = copy.deepcopy(DB)
        q = next(r for r in db['rules'] if r['rule_id'] == 'SEP-005')['source']['quotes'][0]
        q['text'] = q['text'].replace('25 мг/кг', '50 мг/кг')   # подмена дозы
        self.assertTrue(any('хэш цитаты' in e for e in errs(db)))

    def test_confirmed_without_expert_rejected(self):
        db = copy.deepcopy(DB)
        db['rules'][0]['status'] = 'подтверждено'
        self.assertTrue(any('без подтверждения эксперта' in e for e in errs(db)))

    def test_db_cannot_claim_authentication(self):
        db = copy.deepcopy(DB)
        db['authenticated'] = True
        self.assertTrue(any('authenticated' in e for e in errs(db)))

    def test_contraindicated_requires_word_in_quote(self):
        db = copy.deepcopy(DB)
        db['rules'][0]['normativity'] = 'противопоказано'
        self.assertTrue(any('противопоказано' in e for e in errs(db)))

    def test_unknown_normativity_rejected(self):
        db = copy.deepcopy(DB)
        db['rules'][0]['normativity'] = 'строго обязательно'
        self.assertTrue(any('класс нормативности' in e for e in errs(db)))

    def test_field_not_in_required_data(self):
        db = copy.deepcopy(DB)
        db['rules'][0]['required_data'] = db['rules'][0]['required_data'][:1]
        self.assertTrue(any('required_data' in e for e in errs(db)))

    def test_doc_id_and_pdf_must_match_registry(self):
        db = copy.deepcopy(DB)
        db['protocols']['nek']['pdf']['sha256'] = '0' * 64
        db['protocols']['sepsis']['doc_id'] = 'КП-ДЛ:сепсис:2020-01-01'
        e = errs(db)
        self.assertTrue(any('SHA-256 PDF' in x for x in e))
        self.assertTrue(any('doc_id' in x for x in e))

    def test_identity_with_official_file_needs_hash(self):
        db = copy.deepcopy(DB)
        db['protocols']['rds']['pdf']['identity_with_official_file'] = 'совпадает'
        self.assertTrue(any('тождество' in e for e in errs(db)))

    def test_ambiguity_decision_needs_expert(self):
        db = copy.deepcopy(DB)
        db['rules'][0]['ambiguities'][0]['decision'] = 'принято <30'
        self.assertTrue(any('неоднозначности' in e for e in errs(db)))

    def test_evidence_level_needs_source_page(self):
        db = copy.deepcopy(DB)
        db['rules'][0]['evidence_level'] = {'value': 'B'}
        self.assertTrue(any('уровень доказательности' in e for e in errs(db)))

    def test_too_many_rules_per_protocol(self):
        db = copy.deepcopy(DB)
        extra = copy.deepcopy(db['rules'][0])
        extra['rule_id'] = 'RDS-011'
        db['rules'].append(extra)
        self.assertTrue(any('5–10 правил' in e for e in errs(db)))

    def test_class_without_modal_word_needs_expert_question(self):
        db = copy.deepcopy(DB)
        r = next(x for x in db['rules'] if x['rule_id'] == 'NEC-004')
        r['ambiguities'] = [a for a in r['ambiguities'] if 'модальн' not in a['text']]
        self.assertTrue(any('без модального слова' in e for e in errs(db)))

    def test_rds009_comparative_not_mandatory(self):
        r = R['RDS-009']
        self.assertEqual(r['kind'], 'сравнительное_положение')
        self.assertNotEqual(r['normativity'], 'обязательно')
        db = copy.deepcopy(DB)
        x = next(y for y in db['rules'] if y['rule_id'] == 'RDS-009')
        x['normativity'] = 'обязательно'
        self.assertTrue(any('сравнительное положение не может' in e for e in errs(db)))
        db = copy.deepcopy(DB)
        x = next(y for y in db['rules'] if y['rule_id'] == 'RDS-009')
        for a in x['ambiguities']:
            a['blocking'] = 'no'
        self.assertTrue(any('блокирующая неоднозначность' in e for e in errs(db)))

    def test_sep009_010_duration_blocked_until_expert(self):
        for rid in ('SEP-009', 'SEP-010'):
            self.assertTrue(any(a['blocking'] == 'always' for a in R[rid]['ambiguities']), rid)

    def test_sep010_requires_no_meningitis(self):
        r = R['SEP-010']
        self.assertIn({'field': 'meningitis', 'op': 'is_false'}, r['applicability']['condition']['all'])
        self.assertTrue(any('без менингита' in q['text'] for q in r['source']['quotes']))

    def test_sep008_009_limited_to_ampicillin_gentamicin(self):
        for rid in ('SEP-008', 'SEP-009'):
            cond = R[rid]['applicability']['condition']['all']
            self.assertIn({'field': 'empirical_regimen', 'op': 'eq', 'value': 'ampicillin+gentamicin'}, cond, rid)
            self.assertTrue(any('ампициллин' in q['text'] and 'гентамицин' in q['text'] for q in R[rid]['source']['quotes']), rid)

    def test_conflicts_declared_from_text(self):
        ids = {c['id'] for c in DB['protocol_conflicts']}
        self.assertEqual(ids, {'CF-001', 'CF-002', 'CF-003', 'CF-004', 'CF-005'})
        self.assertNotIn('conflicts_with', R['NEC-009'])
        cf1 = next(c for c in DB['protocol_conflicts'] if c['id'] == 'CF-001')
        self.assertEqual(cf1['rules'], ['NEC-009', 'NEC-010'])
        self.assertEqual(cf1['active_when'], {'field': 'nec_stage', 'op': 'eq', 'value': '2а'})

    def test_conflict_with_one_quote_or_changed_quote_rejected(self):
        db = copy.deepcopy(DB)
        db['protocol_conflicts'][0]['quotes'] = db['protocol_conflicts'][0]['quotes'][:1]
        self.assertTrue(any('минимум на две цитаты' in e for e in errs(db)))
        db = copy.deepcopy(DB)
        db['protocol_conflicts'][1]['quotes'][0]['text'] += ' ' 'x'
        self.assertTrue(any('CF-002 цитата 1: хэш' in e for e in errs(db)))

    def test_ambiguity_must_declare_blocking(self):
        db = copy.deepcopy(DB)
        del db['rules'][0]['ambiguities'][0]['blocking']
        self.assertTrue(any('блокирует ли' in e for e in errs(db)))
        db = copy.deepcopy(DB)
        a = next(y for y in db['rules'] if y['rule_id'] == 'NEC-010')['ambiguities'][0]
        del a['blocks_when']
        self.assertTrue(any('без условия blocks_when' in e for e in errs(db)))

    def test_duplicate_rule_id(self):
        db = copy.deepcopy(DB)
        db['rules'][1]['rule_id'] = db['rules'][0]['rule_id']
        self.assertTrue(any('повтор' in e for e in errs(db)))


@unittest.skipUnless(PDF_DIR, 'ANTIDEFECT_PDF_DIR не задан — сверка цитат с PDF пропущена')
class QuotesAgainstPdf(unittest.TestCase):
    def test_all_quotes_on_stated_pages(self):
        self.assertEqual(errs(DB, pdf_dir=PDF_DIR), [])

    def test_wrong_page_detected(self):
        db = copy.deepcopy(DB)
        r = next(x for x in db['rules'] if x['rule_id'] == 'NEC-001')
        r['source']['quotes'][0]['page'] = 3
        e = errs(db, pdf_dir=PDF_DIR)
        self.assertTrue(any('не найден на стр. 3' in x and '[12]' in x for x in e), e)

    def test_invented_text_not_in_document(self):
        db = copy.deepcopy(DB)
        q = next(x for x in db['rules'] if x['rule_id'] == 'SEP-005')['source']['quotes'][0]
        q['text'] = 'Бензилпенициллин назначается в дозе 100 мг/кг через каждые 6 часов.'
        q['sha256'] = V.sha(q['text'])        # даже с пересчитанным хэшем выдумка не проходит
        self.assertTrue(any('нет в документе' in x for x in errs(db, pdf_dir=PDF_DIR)))

    def test_conflict_quote_wrong_page_detected(self):
        db = copy.deepcopy(DB)
        db['protocol_conflicts'][4]['quotes'][1]['page'] = 14
        self.assertTrue(any('CF-005 цитата 2: текст не найден' in x for x in errs(db, pdf_dir=PDF_DIR)))

    def test_evidence_table_pages(self):
        pages = {p: V.pdf_pages(os.path.join(PDF_DIR, DB['protocols'][p]['pdf']['file_name'])) for p in ('rds', 'nek')}
        self.assertIn('Порактант альфа 200 мг/кг', pages['rds'][10])
        self.assertIn('Метронидазол', pages['nek'][14])


if __name__ == '__main__':
    unittest.main()
