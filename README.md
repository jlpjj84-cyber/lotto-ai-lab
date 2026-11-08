# LOTTO LAB 3.0 — GitHub 자동 갱신 웹 관제실

로또 6/45 **공개 추첨 결과**를 저장·분석하는 정적 웹사이트입니다. KStock과 별도 저장소로 운영합니다.

## 1회 설정 (GitHub 계정 주인)

1. GitHub에서 **New repository** → `lotto-ai-lab` → **Public** → Create repository. GitHub Pages 무료 배포를 위해 공개 저장소를 사용합니다. 개인 구매 기록이나 API 키를 저장소에 올리지 마세요.
2. 이 ZIP의 **폴더 내용**을 해당 저장소 `main` 브랜치에 업로드/커밋합니다. GitHub UI의 **Add file → Upload files** 화면에 압축 해제한 폴더 내용 전체를 드래그하거나, GitHub Desktop에서 커밋하세요. ZIP 파일 자체를 올리면 사이트로 배포되지 않습니다.
3. 저장소 **Settings → Pages → Build and deployment → Source: GitHub Actions** (별도 브랜치 배포 아님).
4. 배포 성공 후 주소: `https://<GitHub아이디>.github.io/lotto-ai-lab/` (계정명에 따라 바뀜). GitHub Actions의 `Publish latest dashboard + draw data` 작업이 웹 배포를 수행합니다.
5. **Actions → Lotto results — update verified draw data → Run workflow** 한 번 실행해 전체 과거 데이터 확보를 시도하세요. 이후 토요일 밤 22:20, 일요일 09:20 KST 예약 실행됩니다. 자동 커밋 후 같은 워크플로의 배포 작업이 최신 JSON을 웹에 게시합니다. GitHub 예약 작업은 지연·누락될 수 있으므로 일요일 결과를 확인해 주세요.

> GitHub에서 새 저장소를 만들고 이름을 알려주면, 연결된 GitHub 도구로 파일 업로드를 도와줄 수 있습니다. 현재 연동에서 새 저장소 생성 및 Pages 활성화 기능은 제공되지 않습니다.

## 보안·데이터 저장

- `data/draws.json`: **공개 당첨번호만** 저장. 처음에는 1150~1249회 100회가 들어 있습니다.
- 첫 Actions 실행은 외부의 MIT 공개 역사 데이터셋으로 이전 회차를 보충하고, 새 회차는 **동행복권 공개 조회 경로**에서 확인합니다. 수집이 실패하면 기존 데이터는 유지하며 로그에 오류가 기록됩니다. 과거 자료 출처: `JunKwon91/lotto-data` (MIT).
- 번호 생성/구매 기록은 사이트를 연 **해당 기기의 브라우저 localStorage**에 저장되고 GitHub에 전송되지 않습니다. 브라우저 데이터 삭제나 기기 변경 시 사라질 수 있으니 `데이터 관리 → JSON 백업`을 이용하세요.
- 기존 LOTTO LAB 2.0 구매 기록은 **2.0에서 전체 백업 JSON 다운로드 → 3.0에서 JSON 백업 불러오기**로 복원할 수 있습니다.
- 사이트는 실제 복권 구매를 하지 않습니다. 번호 자동 추천은 **예측력이 검증되지 않았으며**, 모든 조합의 1등 확률은 동일합니다.

## 수동 입력 및 장애 대응

공식 내부 조회 경로는 외부용 정식 API가 아니므로 차단 또는 변경될 수 있습니다. Actions가 실패하면 관리자만 `Run workflow` 입력란에 공식 발표 확인 결과를 입력하세요. 회차/날짜/6개 번호/보너스를 필수로 입력해야 합니다. 미래 회차, 충돌하는 회차, 불연속 회차는 거부됩니다.

데이터 동기화가 안 될 때에는 사이트에서 **데이터 관리 → CSV 파일 불러오기**를 사용할 수 있지만 이는 **해당 브라우저에서만** 적용됩니다. 공개 GitHub 데이터는 Actions 또는 커밋으로 갱신해야 합니다.

## 참고
- 동행복권 공식 추첨: https://www.dhlottery.co.kr/lt645/result
- 과거 데이터 참고/라이선스: https://github.com/JunKwon91/lotto-data (MIT)
- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site

본 프로젝트는 동행복권 공식 서비스가 아닌 개인 통계 실험용입니다.