# 오셀로 공용 기록 서버

Cloudflare Workers + D1로 이름, 난이도, 승패, 플레이 시간, 흑/백 돌 수를 저장합니다.
다다런과 오목의 기존 서버와 기록은 변경하지 않습니다.

## 공개하기

[Cloudflare에서 배포 시작](https://deploy.workers.cloudflare.com/?url=https://github.com/dahye1391-ai/dada-game/tree/main/record-server)

1. Cloudflare 계정으로 로그인하고 GitHub 저장소 연결을 허용합니다.
2. 배포할 프로젝트 위치는 `record-server`입니다. 설치 명령은 `npm ci`, 배포 명령은 `npm run deploy`입니다.
3. `wrangler.jsonc`에 선언된 D1 데이터베이스를 Wrangler가 자동 생성/연결합니다. 테이블은 첫 API 요청 때 생성되며 기존 데이터는 지우지 않습니다.
4. 배포가 끝나면 표시되는 `https://dada-othello-records.<계정>.workers.dev` 주소를 확인합니다.
5. 저장소 루트의 `records-config.js`에서 `window.DADA_OTHELLO_API_BASE` 값을 그 주소로 설정하고 GitHub Pages에 반영합니다. 이 주소는 공개 주소이며 비밀 키가 아닙니다.

배포 도우미가 저장소의 하위 폴더를 자동 인식하지 못하면 Cloudflare Workers의 GitHub 가져오기에서 `dada-game`을 선택하고 Root directory를 `record-server`로 지정합니다.

계정 로그인/연결 없이는 클라우드 배포가 완료되지 않습니다. 설치 및 dry-run은 배포와 다릅니다.
브라우저에 보관된 전송 대기 기록은 연결 후 게임의 ‘공용 기록 저장 다시 시도’로 전송할 수 있습니다.

## 개발 및 확인

Node.js 22.13 이상을 사용합니다. 프로젝트 위치에서 실행합니다.

```sh
npm ci
npm test
npm run check
npm run dev -- --local --ip 127.0.0.1 --port 8787 --var ALLOWED_ORIGINS:http://127.0.0.1:8000
```

로컬 프런트엔드 연결 테스트는 `records-config.js`의 API 주소를 일시적으로 `http://127.0.0.1:8787`로 설정하거나 브라우저 테스트에서 해당 스크립트 요청을 대체합니다. 로컬 주소를 커밋하지 않습니다.

- `GET /health`: 프로세스 상태. 데이터베이스 연결까지 검증하지 않습니다.
- `GET /api/othello/scores`: 최신 100개를 `{ "scores": [...] }`로 반환.
- `POST /api/othello/scores`: `id`(UUID v4), `name`(1~16자), `difficulty`(`easy`/`normal`/`hard`), `result`(`win`/`loss`/`draw`), `durationSeconds`, `blackScore`, `whiteScore`를 JSON으로 저장. 새 기록은 201, 동일 id/내용 재전송은 200, 같은 id의 다른 내용은 409.
- `OPTIONS /api/othello/scores`: GitHub Pages에서 호출할 수 있도록 CORS 처리.

`ALLOWED_ORIGINS`는 허용할 웹사이트 origin의 쉼표 구분 목록입니다. 기본 공개 사이트는 `https://dahye1391-ai.github.io`입니다.

기록은 D1에 보관되며 Worker 재배포 때 사라지지 않습니다. 관리가 필요한 기록은 Cloudflare D1 콘솔에서 수정/삭제할 수 있습니다.
경기는 브라우저에서 진행되므로 서버는 입력 형식과 점수/승패 일치 여부를 검사하지만 실제 경기를 재연산하지 않습니다.
