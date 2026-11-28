"""Deterministic calculations over inputs mapped to the project period and scope."""

from collections import defaultdict
from decimal import Decimal
import re
import unicodedata


def cents(value):
    if isinstance(value, bool) or not re.fullmatch(r'-?\d+(?:\.\d{1,2})?', str(value)):
        raise ValueError('金额须为两位以内小数，缺失金额须先确认。')
    return int(Decimal(str(value)) * 100)


def yuan(value):
    return f'{Decimal(value) / 100:.2f}'


def verify_books(case):
    """Compare each of four controls, then compare corrected opening to prior audited close."""
    fields = ('opening', 'debit', 'credit', 'closing')
    balance = {item['code']: item for item in case['balances']}
    if not balance or len(balance) != len(case['balances']):
        raise ValueError('余额表不能为空或重复列入同一科目。')
    grouped = defaultdict(list)
    for line in case['ledger']:
        if line.get('kind', 'voucher') == 'voucher':
            grouped[line['code']].append(line)
    opening = {item['code']: item for item in case['prior']}
    if len(opening) != len(case['prior']):
        raise ValueError('期初衔接的科目编码重复。')
    rows = []
    for code in sorted(set(balance) | set(grouped) | set(opening) | set(case['book_controls'])):
        source = [entry['ref'] for entry in (balance.get(code), opening.get(code), case['book_controls'].get(code)) if entry]
        if code not in balance or code not in opening or code not in case['book_controls']:
            rows.append({'code': code, 'status': '缺四项勾稽或上年期初资料', 'sources': source})
            continue
        account, prior, book = balance[code], opening[code], case['book_controls'][code]
        ledger = [cents(book[name]) for name in fields]
        actual_debit = sum(cents(line['debit']) for line in grouped[code])
        actual_credit = sum(cents(line['credit']) for line in grouped[code])
        tb = [cents(account[field]) for field in fields]
        remaining = 0
        unknown = False
        for adjustment in prior.get('adjustments', []):
            source.append(adjustment['ref'])
            state = adjustment['state']
            if state in ('未入账', '列报差'):
                remaining += cents(adjustment['amount'])
            elif state != '已入账':
                unknown = True
        adjusted = ledger[0] + remaining
        differences = [a - b for a, b in zip(ledger, tb)]
        movement_matches = ledger[1:3] == [actual_debit, actual_credit]
        rolls = ledger[0] + ledger[1] - ledger[2] == ledger[3]
        gap = adjusted - cents(prior['audited_closing'])
        status = '通过' if not any(differences) and movement_matches and rolls and not gap and not unknown else '待核'
        rows.append({'code': code, 'status': status, 'differences': dict(zip(fields, map(yuan, differences))),
                     'ledger_lines_match': movement_matches, 'balance_rolls': rolls, 'opening_gap': yuan(gap),
                     'proposed_opening_adjustment': yuan(remaining), 'sources': source})
    trial = {field: sum(cents(item[field]) for item in balance.values()) for field in fields}
    trial_ok = trial['opening'] == trial['closing'] == 0 and trial['debit'] == trial['credit']
    return {'passed': trial_ok and all(row['status'] == '通过' for row in rows), 'trial_balanced': trial_ok, 'rows': rows}


def summary_risks(ledger):
    flagged = defaultdict(list)
    for line in ledger:
        if line.get('kind', 'voucher') != 'voucher':
            continue
        raw = str(line.get('summary') or '')
        normalized = ''.join(char for char in raw if not char.isspace() and not unicodedata.category(char).startswith('P'))
        if normalized in ('', '往来款', '转账', '调整'):
            flagged[(line['entity'], line['date'][:4], line['voucher'])].append(line)
    return [{'entity': key[0], 'year': key[1], 'voucher': key[2], 'related_lines': lines} for key, lines in flagged.items()]


def voucher_differences(ledger):
    groups = defaultdict(int)
    for line in ledger:
        key = (line['entity'], line['date'], line['voucher'])
        groups[key] += cents(line['debit']) - cents(line['credit'])
    return [{'entity': entity, 'date': date, 'voucher': voucher, 'difference': yuan(gap)}
            for (entity, date, voucher), gap in groups.items() if gap]


def counterparties(ledger):
    groups = defaultdict(list)
    for line in ledger:
        if line.get('kind', 'voucher') == 'voucher':
            groups[(line['entity'], line['date'], line['voucher'])].append(line)
    rows = []
    for group in groups.values():
        def net(line):
            return cents(line['debit']) - cents(line['credit'])

        red = [line for line in group if cents(line['debit']) < 0 or cents(line['credit']) < 0]
        blue = [line for line in group if line not in red]
        balanced = sum(map(net, group)) == 0
        mixed = bool(red and blue and sum(map(net, red)))
        for part in ([group] if mixed or not balanced else [blue, red]):
            for line in part:
                opposite = defaultdict(int)
                for item in part:
                    if net(item) * net(line) < 0:
                        opposite[item['code']] += abs(net(item))
                split = {}
                if balanced and (not mixed or list(opposite) == [line['code']]) and opposite:
                    if len(opposite) == 1:
                        split = {next(iter(opposite)): yuan(cents(line['debit']) + cents(line['credit']))}
                    elif sum(net(item) * net(line) > 0 for item in part) == 1:
                        multiplier = -1 if line in red else 1
                        split = {code: yuan(amount * multiplier) for code, amount in opposite.items()}
                rows.append({'ref': line['ref'], 'codes': split, 'candidates': sorted(opposite),
                             'status': ('同一级待核末级' if line['code'] in split else '已归集') if split else '待核'})
    return rows


