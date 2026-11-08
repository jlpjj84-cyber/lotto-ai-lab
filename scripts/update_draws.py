#!/usr/bin/env python3
"""LOTTO LAB public draw updater. Ticket data must never be stored in this repo."""
from __future__ import annotations
import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / 'data' / 'draws.json'
OFFICIAL_LATEST = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do'
OFFICIAL_BATCH = 'https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd={}'
MIRROR = 'https://raw.githubusercontent.com/JunKwon91/lotto-data/main/data/lotto-history.json'
TZ_KST = dt.timezone(dt.timedelta(hours=9))
FIRST = dt.date(2002, 12, 7)
KNOWN = {1249: ([2, 11, 16, 25, 34, 35], 14, '2026-11-07')}

def kst_today() -> dt.date:
    return dt.datetime.now(TZ_KST).date()

def validate(d: dict, today: dt.date | None = None) -> dict:
    r = int(d['round'])
    nums = sorted(map(int, d['numbers']))
    bonus = int(d['bonus'])
    date = dt.date.fromisoformat(d['date'])
    if r < 1 or len(nums) != 6 or len(set(nums)) != 6 or not all(1 <= x <= 45 for x in nums):
        raise ValueError(f'회차 {r}: 유효하지 않은 본번호')
    if not (1 <= bonus <= 45) or bonus in nums:
        raise ValueError(f'회차 {r}: 유효하지 않은 보너스 번호')
    if date != FIRST + dt.timedelta(weeks=r - 1):
        raise ValueError(f'회차 {r}: 추첨일이 회차 일정과 불일치: {date}')
    if date > (today or kst_today()):
        raise ValueError(f'회차 {r}: 미래 추첨일 데이터 거부')
    known = KNOWN.get(r)
    if known and (nums, bonus, date.isoformat()) != known:
        raise ValueError(f'회차 {r}: 공식 확인 기준번호와 충돌')
    prizes = d.get('prizes') or {}
    clean = {}
    if isinstance(prizes, dict):
        for k, v in prizes.items():
            if str(k) in ('1', '2', '3', '4', '5') and v is not None and str(v) != '':
                amount = int(v)
                if amount >= 0:
                    clean[str(k)] = amount
    return dict(round=r, date=date.isoformat(), numbers=nums, bonus=bonus, prizes=clean)

def download_json(url: str) -> dict:
    req = Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; LottoLab/3.0; +https://github.com)',
        'Accept': 'application/json',
        'Referer': 'https://www.dhlottery.co.kr/lt645/result',
    })
    with urlopen(req, timeout=20) as resp:
        kind = resp.headers.get('Content-Type', '')
        if 'json' not in kind.lower():
            raise ValueError(f'JSON 아닌 응답 ({kind}): 접근 차단 가능')
        return json.load(resp)

def official_rows(body: dict) -> list[dict]:
    raw = body.get('data', {}).get('list', [])
    if not isinstance(raw, list):
        raise ValueError('공식 데이터 형식 변경: data.list가 없음')
    result = []
    for x in raw:
        if not isinstance(x, dict):
            continue
        if any(x.get(f'tm{i}WnNo') in (None, '') for i in range(1, 7)) or x.get('bnsWnNo') in (None, ''):
            continue
        date = str(x.get('ltRflYmd', ''))
        if len(date) != 8 or not date.isdigit():
            continue
        item = {
            'round': x['ltEpsd'],
            'date': f'{date[:4]}-{date[4:6]}-{date[6:8]}',
            'numbers': [x[f'tm{i}WnNo'] for i in range(1, 7)],
            'bonus': x['bnsWnNo'],
            'prizes': {str(i): x.get(f'rnk{i}WnAmt') for i in range(1, 6)}
        }
        result.append(validate(item))
    return result

def mirror_rows(body: dict) -> list[dict]:
    arr = body.get('data')
    if not isinstance(arr, list) or len(arr) < 100:
        raise ValueError('공개 자료 형식 오류 또는 보유 데이터 부족')
    result = []
    for x in arr:
        prizes = {str(v['rank']): v['prizePerWinner'] for v in x.get('prizes', [])
                  if isinstance(v, dict) and v.get('prizePerWinner') is not None}
        result.append(validate({'round': x['drawNo'], 'date': x['date'],
                                'numbers': x['numbers'], 'bonus': x['bonusNo'],
                                'prizes': prizes}))
    return result

