#!/usr/bin/env python3
"""Этап 6: детерминированная сборка базы (C7), побайтовая неизменность восьми подтверждённых правил (C6),
файл решений экспертизы и проверки схемы rules-0.2.

ANTIDEFECT_PDF_DIR=<папка PDF> python3 -m unittest rules/test_build.py
"""
import copy, hashlib, json, os, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import verify_rules as V

DB_PATH = os.path.join(HERE, 'pilot-rules.json')
ED_PATH = os.path.join(HERE, 'expert-decisions.json')
BASE_PATH = os.path.join(HERE, 'build', 'baseline-2239c52.json')
REG = json.load(open(os.path.join(ROOT, 'registry', 'protocols-registry.json'), encoding='utf-8'))
PDF_DIR = os.environ.get('ANTIDEFECT_PDF_DIR')
CONFIRMED = ['RDS-001', 'RDS-002', 'RDS-003', 'RDS-004', 'RDS-005', 'RDS-006', 'RDS-008', 'RDS-009']
# Третий круг (rules-0.3, решения врача 20.11.2026): из восьми подтверждённых правил побайтово неизменны пять;
# RDS-003, RDS-008, RDS-009 изменены только по решению врача (revision_round3).
UNTOUCHED = ['RDS-001', 'RDS-002', 'RDS-004', 'RDS-005', 'RDS-006']
R3_PROTECTED_CHANGED = ['RDS-003', 'RDS-008', 'RDS-009']
R3_NEW_BLOCKING = ['SEP-005-A3', 'SEP-006-A4', 'SEP-008-A3']
R3_AMB_CHANGED = {'RDS-003-A2': ['blocks_when', 'machine_note'], 'RDS-009-A1': ['blocking', 'blocks_when', 'machine_note'], 'NEC-003-A1': ['part'],
                  'NEC-004-A1': ['blocking', 'blocks_when', 'part', 'machine_note'], 'SEP-010-A1': ['blocking', 'blocks_when', 'machine_note']}
NEW_BLOCKING = ['RDS-007-A2', 'RDS-010-A2', 'NEC-005-A1', 'NEC-006-A2', 'NEC-009-A1', 'NEC-010-A4', 'SEP-003-A2', 'SEP-006-A3']


def rule_sha(r):
    return hashlib.sha256(json.dumps(r, ensure_ascii=False, indent=1).encode('utf-8')).hexdigest()


def rule_text_in_file(r):
    # Запись правила в rules/pilot-rules.json (indent=1, глубина 2): каждая строка сдвинута на 2 пробела.
    return ('\n  ' + json.dumps(r, ensure_ascii=False, indent=1).replace('\n', '\n  ')).encode('utf-8')


def git_show(rev, path):
    try:
        return subprocess.run(['git', '-C', ROOT, 'show', f'{rev}:{path}'], capture_output=True, check=True).stdout
    except Exception:
        return None


class Build(unittest.TestCase):
    def test_rebuild_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, 'rules.json')
            subprocess.run([sys.executable, os.path.join(HERE, 'build', 'build_rules.py'), '--out', out], check=True, capture_output=True)
            self.assertEqual(open(out, 'rb').read(), open(DB_PATH, 'rb').read(), 'rules/pilot-rules.json не совпадает со сборкой: правьте rules/build/, а не JSON')
            out2 = os.path.join(d, 'rules2.json')
            subprocess.run([sys.executable, os.path.join(HERE, 'build', 'build_rules.py'), '--out', out2], check=True, capture_output=True)
            self.assertEqual(open(out, 'rb').read(), open(out2, 'rb').read(), 'сборка недетерминирована')

    def test_expert_decisions_rebuild_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, 'ed.json')
            subprocess.run([sys.executable, os.path.join(HERE, 'build', 'build_expert_decisions.py'), '--out', out], check=True, capture_output=True)
            self.assertEqual(open(out, 'rb').read(), open(ED_PATH, 'rb').read())

    def test_hand_edit_of_json_is_detected(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, 'rules.json')
            subprocess.run([sys.executable, os.path.join(HERE, 'build', 'build_rules.py'), '--out', out], check=True, capture_output=True)
            db = json.load(open(DB_PATH, encoding='utf-8'))
            db['rules'][10]['requirement']['description'] += ' '
            tampered = json.dumps(db, ensure_ascii=False, indent=1).encode() + b'\n'
            self.assertNotEqual(open(out, 'rb').read(), tampered)


