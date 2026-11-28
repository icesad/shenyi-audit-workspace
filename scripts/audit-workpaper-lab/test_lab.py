import copy
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest import TestCase, main

from openpyxl import load_workbook

from checks import verify_books
from demo import sample_case, sample_workbook
from lab import check_case, edit_template, evaluate, mock_result
from providers import prepare_request, read_text


class WorkpaperTests(TestCase):
    def test_books_and_special_checks(self):
        case = sample_case()
        result = check_case(case)
        self.assertTrue(result['books']['passed'])
        self.assertEqual([row['voucher'] for row in result['summary_risks']], ['V01'])
        self.assertEqual(result['counterparties'][0]['codes'], {'6001': '50000.00'})
        self.assertEqual(result['bank']['groups'][0]['difference'], '0.00')
        self.assertEqual(len(result['bank']['unmatched_bank']), 1)
        self.assertEqual(result['aging'][0]['aging'], ['0.00', '150.00', '0.00', '0.00'])
        self.assertEqual(result['budget']['target_cost'], '31680.00')
        case['balances'][0]['debit'] = '85005'
        case['balances'][0]['credit'] = '5'
        self.assertFalse(verify_books(case)['passed'])

    def test_confirmed_opening_adjustment_only_once(self):
        case = sample_case()
        case['prior'][0]['adjustments'] = [{'state': '已入账', 'amount': '100', 'ref': '模拟补记凭证'}]
        self.assertTrue(verify_books(case)['passed'])
        case['prior'][0]['adjustments'][0]['state'] = '未入账'
        self.assertFalse(verify_books(case)['passed'])

    def test_model_cannot_upgrade_status_or_forge_evidence(self):
        tasks = sample_case()['tasks']
        data = json.loads(mock_result(tasks))
        data['items'][0]['refs'] = ['S-99999']
        data['items'][2]['status'] = '草稿'
        data['items'].append(copy.deepcopy(data['items'][3]))
        accepted, errors, _, _ = evaluate(json.dumps(data), tasks)
        self.assertEqual(set(accepted), {'2000', '7240'})
        self.assertEqual(len(errors), 3)

    def test_formula_and_template_protection(self):
        tasks = sample_case()['tasks']
        accepted, _, _, _ = evaluate(mock_result(tasks), tasks)
        with TemporaryDirectory() as directory:
            source, dest = Path(directory) / 'src.xlsx', Path(directory) / 'draft.xlsx'
            sample_workbook(source, tasks)
            edit_template(source, dest, tasks, accepted)
            with dest.open('rb') as output:
                book = load_workbook(output)
                self.assertEqual(book['收入检查']['B16'].value, '=ROUND(B15,2)')
                self.assertEqual(book['收入检查']['B15'].value, 85000)
                self.assertEqual(book['收入检查'].sheet_properties.tabColor.rgb, '0000B050')
                self.assertEqual(book['收入检查']['B6'].fill.fgColor.rgb, '00FFF2CC')
                self.assertEqual(book['工作表目录']['C2'].hyperlink.target, "#'承接评价'!A1")
                book.close()
            tasks[2]['cells']['测试目的'] = 'B16'
            with self.assertRaisesRegex(ValueError, '公式'):
                edit_template(source, dest, tasks, accepted)

    def test_failed_books_do_not_generate_workpapers(self):
        case = sample_case()
        del case['book_controls']['6001']
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'case.json'
            path.write_text(json.dumps(case), encoding='utf-8')
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('lab.py')), '--case', str(path),
                                     '--out', directory], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertFalse(list(Path(directory).rglob('*底稿草稿*.xlsx')))
            self.assertEqual(len(list(Path(directory).rglob('*审计待核*.xlsx'))), 1)

    def test_provider_wire_formats(self):
        options = {
            'openai': ('/chat/completions', 'Authorization', 'max_completion_tokens', {'choices': [{'message': {'content': 'ok'}}]}),
            'compatible': ('/chat/completions', 'Authorization', 'max_tokens', {'choices': [{'message': {'content': 'ok'}}]}),
            'anthropic': ('/messages', 'X-api-key', 'max_tokens', {'content': [{'type': 'text', 'text': 'ok'}]}),
            'gemini': (':generateContent', 'X-goog-api-key', 'generationConfig', {'candidates': [{'content': {'parts': [{'text': 'ok'}]}}]}),
        }
        for provider, (path, header, field, sample) in options.items():
            request = prepare_request({'provider': provider, 'model': 'example', 'base_url': 'https://example.test/v1'},
                                      'system', 'prompt', 'fake-key')
            self.assertTrue(request.full_url.endswith(path))
            self.assertTrue(request.get_header(header))
            self.assertNotIn('fake-key', request.full_url)
            self.assertIn(field, json.loads(request.data))
            self.assertEqual(read_text(provider, sample), 'ok')


if __name__ == '__main__':
    main()
