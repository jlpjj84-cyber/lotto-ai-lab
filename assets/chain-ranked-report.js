import { contextName } from './chain-auto.js';
const safe = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const f = n => Number.isFinite(n) ? n.toFixed(6) : '검증 대기';

export function rankedNumberReason(record, game, number) {
  const r = record.research, t = r.trace[game], d = t.decisions.find(d => d.number === number);
  if (t.method === 'uniform-control') return `${number}번: 별도 무작위 대조군. 후보 ${d.pool}개에서 균등 추출했으며 분석 점수·연쇄 관계는 사용하지 않았습니다.`;
  const score = r.model.scores[number - 1];
  const related = d.influences.map(id => r.model.candidates.find(p => p.id === id)).filter(Boolean);
  const introduction = `${number}번: 분석 점수 ${f(d.score)}, 전체 ${d.rank}/45위. 이전 게임 ${d.priorUses}회 사용 감점 ${f(d.diversityPenalty)} 후 선정 점수 ${f(d.selectionScore)}, 이 게임 ${d.selectionRank}위, ${d.step}번째 선정. ${score.evidenceStatus}.`;
  if (!related.length) return introduction + ' 조건 표본이 없어 점수 0입니다. 동점은 이전 사용 횟수와 번호 오름차순으로 결정했습니다. 역사적 원인을 만들지 않습니다.';
  return introduction + ` 총 ${score.relationCount}개 조건을 집계했습니다. 대표 관계: ` + related.map(p =>
    `${contextName(p.context)} → ${number} (실제 ${p.successes}/${p.trials}회, ${(p.conditionalRate * 100).toFixed(2)}%, 점수 기여 ${f(p.contribution * 100)}, 최근 성공 ${p.successfulTargets.slice(-3).join('·') || '없음'}, ${p.validation.status})`).join('; ') +
    `. 나머지 조건 점수 합계 ${f(score.remainingContribution * 100)}. 점수는 미래 당첨 확률이 아닙니다.`;
}

export function rankedRecommendationHTML(record, scoreLabels = []) {
  const r = record.research, control = r.mode === 'control', v = r.validation;
  if (!r.model?.scores || !r.trace) return '<p>생성 당시 점수 기록이 없습니다.</p>';
  return `<section class="recommendation-overview"><h3>10번째 · ${control ? '별도 균등 무작위 대조군' : '45개 분석 점수 기반 실험 추천'}</h3><p>${control ? '이 대조군은 분석 점수 추천과 분리되어 있으며 번호를 추천 조합에 섞지 않습니다.' : '45개 번호 전체를 평가한 후 순위를 정하고, 이전 게임 사용 횟수에 따른 명시적 감점을 적용해 6개씩 선정했습니다. 5번째 게임도 같은 규칙입니다.'}</p><p>검증된 추천으로 표시하지 않습니다. 과거 워크포워드 ${v.n}회: ${safe(v.status)}. 평균 ${f(v.experimentalMean)} / 대조군 ${f(v.baselineMean)}.</p><p>점수 = 조건별 완화 편차를 관계 유형 안에서 신뢰도 평균한 뒤 유형별로 동일 비중 합산 ×100. 동점은 사용 횟수와 번호 오름차순입니다. ${record.comparable ? '' : '변경된 옵션은 기본 평가와 직접 비교하지 않습니다.'}</p></section>` +
    record.lines.map((line, i) => {
      const t = r.trace[i];
      return `<section class="recommendation-game"><h3>${i + 1}게임 · ${control ? '무작위 대조군' : '분석 점수 순위 선정'}</h3><div class="live-game"><span>${line.join(' · ')}</span>${scoreLabels[i] ? `<span>${safe(scoreLabels[i])}</span>` : ''}</div><p class="recommendation-narration">${control ? '실험 추천과 별도의 균등 추첨입니다.' : `6개 모두 분석 점수와 분산 규칙으로 결정했습니다. 게임 간 감점 단위 ${f(t.diversityScale)}. 무작위 채우기는 없습니다.`}</p><details class="recommendation-detail"><summary>6개 번호의 점수·순위·실제 관계·검증 상태</summary><div class="tablewrap"><table class="datatable"><thead><tr><th>번호</th><th>선정 과정</th></tr></thead><tbody>${line.map(n => `<tr><td>${n}</td><td class="auto-reason">${safe(rankedNumberReason(record, i, n))}</td></tr>`).join('')}</tbody></table></div></details>` +
        (control ? '' : `<details><summary>선정 전 45개 후보 점수와 6단계 기록</summary><div class="tablewrap"><table class="datatable"><thead><tr><th>번호</th><th>분석 점수</th><th>전체 순위</th><th>이전 사용</th><th>감점</th><th>선정 점수</th><th>선택 가능</th></tr></thead><tbody>${t.preGameScores.map(p => `<tr><td>${p.number}</td><td>${f(p.score)}</td><td>${p.rank}</td><td>${p.priorUses}</td><td>${f(p.diversityPenalty)}</td><td>${f(p.selectionScore)}</td><td>${p.eligible ? '예' : '분산 옵션 제외'}</td></tr>`).join('')}</tbody></table></div><p>동일 조합 제외로 건너뛴 후보 ${t.uniquenessSkips}개.</p>${t.decisions.map(d => `<p>${d.step}단계: ${d.number}번, 후보 ${d.pool}개 [${d.remainingCandidates.join(', ')}], 선정 점수 ${f(d.selectionScore)}.</p>`).join('')}</details>`) + '</section>';
    }).join('');
}

export function rankedRecommendationReport(record) {
  const r = record.research, control = r.mode === 'control';
  const text = [`${record.round}회 v${record.version} · 10번째 연쇄 패턴 기반 실험 추천 · ${control ? '별도 무작위 대조군' : '분석 점수 순위 선정'}`,
    `원자료 ${record.historyFirst}~${record.dataRound}회 · SHA-256 ${r.data.sha256}`,
    '순서: 45개 점수 산출 → 전체 순위 → 이전 사용 감점 → 6개 선정 → 근거 기록',
    r.validation.status, '점수는 당첨 확률이나 검증된 예측 우위를 뜻하지 않습니다.'];
  if (!control) text.push('45개 전체 점수: ' + r.model.scores.map(s => `${s.number}:${f(s.score)}(${s.rank}위)`).join(', '));
  record.lines.forEach((line, i) => { text.push('', `${i + 1}게임: ${line.join(' ')}`); line.forEach(n => text.push(rankedNumberReason(record, i, n))); });
  return text.join('\n');
}