class ConfirmedUnchanged(unittest.TestCase):
    def setUp(self):
        self.db = json.load(open(DB_PATH, encoding='utf-8'))
        self.ed = json.load(open(ED_PATH, encoding='utf-8'))
        self.raw = open(DB_PATH, 'rb').read()

    def test_eight_rules_checksums_match_baseline(self):
        base = self.ed['confirmed_unchanged']['sha256_at_baseline']
        self.assertEqual(sorted(base), CONFIRMED)
        for r in self.db['rules']:
            if r['rule_id'] in UNTOUCHED:
                self.assertEqual(rule_sha(r), base[r['rule_id']], r['rule_id'])
            elif r['rule_id'] in R3_PROTECTED_CHANGED:
                self.assertNotEqual(rule_sha(r), base[r['rule_id']], r['rule_id'])
                self.assertEqual(r['revision_round3']['round3_decision'], 'Изменить', r['rule_id'])
                self.assertNotIn('revision', r)

    def test_eight_rules_bytes_present_verbatim_in_file(self):
        for r in self.db['rules']:
            if r['rule_id'] in UNTOUCHED:
                self.assertIn(rule_text_in_file(r), self.raw, r['rule_id'])

    def test_eight_rules_identical_to_commit_2239c52(self):
        old = git_show('2239c52', 'rules/pilot-rules.json')
        if old is None:
            self.skipTest('нет истории git с коммитом 2239c52')
        self.assertEqual(hashlib.sha1(b'blob %d\0' % len(old) + old).hexdigest(), '55d3e034f048174acd4c8b397821a7a8d4c302e8')
        odb = json.loads(old)
        for r in odb['rules']:
            if r['rule_id'] in CONFIRMED:
                self.assertIn(rule_text_in_file(r), old, r['rule_id'])
                if r['rule_id'] in UNTOUCHED:
                    self.assertIn(rule_text_in_file(r), self.raw, r['rule_id'])
                self.assertEqual(rule_sha(r), self.ed['confirmed_unchanged']['sha256_at_baseline'][r['rule_id']])

    def test_baseline_fixture_matches_commit(self):
        old = git_show('2239c52', 'rules/pilot-rules.json')
        if old is None:
            self.skipTest('нет истории git с коммитом 2239c52')
        odb, base = json.loads(old), json.load(open(BASE_PATH, encoding='utf-8'))
        self.assertEqual(base['protocol_conflicts'], odb['protocol_conflicts'])
        for r in odb['rules']:
            b = base['rules'][r['rule_id']]
            self.assertEqual(b['quotes'], [{'page': q['page'], 'sha256': q['sha256']} for q in r['source']['quotes']])
            self.assertEqual(b['applicability'], r['applicability'])
            self.assertEqual(b['requirement'], r['requirement'])

    def test_old_data_dictionary_fields_kept(self):
        base = json.load(open(BASE_PATH, encoding='utf-8'))
        for f in base['data_dictionary_fields']:
            self.assertIn(f, self.db['data_dictionary'])
            self.assertEqual(self.db['data_dictionary'][f]['since'], 'rules-0.1')
        self.assertEqual(len(base['data_dictionary_fields']), 63)


