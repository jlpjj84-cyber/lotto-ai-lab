const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync, readdirSync } = require('node:fs');
const { draws } = require('../data/draws.json');
const rows = draws.filter(r => r.round <= 1251).sort((a,b)=>a.round-b.round);
const snapshot = import('../assets/chain-auto-record.js').then(r=>r.createAutoSnapshot(rows, {}, undefined, new Date('2026-11-22T02:00:00Z')));

test('independent original-data recount verifies all 45 scores, all 30 positions and every held-out forecast', async () => {
  const { auditRankedStudy } = await import('../scripts/audit-ranked-study.mjs');
  const report = auditRankedStudy(await snapshot, rows);
  assert.equal(report.scoresVerified,45); assert.equal(report.positionsVerified,30);
  assert.equal(report.walkForwardDrawsVerified,251); assert.equal(report.rankingModuleHasNoRng,true);
});

test('score selection cannot call RNG, ignores the comparison seed, preserves all five ranked games and rejects missing scores', async () => {
  const { generateChainGames } = await import('../assets/chain-auto.js');
  const model = (await snapshot).result.model, original = Math.random;
  Math.random = () => { throw Error('random selection is forbidden'); };
  try {
    const a = generateChainGames(model, { seed: 1 }), b = generateChainGames(model, { seed: 999 });
    assert.deepEqual(a,b); assert.equal(a.trace.length,5);
    assert.ok(a.trace.every(t=>t.method==='ranked' && t.decisions.length===6 && t.shared===false));
    assert.throws(()=>generateChainGames({...model,scores:model.scores.slice(1)}),/45개/);
  } finally { Math.random = original; }
});

test('default rank game is the global top six; later games apply the recorded diversity constraint', async () => {
  const r=(await snapshot).result;
  assert.deepEqual(r.recommendation.lines[0],[...r.model.scores].sort((a,b)=>a.rank-b.rank).slice(0,6).map(s=>s.number).sort((a,b)=>a-b));
  assert.ok(r.recommendation.trace[1].preGameScores.some(s=>s.diversityPenalty>0));
  const { generateChainGames }=await import('../assets/chain-auto.js');
  const unique=generateChainGames(r.model,{games:20,uniqueLines:true});
  assert.equal(new Set(unique.lines.map(line=>line.join(','))).size,20);
  const spread=generateChainGames(r.model,{games:7,spread:true});
  assert.equal(new Set(spread.lines.flat()).size,42);
});

test('actual last target is reproduced from its prior prefix without using the target outcome', async () => {
  const {automaticChainAnalysis}=await import('../assets/chain-auto.js');
  const prior=automaticChainAnalysis(rows.slice(0,-1)), full=(await snapshot).result;
  const last=full.validation.rounds.find(r=>r.round===1251);
  assert.deepEqual(prior.recommendation.lines,last.experimental);
  assert.deepEqual(prior.model.scores.map(s=>s.score),last.scoreVector);
});

test('every displayed selected-number score and relation matches its recorded selection, including game five', async () => {
  const rec=await import('../assets/chain-auto-record.js'), report=await import('../assets/chain-auto-report.js');
  const record=rec.chainRecommendationRecord(await snapshot);
  for(let game=0;game<5;game++) for(const d of record.research.trace[game].decisions){
    const reason=report.chainNumberReason(record,game,d.number);
    assert.ok(reason.includes(d.score.toFixed(6))); assert.ok(reason.includes(`${d.rank}/45위`));
    for(const id of d.influences){const p=record.research.model.candidates.find(p=>p.id===id);assert.ok(reason.includes(`${p.successes}/${p.trials}`));}
  }
  const control=rec.chainRecommendationRecord(await snapshot,'control');
  assert.ok(report.chainRecommendationReport(control).includes('별도 무작위 대조군'));
  for(const d of control.research.trace[4].decisions) assert.ok(report.chainNumberReason(control,4,d.number).includes('사용하지 않았습니다'));
});

test('historical 5.2.1 manual recommendations and their sealed hashes remain readable', async () => {
  const dir=__dirname+'/../data/chain-auto/snapshots/';
  const oldFile=readdirSync(dir).find(name=>JSON.parse(readFileSync(dir+name)).result.version==='5.2.1');
  assert.ok(oldFile,'original automatic snapshot must be preserved');
  const old=JSON.parse(readFileSync(dir+oldFile)),r=old.result;
  const {sealResearch}=await import('../assets/research-provenance.js');
  const manual=await sealResearch({schema:1,id:'old-ranked-compat',source:'manual',strategy:'chain-experiment',version:'5.2.1',
    generatedAtUTC:old.generatedAtUTC,round:r.model.target,drawDate:r.recommendation.date,seed:645,dataRound:r.data.latest,
    historyFirst:1,historyCount:r.data.count,options:{games:5,spread:false,uniqueLines:false},comparable:true,
    lines:r.recommendation.lines,research:{kind:'auto-chain',data:old.data,model:r.model,trace:r.recommendation.trace,validation:r.validation}});
  const before=JSON.stringify(manual),{verifyManual}=await import('../assets/research-archive.js');
  assert.equal(await verifyManual(manual),'verified');
  const {recommendationHTML,recommendationReport}=await import('../assets/recommendation-report.js');
  recommendationHTML(manual); recommendationReport(manual);
  assert.equal(JSON.stringify(manual),before);
});
