import datetime as dt
import importlib.util
import unittest
from pathlib import Path

p=Path(__file__).resolve().parents[1]/'scripts'/'update_draws.py'
spec=importlib.util.spec_from_file_location('update_draws', p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class LotteryUpdateTests(unittest.TestCase):
    def test_correct_1249(self):
        x=m.validate({'round':1249,'date':'2026-11-07','numbers':[2,11,16,25,34,35],'bonus':14},dt.date(2026,11,8))
        self.assertEqual(x['numbers'],[2,11,16,25,34,35])
    def test_reject_future_date(self):
        with self.assertRaises(ValueError):
            m.validate({'round':1250,'date':'2026-11-14','numbers':[1,2,3,4,5,6],'bonus':7},dt.date(2026,11,8))
    def test_reject_duplicate(self):
        with self.assertRaises(ValueError):
            m.validate({'round':1249,'date':'2026-11-07','numbers':[2,2,16,25,34,35],'bonus':14},dt.date(2026,11,8))
    def test_reject_wrong_schedule(self):
        with self.assertRaises(ValueError):
            m.validate({'round':1249,'date':'2026-11-06','numbers':[2,11,16,25,34,35],'bonus':14},dt.date(2026,11,8))
    def test_official_response_parse(self):
        item={'ltEpsd':1249,'ltRflYmd':'20261107','bnsWnNo':14,**{f'tm{i}WnNo':x for i,x in enumerate([2,11,16,25,34,35],1)},'rnk1WnAmt':2025045509}
        rows=m.official_rows({'data':{'list':[item]}})
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['prizes']['1'],2025045509)
    def test_merge_conflict_refuses(self):
        a=m.validate({'round':1249,'date':'2026-11-07','numbers':[2,11,16,25,34,35],'bonus':14},dt.date(2026,11,8))
        b=dict(a,numbers=[1,11,16,25,34,35])
        with self.assertRaises(ValueError): m.merge([a],[b],'test')
    def test_mirror_sample(self):
        arr=[]
        for r in range(1,101):
            day=m.FIRST+dt.timedelta(weeks=r-1)
            arr.append({'drawNo':r,'date':day.isoformat(),'numbers':[1,2,3,4,5,6],'bonusNo':7,'prizes':[]})
        self.assertEqual(len(m.mirror_rows({'data':arr})),100)

if __name__=='__main__':
    unittest.main()