class SchemaV2(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = json.load(open(DB_PATH, encoding='utf-8'))

    def errs(self, db, pdf=False):
        return V.check(db, REG, PDF_DIR if pdf else None)[0]

    def test_valid(self):
        self.assertEqual(self.errs(self.db), [])

    @unittest.skipUnless(PDF_DIR, 'ANTIDEFECT_PDF_DIR не задан')
    def test_all_quotes_incl_new_and_card_quotes_on_stated_pages(self):
        self.assertEqual(self.errs(self.db, pdf=True), [])
        rq = sum(len(r['source']['quotes']) for r in self.db['rules'])
        cq = sum(len(c.get('quotes', [])) for r in self.db['rules'] for c in r.get('card_labels', []))
        self.assertEqual((rq, cq), (74, 13))  # 68 этапа 6 + 6 цитат таблицы стр. 18 (SEP-005, SEP-006); 3 + 10 цитат в подписях CF-006/CF-007

    @unittest.skipUnless(PDF_DIR, 'ANTIDEFECT_PDF_DIR не задан')
    def test_card_quote_wrong_page_detected(self):
        db = copy.deepcopy(self.db)
        r = next(x for x in db['rules'] if x['rule_id'] == 'SEP-010')
        next(c for c in r['card_labels'] if c['id'] == 'shorter_than_7')['quotes'][0]['page'] = 14
        self.assertTrue(any('текст не найден на стр. 14' in e for e in self.errs(db, pdf=True)))

    def test_new_blocking_exactly_eight(self):
        now = [a['id'] for r in self.db['rules'] for a in r['ambiguities'] if a['blocking'] != 'no']
        self.assertEqual(len(now), 28)  # 25 + 3 третьего круга
        added = [a['id'] for r in self.db['rules'] for a in r['ambiguities'] if a.get('added', '').startswith('rules-0.2')]
        self.assertEqual(sorted(added), sorted(NEW_BLOCKING))
        added3 = [a['id'] for r in self.db['rules'] for a in r['ambiguities'] if a.get('added', '').startswith('rules-0.3')]
        self.assertEqual(sorted(added3), sorted(R3_NEW_BLOCKING))

    def test_part_errors_detected(self):
        db = copy.deepcopy(self.db)
        r = next(x for x in db['rules'] if x['rule_id'] == 'NEC-002')
        r['requirement']['parts'][1]['part_id'] = 'uvc'
        r['requirement']['check'] = {'field': 'uvc_removed', 'op': 'is_true'}
        e = self.errs(db)
        self.assertTrue(any('повтор uvc' in x for x in e))
        self.assertTrue(any('одновременно requirement.check и requirement.parts' in x for x in e))

    def test_ambiguity_unknown_part_detected(self):
        db = copy.deepcopy(self.db)
        a = next(x for x in db['rules'] if x['rule_id'] == 'SEP-006')['ambiguities'][-1]
        a['parts'] = ['dose', 'нет_такой']
        self.assertTrue(any('неизвестная часть нет_такой' in x for x in self.errs(db)))

    def test_part_field_not_in_required_data_detected(self):
        db = copy.deepcopy(self.db)
        r = next(x for x in db['rules'] if x['rule_id'] == 'RDS-010')
        r['required_data'] = [d for d in r['required_data'] if d['field'] != 'blood_gas_count']
        self.assertTrue(any("['blood_gas_count']" in x for x in self.errs(db)))

    def test_derived_field_must_exist_in_engine(self):
        db = copy.deepcopy(self.db)
        db['data_dictionary']['minutes_invented'] = {'description': 'x', 'unit': 'минуты', 'type': 'derived', 'derived_from': ['nec_onset_at']}
        self.assertTrue(any('minutes_invented' in x and 'derive.js' in x for x in self.errs(db)))

    def test_tri_without_false_meaning_detected(self):
        db = copy.deepcopy(self.db)
        del db['data_dictionary']['uvc_removed']['false_means']
        self.assertTrue(any('uvc_removed' in x and '«нет»' in x for x in self.errs(db)))

    def test_rules_status_candidate_and_no_decisions_inside(self):
        for r in self.db['rules']:
            self.assertEqual(r['status'], V.CANDIDATE)
            self.assertIsNone(r['expert_confirmation'])
            for a in r['ambiguities']:
                self.assertIsNone(a['decision'], a['id'])

    def test_no_data_protocols_json(self):
        self.assertFalse(os.path.exists(os.path.join(ROOT, 'data', 'protocols.json')))


class ExpertDecisions(unittest.TestCase):
    def test_content(self):
        ed = json.load(open(ED_PATH, encoding='utf-8'))
        self.assertEqual(len(ed['decisions']), 30)
        self.assertEqual([q['id'] for q in ed['open_questions']], [f'Q{i:02d}' for i in range(1, 25)])
        q24 = ed['open_questions'][23]
        self.assertEqual(q24['rules'], ['SEP-005', 'SEP-006'])
        self.assertIsNone(q24['answer'])
        self.assertTrue(all(q['status'] == 'открыт' and q['answer'] is None for q in ed['open_questions']))
        self.assertEqual(sorted(c['rule_id'] for c in ed['clinical_comments']), ['RDS-008', 'SEP-004', 'SEP-005', 'SEP-006'])
        self.assertTrue(all(d['rule_status_after'] == V.CANDIDATE for d in ed['decisions']))
        self.assertEqual([c['id'] for c in ed['protocol_conflicts']], ['CF-001', 'CF-002', 'CF-003', 'CF-004', 'CF-005', 'CF-006', 'CF-007'])
        r3 = ed['round3']
        self.assertEqual(r3['totals'], {'Утвердить поведение': 18, 'Изменить': 12, 'Нужно обсуждение': 0})
        self.assertEqual(r3['open_questions_closed'], [])
        self.assertEqual(r3['blocking_ambiguities']['removed'], [])
        self.assertTrue(all(q['status'] == 'предложение' for q in r3['proposed_new_questions']))


class InvariantsAfterStage6Corrections(unittest.TestCase):
    """V2–V4: блокировки, конфликты и тексты Q01–Q23 совпадают с d314a58 (исправления этапа 6 их не меняют)."""
    @classmethod
    def setUpClass(cls):
        cls.fx = json.load(open(os.path.join(HERE, 'build', 'fixture-d314a58.json'), encoding='utf-8'))
        cls.db = json.load(open(DB_PATH, encoding='utf-8'))
        cls.ed = json.load(open(ED_PATH, encoding='utf-8'))

    def test_25_blockers_identical_to_d314a58(self):
        # Третий круг: все 25 сохранены; отличия — только ключи из явного перечня R3_AMB_CHANGED; новые — 3.
        cur = {a['id']: a for r in self.db['rules'] for a in r['ambiguities'] if a['blocking'] != 'no'}
        self.assertEqual(len(cur), 28)
        self.assertEqual(sorted(set(cur) - set(self.fx['blocking_ambiguities'])), sorted(R3_NEW_BLOCKING))
        for aid, a in self.fx['blocking_ambiguities'].items():
            def strip(x):
                y = copy.deepcopy(x)
                for k in R3_AMB_CHANGED.get(aid, []) + ['round3_changes']:
                    y.pop(k, None)
                return y
            self.assertEqual(strip(cur[aid]), strip(a), aid)
            self.assertNotEqual(cur[aid]['blocking'], 'no', aid)

    def test_conflicts_identical(self):
        self.assertEqual(self.db['protocol_conflicts'][:5], self.fx['protocol_conflicts'])
        self.assertEqual([c['id'] for c in self.db['protocol_conflicts'][5:]], ['CF-006', 'CF-007'])

    def test_q01_q23_unchanged(self):
        self.assertEqual(self.ed['open_questions'][:23], self.fx['open_questions'])

    def test_fixture_matches_git_when_available(self):
        old = git_show('d314a58', 'rules/pilot-rules.json')
        if old is None:
            self.skipTest('нет истории git с коммитом d314a58')
        d = json.loads(old)
        self.assertEqual({a['id']: a for r in d['rules'] for a in r['ambiguities'] if a['blocking'] != 'no'}, self.fx['blocking_ambiguities'])


if __name__ == '__main__':
    unittest.main()
