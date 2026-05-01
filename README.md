# 증량일지

근비대 목표의 4분할 운동 기록 앱입니다. React, Vite, Tailwind CSS, Firebase Firestore, Anonymous Auth, PWA, GitHub Pages 배포를 기준으로 구성되어 있습니다.

## 실행

```bash
npm install
npm run dev
```

## 확인

```bash
npm run check
```

로컬 환경에 따라 `npm run build`는 `esbuild spawn EPERM`으로 실패할 수 있습니다. 이 저장소에서는 기본 검증을 `npm run check`로 수행합니다.

## Firebase

필요한 Firebase 기능:

- Authentication: Anonymous provider
- Firestore Database

## 이번 업데이트

- `load_type`
  - `barbell_total`
  - `dumbbell_each_hand`
  - `stack_weight`
  - `plate_per_side`
  - `smith_total`
  - `bodyweight_progression`
- `entry_mode` / `display_mode`
  - 바벨과 스미스는 `한쪽 + 바`
  - 덤벨은 `한 손`
  - 케이블/머신은 `스택`
  - 레그프레스는 `한쪽`
  - 맨몸 코어는 `맨몸` 또는 `초`
- `normalized_total_load`
  - 내부 계산용 총중량입니다.
  - e1RM, 볼륨로드, 차트, 웜업 퍼센트 계산에 사용됩니다.
  - 기존 바벨 기록은 `한쪽 중량`으로 해석하고 `base_weight`를 더해 총중량으로 계산합니다.
- 웜업 helper
  - Today 화면에서 첫 운동 카드 위에만 작게 표시됩니다.
  - 별도 웜업 기록 UI는 추가하지 않았습니다.

## 현재 루틴 메모

- 레그 익스텐션은 `stack_weight`
- B2 힙쓰러스트는 `스미스 힙쓰러스트`
- B2 체스트 서포티드 로우는 `인클라인 벤치 체서 덤벨 로우`
- EZ바 컬은 케이블이 아니라 프리웨이트 바벨형 입력으로 유지
