"""Read verified result numbers and prize fields from the lottery operator."""

import json
import sys

from update_draws import OFFICIAL_BATCH, OFFICIAL_LATEST, download_json, official_rows


def collect(rounds: list[int]) -> dict:
    latest = official_rows(download_json(OFFICIAL_LATEST))
    if not latest:
        raise ValueError('동행복권 최신 확정 결과가 없습니다.')
    results = {}

    def add(rows):
        for row in rows:
            old = results.get(row['round'])
            if old and any(old[key] != row[key] for key in ('date', 'numbers', 'bonus')):
                raise ValueError('동행복권 응답의 당첨번호가 서로 다릅니다.')
            if old:
                for rank, amount in row['prizes'].items():
                    prior = old['prizes'].get(rank)
                    if prior and amount and prior != amount:
                        raise ValueError('동행복권 응답의 당첨금이 서로 다릅니다.')
                row['prizes'] = {**old['prizes'], **{k: v for k, v in row['prizes'].items() if v > 0}}
            results[row['round']] = row

    add(latest)
    top = max(latest, key=lambda row: row['round'])
    for number in sorted(set(rounds)):
        if number <= top['round'] and (number not in results or len(results[number]['prizes']) < 5):
            add(official_rows(download_json(OFFICIAL_BATCH.format(number))))
    return {'latest': results[top['round']], 'draws': [results[number] for number in rounds if number in results]}


if __name__ == '__main__':
    try:
        print(json.dumps(collect([int(value) for value in sys.argv[1:]]), ensure_ascii=True))
    except Exception as error:
        print(f'공식 추첨 조회 실패: {error}', file=sys.stderr)
        sys.exit(1)
