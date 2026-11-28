"""A fully invented case and template. Running this module exports the case for inspection."""

import json
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.page import PageMargins


def sample_case():
    facts = {
        'E01': {'source': '模拟约定书第1页', 'fact': '首次承接。含税费用36,000元。客户确认可提供相关账表。'},
        'E02': {'source': '模拟三栏账第5—8行', 'fact': '收入分录两笔，累计85,000元，已核对账簿发生额。部分销售合同及验收单待取得。'},
        'E03': {'source': '模拟上年TB第3—5行', 'fact': '本年开账数据与上年审定期末一致。'},
    }
    case = {
        'project': {'entity': '模拟甲公司', 'year': 2026, 'start': '2026-01-01', 'end': '2026-09-30',
                    'period_type': '预审', 'category': 'B', 'first_engagement': True},
        'facts': facts,
        'ledger': [], 'balances': [], 'prior': [], 'book_controls': {},
        'tasks': [
            {'index': '1200-6', 'title': '接受委托评价', 'sheet': '承接评价', 'checkmark': '✓', 'refs': ['E01'],
             'cells': {'承接理由': 'B6'}, 'example': {'承接理由': '首次承接。已核对约定书及可取得的账表资料安排，拟提交承接评价。'}},
            {'index': '2000', 'title': '风险评估程序', 'sheet': '风险评估', 'checkmark': '✓', 'refs': ['E02', 'E03'],
             'cells': {'业务与风险': 'B6'}, 'example': {'业务与风险': '收入已做账账核对。部分合同及验收单待补，计划检查交易发生和截止。'}},
            {'index': '6100-2', 'title': '收入细节性测试', 'sheet': '收入检查', 'checkmark': '✓', 'refs': ['E02'],
             'needs': '取得销售合同及验收单', 'owner': 'client', 'test': True, 'calculated_cells': {'B15': '85000'},
             'cells': dict(zip(('测试目的','测试步骤','测试结果','测试结论','检查1','检查2','检查3','检查4'),
                               (f'B{line}' for line in range(6,14)))),
             'example': {'测试目的': '评价收入的发生和截止。', '测试步骤': '已比对总账金额。取得合同及验收单后，逐笔测试交易日期及入账期间。',
                         '测试结果': '已核对账簿两笔收入。部分原始单据仍待取得。', '测试结论': '证据待补，收入发生及截止认定待进一步评价。',
                         '检查1': '核对合同对方单位。', '检查2': '核验验收日期及凭证日期。', '检查3': '对比价格、数量和记账金额。',
                         '检查4': '抽查截止日前后入账的履约凭据。'}},
            {'index': '9200', 'title': '试算平衡底稿', 'sheet': '试算核对', 'checkmark': '✓', 'refs': ['E03'],
             'cells': {'期初核对说明': 'B6'}, 'example': {'期初核对说明': '已按上年审定期末进行本期账簿期初比对。审定栏待后续复核。'}},
            {'index': '7240', 'title': '范围排除示例', 'sheet': '', 'checkmark': '✓', 'refs': [], 'cells': {}},
        ],
        'bank': {'book_rows': [{'id': 'B1', 'amount': '200', 'ref': '模拟日记账A5'}, {'id': 'B2', 'amount': '300', 'ref': '模拟日记账A6'}],
                 'bank_rows': [{'id': 'S1', 'amount': '500', 'ref': '模拟银行流水A5'}, {'id': 'S2', 'amount': '100', 'ref': '模拟银行流水A6'}],
                 'confirmed_groups': [{'book': ['B1', 'B2'], 'bank': ['S1']}]},
        'aging': {'cutoff': '2026-09', 'entries': [
            {'code': '1122', 'party': '模拟购货方A', 'month': '2025-05', 'amount': '250', 'ref': '模拟账龄A3'},
            {'code': '1122', 'party': '模拟购货方A', 'month': '2026-02', 'amount': '500', 'ref': '模拟账龄A4'},
            {'code': '1122', 'party': '模拟购货方A', 'month': '2026-02', 'amount': '-600', 'ref': '模拟账龄A5'}]},
        'budget': {'contract': '36000', 'margin': '0.12', 'onsite_people': 2,
                   'hours_per_month': 174, 'hours_by_role': {'编制': 5, '复核': 3, '合伙人': 1}},
    }
    for code, opening, debit, credit, closing in [('1002', 4000, 85000, 0, 89000), ('4001', -4000, 0, 0, -4000), ('6001', 0, 0, 85000, -85000)]:
        numbers = dict(zip(('opening', 'debit', 'credit', 'closing'), map(str, (opening, debit, credit, closing))))
        case['balances'].append({'code': code, 'ref': f'模拟余额表#{code}', **numbers})
        case['book_controls'][code] = {'ref': f'模拟明细账合计#{code}', **numbers}
        case['prior'].append({'code': code, 'audited_closing': str(opening), 'ref': f'模拟上年TB#{code}', 'adjustments': []})
    for voucher, amount, summary in [('V01', '50000', '  往来款。  '), ('V02', '35000', '收甲项目服务款后转账入银行')]:
        for code in ('1002', '6001'):
            case['ledger'].append({'entity': '模拟甲公司', 'date': '2026-09-15', 'voucher': voucher,
                                   'code': code, 'summary': summary, 'ref': f'模拟三栏账#{voucher}/{code}',
                                   'debit': amount if code == '1002' else '0', 'credit': amount if code == '6001' else '0'})
    return case


def sample_workbook(path, tasks):
    book = Workbook()
    info = book.active
    info.title = '本册说明'
    info.append(['模拟用途', '用于比较 AI 底稿填报与结构校验'])
    info.append(['审计期间', '2026年1—9月预审'])
    info.append(['编制与复核', '真实项目按分工及审批记录填列'])
    info.append(['待核事项', '详见独立审计待核与模型对比表'])
    directory = book.create_sheet('工作表目录')
    directory.append(['编号', '科目名称', '工作底稿名称', '索引号'])
    for task in tasks:
        name = task['sheet']
        if not name:
            continue
        sheet = book.create_sheet(name)
        sheet.append(['被审计单位', '模拟甲公司', '索引号', task['index']])
        sheet.append(['工作底稿名称', task['title']])
        sheet.append(['财务报表截止日', '2026年9月30日'])
        sheet.append(['编制人', None, '复核人', None])
        for field, address in task['cells'].items():
            sheet.cell(sheet[address].row, 1, field)
        if task['index'] == '6100-2':
            sheet['A15'] = '账面发生额'
            sheet['A16'] = '原模板公式'
            sheet['B16'] = '=ROUND(B15,2)'
            sheet['B15'].number_format = sheet['B16'].number_format = '#,##0.00'
        for cell in sheet[1]:
            cell.font = Font(name='宋体', size=10, bold=True)
            cell.fill = PatternFill('solid', fgColor='D9D9D9')
        sheet.column_dimensions['A'].width = 24
        sheet.column_dimensions['B'].width = 78
        sheet.column_dimensions['C'].width = 14
        sheet.print_title_rows = '1:4'
        sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
        sheet.page_margins = PageMargins(left=0.45, right=0.45, top=0.55, bottom=0.55)
        directory.append([directory.max_row, name, task['title'], task['index']])
        directory.cell(directory.max_row, 3).hyperlink = f"#'{name}'!A1"
    directory.column_dimensions['B'].width = 20
    directory.column_dimensions['C'].width = 30
    book.save(path)


if __name__ == '__main__':
    print(json.dumps(sample_case(), ensure_ascii=False, indent=2))