def bank_check(book_rows, bank_rows, confirmed_groups):
    """Compare source rows in confirmed groups and report both unmatched directions."""
    def index(rows):
        result = {row['id']: row for row in rows}
        if len(result) != len(rows):
            raise ValueError('银行对账的来源行标识不得重复。')
        return result

    book, bank = index(book_rows), index(bank_rows)
    results = []
    for group in confirmed_groups:
        if not group['book'] or not group['bank']:
            raise ValueError('匹配组两侧均需有来源行。')
        sides = []
        for source, key in ((book, 'book'), (bank, 'bank')):
            lines = [source.pop(item) for item in group[key]]
            sides.append((sum(cents(line['amount']) for line in lines), [line['ref'] for line in lines]))
        results.append({'book': yuan(sides[0][0]), 'bank': yuan(sides[1][0]),
                        'difference': yuan(sides[0][0] - sides[1][0]), 'sources': [side[1] for side in sides]})
    return {'groups': results, 'unmatched_book': list(book.values()), 'unmatched_bank': list(bank.values())}


def fifo_aging(entries, cutoff):
    """Group by account/party, take dated positive layers, apply same-month then oldest reductions."""
    groups = defaultdict(list)
    as_of = month_index(cutoff)
    for row in entries:
        groups[row['code'], row['party']].append(row)
    result = []
    for (code, party), rows in groups.items():
        amounts = defaultdict(int)
        for row in rows:
            if row.get('month'):
                month_index(row['month'])
            amounts[row.get('month')] += cents(row['amount'])
        total = sum(amounts.values())
        bands = [0, 0, 0, 0]
        if None not in amounts and total >= 0:
            reductions = -sum(min(amount, 0) for amount in amounts.values())
            for month, amount in sorted(amounts.items()):
                if amount > 0:
                    paid = min(reductions, amount)
                    reductions -= paid
                    age = max(0, as_of - month_index(month))
                    band = sum(age >= threshold for threshold in (12, 24, 36))
                    bands[band] += amount - paid
        result.append({'code': code, 'party': party, 'balance': yuan(total),
                       'aging': None if None in amounts or total < 0 else list(map(yuan, bands)),
                       'future_months': sorted(month for month in amounts if month and month_index(month) > as_of),
                       'sources': [row['ref'] for row in rows]})
    return result


def month_index(text):
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', text):
        raise ValueError('账期须用 YYYY-MM。')
    return int(text[:4]) * 12 + int(text[-2:])


def budget(contract, margin, onsite_people, hours_per_month, hours_by_role, travel='3000.00'):
    salary = {'编制': 5000, '复核': 10000, '合伙人': 12000}
    rate = Decimal(str(margin))
    if (not Decimal('0.10') <= rate <= Decimal('0.15') or not 0 <= cents(travel) <= 300000
            or not isinstance(onsite_people, int) or onsite_people < 0 or hours_per_month <= 0
            or not hours_by_role or any(role not in salary or Decimal(str(h)) <= 0 for role, h in hours_by_role.items())):
        raise ValueError('预算参数超出约定范围。')
    target = Decimal(cents(contract)) * (1 - rate) / 100
    subsidy = 80 * 3 * onsite_people
    labor = target - Decimal(cents(travel)) / 100 - subsidy
    if labor < 0:
        raise ValueError('目标成本低于差旅及补助，需调整预算。')
    weighted = sum(Decimal(str(h)) * salary[role] / hours_per_month for role, h in hours_by_role.items())
    hours = {role: f'{labor / weighted * Decimal(str(h)):.2f}' for role, h in hours_by_role.items()}
    return {'target_cost': f'{target:.2f}', 'subsidy': subsidy, 'travel': travel, 'planned_hours': hours}


FIXED_EXCLUSIONS = {'1100-1', '1200-1', '1200-5', '2192', '2193', '5910', '5980', '7110', '7200', '7240', '7270', '7800', '9400'}


def planned(task):
    index = task['index']
    root = index.split('-')[0]
    if index in FIXED_EXCLUSIONS or root in FIXED_EXCLUSIONS:
        return False
    if root == '1300' and task.get('first_engagement', True):
        return False
    if root.isdecimal() and 2000 <= int(root) <= 2900 and root not in {'2000', '2270', '2320', '2900'}:
        return False
    return task.get('checkmark') == '✓' and bool(task.get('sheet')) and task.get('applicable', True)
