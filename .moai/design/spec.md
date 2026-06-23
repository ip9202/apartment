# Design Specification

> Source: Claude Design 시안 분석 (아이뜨락, 12개 화면) · 2026-06-23
> 백엔드 도메인과 1:1 매핑 · 구현 우선순위: 토큰 → 레이아웃 셸 → 홈 → 도메인별

---

## Functional Inventory

| Feature / Page | 백엔드 상태 | In Scope | 비고 |
|----------------|------------|----------|------|
| 로그인 | auth | ✓ | 카카오 + 이메일 |
| 회원가입 | auth | ✓ | 동/호수 포함 |
| 동/호수 거주인증 | verification | ✓ | 백엔드 도메인 확인 필요 |
| 홈 (대시보드 허브) | — | ✓ | 역할별 분기 |
| 공지사항 / 상세 | notice | ✓ | 백엔드 도메인 확인 필요 |
| 건의사항 / 등록 / 상세 | suggest ✓ | ✓ | SPEC-SUGGEST-001 완료 |
| 주차 추첨 | parking ✓ | ✓ | SPEC-PARKING-001 완료 |
| 마이페이지 | auth | ✓ | |
| 관리 대시보드 | (통합) | ✓ | 관리자 전용 |

## Information Architecture

```
Root
├── (공용 — 미인증)
│   ├── 로그인
│   └── 회원가입
├── (입주민 — 거주인증 후)
│   ├── 홈
│   ├── 공지사항 → 공지 상세
│   ├── 건의사항 → 건의 등록 / 건의 상세
│   ├── 주차 추첨
│   └── 마이페이지
└── (관리자)
    └── 관리 대시보드 (공지 발행 / 건의 처리 / 주차 배정 / 거주 승인)
```

## Frame-by-Frame Redesign

### Frame: 로그인
**Goal**: 카카오/이메일 진입 장벽 최소화
**Key interactions**: 카카오 버튼(노란 브랜드) / 이메일+비밀번호 / 회원가입 링크
**Content hierarchy**: 로고(아이뜨락) → 카카오 버튼 → 구분선 → 이메일 폼 → 가입 링크

### Frame: 회원가입
**Goal**: 이메일·비밀번호·동/호수 수집
**Key interactions**: 이메일 / 비밀번호(8자+영문숫자) / 비밀번호 확인 / 동·호 선택
**Content hierarchy**: 단계 폼 + 실시간 검증

### Frame: 동/호수 거주인증
**Goal**: 거주 신뢰 확보 (H2: "거주 중인 동/호수를 인증해 주세요")
**Key interactions**: 동 선택 → 호 선택 → 인증하기

### Frame: 홈
**Goal**: 역할별 대시보드 허브 (H1: "홈", H2: "안녕하세요, A동 201호 입주민님 👋")
**Key interactions**: 환영 헤더 + 도메인 바로가기 카드 그리드 + 최근 공지 요약
**Content hierarchy**: 역할 인사 → 기능 카드(공지/건의/주차) → 알림

### Frame: 공지사항 / 공지 상세
**Goal**: 공지 목록 + 상세 열람 (H2: `{{ selectedNotice.title }}`)

### Frame: 건의사항 / 건의 등록 / 건의 상세
**Goal**: 건의 등록(제목 100자 + 카테고리 + 내용) + 처리 상태 추적 (H2: `{{ selectedSuggestion.title }}`)
**연동**: SPEC-SUGGEST-001 API

### Frame: 주차 추첨
**Goal**: 기간제 주차 자리 추첨 참여 + 결과 + 투명성 정보 (`{{ parkingBtnLabel }}` 동적)
**연동**: SPEC-PARKING-001 API (회차생성/추첨/취소/자동배정/공개/열람/투명성)

### Frame: 마이페이지
**Goal**: 내 정보 + 거주인증 상태 + 로그아웃

### Frame: 관리 대시보드
**Goal**: 관리자 통합 관리 (공지 발행 / 건의 처리 / 주차 배정 / 거주 승인)

## New Frames

없음 — Claude Design 시안이 12개 화면을 모두 커버.

## Empty State Design

| View | Empty State Message | CTA |
|------|-------------------|-----|
| 공지사항 | "등록된 공지가 없습니다" | (관리자: 공지 작성) |
| 건의사항 | "등록된 건의가 없습니다" | 건의 등록하기 |
| 주차 추첨(미진행) | "현재 진행 중인 추첨 회차가 없습니다" | — |
| 거주 미인증 | "거주 인증이 필요합니다" | 동/호수 인증하기 |

## Implementation Priority

사용자 확정: **기반부터** (디자인 토큰 + 레이아웃 셸 + 홈 먼저, 도메인별 순차 확장)

| Phase | Frame | Priority | Dependencies |
|-------|-------|----------|--------------|
| 1 | 디자인 토큰 (Tailwind @theme) | High | — |
| 1 | 레이아웃 셸 (헤더/네비/푸터) | High | 토큰 |
| 1 | 홈 화면 | High | 셸 |
| 2 | 로그인/회원가입/거주인증 | Medium | 셸, auth API |
| 2 | 주차 추첨 | Medium | 셸, parking API ✓ |
| 2 | 건의사항 | Medium | 셸, suggest API ✓ |
| 3 | 공지사항 | Low | notice API (백엔드 확인) |
| 3 | 마이페이지 / 관리 대시보드 | Low | — |

## Acceptance Criteria

- [ ] 디자인 토큰이 system.md 기준으로 Tailwind 4 `@theme`에 정의됨
- [ ] 레이아웃 셸이 모바일(390)·태블릿(768)·데스크탑(1280) 반응형 대응
- [ ] 홈 화면이 역할별(입주민/관리자) 분기 렌더링
- [ ] Pretendard 폰트 로드 및 웨이트 스케일 적용
- [ ] 색상 대비 WCAG 2.1 AA 통과 (본문/보조 텍스트)
- [ ] 도메인 화면이 기존 백엔드 API(parking/suggest)와 정합

---

_Last updated: 2026-06-23_
_Populated by: Claude Design HTML 분석 (MoAI orchestrator)_