def merge(old: list[dict], new: list[dict], name: str, allow_historical_only=False) -> list[dict]:
    target = {int(d['round']): validate(d) for d in old}
    current_latest = max(target)
    for d in new:
        d = validate(d)
        prior = target.get(d['round'])
        if prior and (prior['numbers'] != d['numbers'] or prior['bonus'] != d['bonus'] or prior['date'] != d['date']):
            raise ValueError(f'{name}: 기존 데이터 {d["round"]}회와 상충하여 병합 중단')
        if allow_historical_only and d['round'] > current_latest:
            continue
        target[d['round']] = {**(prior or {}), **d,
                              'prizes': {**((prior or {}).get('prizes') or {}), **(d.get('prizes') or {})}}
    return [target[r] for r in sorted(target, reverse=True)]

def official_incremental(existing: list[dict], latest: dict) -> list[dict]:
    current = max(d['round'] for d in existing)
    new_max = latest['round']
    if new_max <= current:
        return merge(existing, [latest], '공식 최신')
    if new_max - current > 30:
        raise ValueError('공식 데이터 누락 간격 30회 초과: 검토 필요')
    collected = {latest['round']: latest}
    for center in range(current + 1, new_max + 1, 6):
        batch = official_rows(download_json(OFFICIAL_BATCH.format(min(new_max, center + 2))))
        collected.update({x['round']: x for x in batch})
        time.sleep(.6)
    missing = [r for r in range(current + 1, new_max + 1) if r not in collected]
    if missing:
        raise ValueError(f'공식 확인 실패 회차: {missing}')
    return merge(existing, list(collected.values()), '공식 추가')

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description='공개 로또 추첨 데이터 갱신. 구매 기록은 포함하지 않습니다.')
    ap.add_argument('--manual-round', type=int)
    ap.add_argument('--manual-date')
    ap.add_argument('--manual-numbers')
    ap.add_argument('--manual-bonus', type=int)
    args = ap.parse_args(argv)
    payload = json.loads(DATA_FILE.read_text(encoding='utf-8'))
    old = [validate(d) for d in payload['draws']]
    work = old
    events = []
    errors = []
    initial = len(old)
    if len(old) < max(500, max(d['round'] for d in old) - 10):
        try:
            mirror = mirror_rows(download_json(MIRROR))
            work = merge(work, mirror, '공개 데이터셋(과거 이력)', allow_historical_only=True)
            events.append('JunKwon91/lotto-data (MIT) 과거 데이터 추가')
        except Exception as e:
            errors.append(f'과거 이력 확보 실패: {e}')
    manual_fields = [args.manual_round, args.manual_date, args.manual_numbers, args.manual_bonus]
    if any(v is not None and v != '' for v in manual_fields):
        if not all(v is not None and v != '' for v in manual_fields):
            raise ValueError('수동 갱신은 회차, 날짜, 번호 6개, 보너스를 모두 입력해야 합니다')
        nums = [int(n.strip()) for n in args.manual_numbers.replace(' ', ',').split(',') if n.strip()]
        manual = validate({'round': args.manual_round, 'date': args.manual_date,
                           'numbers': nums, 'bonus': args.manual_bonus})
        if manual['round'] > max(d['round'] for d in work) + 1:
            raise ValueError('미확인 중간 회차가 있어 수동 입력할 수 없습니다')
        work = merge(work, [manual], '수동 확인')
        events.append('관리자 수동 입력 (공식 발표 확인 필요)')
    else:
        try:
            received = official_rows(download_json(OFFICIAL_LATEST))
            if not received:
                raise ValueError('발표된 최신 추첨을 확인하지 못함')
            latest = max(received, key=lambda d: d['round'])
            work = official_incremental(work, latest)
            events.append('동행복권 공개 조회(2026년 API)')
        except Exception as e:
            errors.append(f'공식 추첨 조회 실패: {e}')
    if work != old:
        out = {
            'updatedAt': dt.datetime.now(TZ_KST).isoformat(timespec='seconds'),
            'source': '동행복권 공개 결과 / 보조 과거자료',
            'sourceDetail': '; '.join(events + errors),
            'status': 'partial' if errors else 'ok',
            'draws': work,
        }
        DATA_FILE.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
        print(f'UPDATED: {initial} -> {len(work)} draws; latest={work[0]["round"]}; {out["sourceDetail"]}')
    else:
        print(f'NO CHANGE: {initial} draws; latest={work[0]["round"]}')
    for problem in errors:
        print('WARN:', problem, file=sys.stderr)
    return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
