# 운동 트래커

근비대 목표의 4분할 운동 트래커입니다. React, Vite, Tailwind CSS, Firebase Firestore, Anonymous Auth, PWA, GitHub Pages 배포를 기준으로 구성되어 있습니다.

## 실행

```bash
npm install
npm run dev
```

## 빌드

```bash
npm run build
```

GitHub Pages 배포용 `base`는 `vite.config.js`에 `/workout-tracker/`로 설정되어 있습니다.

## Firebase

Firestore Rules에는 `firestore.rules` 내용을 적용하세요. 복구 코드를 이용한 데이터 재연결을 위해 `userAccess` 컬렉션 권한도 포함되어 있습니다.

필요한 Firebase 기능:

- Authentication: Anonymous provider 활성화
- Firestore Database 생성

## PWA

iPhone Safari에서 배포 URL을 연 뒤 공유 버튼에서 “홈 화면에 추가”를 선택하면 앱처럼 사용할 수 있습니다.

## 중량 기준

- 바벨: 한쪽 원판 무게 기준
- 덤벨: 덤벨 개당 무게 기준
- 머신/케이블: 기구에 표시된 무게 또는 한 칸 기준

설정 화면에서 종목별 증량폭을 바꿀 수 있습니다.
