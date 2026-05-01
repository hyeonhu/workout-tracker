# 증량일지

근비대 목표의 4분할 운동 기록 앱입니다.  
React, Vite, Tailwind CSS, Firebase Firestore, Anonymous Auth, PWA, GitHub Pages 기준으로 구성되어 있습니다.

## 실행

```bash
npm install
npm run dev
```

## 확인

```bash
npm run check
npm run typecheck
```

로컬 환경에 따라 `npm run build`는 `esbuild spawn EPERM`으로 실패할 수 있습니다.  
이 저장소에서는 기본 검증을 `npm run check`로 수행합니다.

## 이번 업데이트

- `load_type`
  - `barbell_total`
  - `dumbbell_each_hand`
  - `stack_weight`
  - `plate_per_side`
  - `smith_total`
  - `bodyweight_progression`
- `entry_mode` / `display_mode`
  - 바벨/스미스는 `한쪽 + 바`
  - 덤벨은 `한 손`
  - 케이블/머신은 `스택`
  - 레그프레스는 `한쪽`
  - 맨몸/플랭크는 `맨몸` 또는 `초`
- `normalized_total_load`
  - 내부 계산은 모두 총중량 기준입니다.
  - e1RM, 볼륨로드, 차트, 웜업 퍼센트 계산에 사용합니다.
  - 기존 바벨 기록은 `한쪽 중량`으로 해석하고 `base_weight`를 더해 총중량으로 계산합니다.

## 웜업 안내

- 첫 운동
  - 종목의 `load_type`에 따라 전체 웜업 안내를 보여줍니다.
  - 예: 빈바/가벼운 무게 → 50% → 70%
- 이후 운동
  - 필요한 운동에만 작은 미니 웜업 안내를 보여줍니다.
  - 예: `가벼운 무게 1세트 ×8 추천`, `무릎 적응세트 1개 추천`
- A2 `레그 익스텐션`은 바로 앞 `레그프레스`와 같은 패턴이라 미니 웜업을 따로 띄우지 않습니다.

## 현재 루틴 메모

- 레그 익스텐션은 `stack_weight`
- B2 힙쓰러스트는 `스미스 힙쓰러스트`
- B2 로우는 `인클라인 벤치 체서 덤벨 로우`
- EZ바 컬은 케이블이 아니라 프리웨이트 EZ바 컬로 유지
