# Design System

> Source: Claude Design 시안 분석 (아이뜨락) · 2026-06-23
> Tailwind 4 `@theme` 매핑 기준 — 색상은 Tailwind 기본 팔레트와 1:1 대응

---

## Design Intent

신뢰의 블루(아이뜨락)를 중심으로, 거주인증 기반 아파트 커뮤니티의 생활 기능(공지·건의·주차)을 모바일 우선·소프트한 라운드로 친근하게 제공한다. 정보 밀도는 높되 카드+보더로 계층을 명확히 하고, 역할별(입주민/관리자)로 보이는 범위를 분기한다.

## Domain Vocabulary

| Term | Definition |
|------|-----------|
| 거주인증 | 동/호수 기반 신뢰 확보 — 인증 전까지 커뮤니티 기능 잠김 |
| 입주민 | 일반 거주자 역할 (읽기/등록 권한) |
| 관리자 | 동 호별 관리 권한 (승인/배정/공지 권한) |
| 주차 추첨 | 기간제 주차 자리 결정론적 배정 (HMAC-SHA256 + Fisher-Yates, 공정성/투명성 보장) |
| 건의/문의 | 입주민 → 관리자 비동기 커뮤니케이션 |

## Craft Principles

- **신뢰 우선**: 블루 브랜드 + 거주인증 게이팅. 미인증자에게 민감 정보 노출 금지 (백엔드 RBAC 정합)
- **공정성 가시화**: 주차 추첨 등 결정론적 결과는 투명성 로그/해시를 사용자에게 노출
- **역할 분기**: 👤/🔧 전환 시 보이는 데이터/액션 즉시 변경
- **모바일 우선**: 390px 기준 설계 후 데스크탑 멀티컬럼 확장
- **상태 명확**: success/error/warning을 틴트 배지로 즉시 인지

## Color Tokens

### 브랜드 (primary — Blue)
| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| `color.primary.50`  | `#EFF6FF` | blue-50  | 선택/호버 서피스 틴트 |
| `color.primary.100` | `#BFDBFE` | blue-100 | 라이트 액센트 |
| `color.primary.300` | `#93C5FD` | blue-300 | 라이트 액센트 |
| `color.primary.600` | `#2563EB` | blue-600 | **메인 버튼/링크** (최빈값) |
| `color.primary.700` | `#1D4ED8` | blue-700 | 버튼 호버/강조 |
| `color.primary.900` | `#1E3A8A` | blue-900 | 딥 서피스, 썸네일 배경 |

### 중성 (neutral — Gray)
| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| `color.neutral.0`   | `#FFFFFF` | white    | 카드 서피스 |
| `color.neutral.50`  | `#F9FAFB` | gray-50  | 페이지 배경 |
| `color.neutral.100` | `#F3F4F6` | gray-100 | 서브 서피스 |
| `color.neutral.200` | `#E5E7EB` | gray-200 | 디바이더/얇은 보더 |
| `color.neutral.300` | `#D1D5DB` | gray-300 | 보더 |
| `color.neutral.400` | `#9CA3AF` | gray-400 | 플레이스홀더/비활성 |
| `color.neutral.500` | `#6B7280` | gray-500 | 보조 텍스트 |
| `color.neutral.700` | `#374151` | gray-700 | 본문 텍스트 |
| `color.neutral.900` | `#111827` | gray-900 | 헤딩/강 텍스트 (최빈값) |

### 상태 (semantic)
| Token | Main | BG (Tint) | Tailwind |
|-------|------|-----------|----------|
| `color.error`   | `#DC2626` | `#FEF2F2` | red-600 / red-50 |
| `color.success` | `#16A34A` | `#F0FDF4` | green-600 / green-50 |
| `color.success.strong` | `#15803D` | — | green-700 |
| `color.warning` | `#D97706` | `#FEF3C7` | amber-600 / amber-100 |

## Typography

- **Typeface**: Pretendard (한글), fallback `-apple-system, system-ui, sans-serif`
- **웨이트 사용**: 700(본문 강조, 최빈) / 600(본문) / 900(헤드라인) / 500(보조) / 400(기본)

| Role | Weight | Size | Line Height |
|------|--------|------|-------------|
| Display/Hero | 900 | 52–90px | 1.1 |
| H1 | 800–900 | 26–30px | 1.2 |
| H2 | 700 | 22–24px | 1.3 |
| H3 | 700 | 18–20px | 1.4 |
| Body | 600–700 | 14–17px | 1.5 |
| Body small | 500 | 13px | 1.5 |
| Caption/Label | 500–600 | 10–12px | 1.4 |

## Spacing / Radius / Shadow

- **Base unit**: 4px 그리드
- **Spacing scale**: 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 / 32px
- **gap (flex/grid)**: 4 / 6 / 8 / 10 / 12 / 14px (10·12 최빈)
- **padding (카드)**: `16px 20px` · `20px` · `16px` · `14px`
- **Border radius**: sm `8` · md `10/12` (기본) · lg `14/16` · xl `17` — **소프트 라운드 중심**
- **Shadow levels**: 얕음 `0 1px 4px rgba(0,0,0,0.12)` (토스트/로딩) · 카드는 보더(gray-200) 위주, 그림자 최소화

## Iconography

- **Library**: _TBD_ (emoji 사용 관찰: 👤 입주민 / 🔧 관리자 / 👋 환영). 프로덕션은 lucide-react 또는 heroicons 제안
- **Default size**: 16 / 20 / 24px

## Layout Rules

- **Grid**: 모바일 단일 컬럼 → 데스크탑 멀티컬럼 (flex 주력 115회 / grid 보조 9회)
- **Max width (컨테이너)**: 모바일 390 / 태블릿 420·460 / 데스크탑 440·680·800·860·1000px
- **Breakpoints** (Tailwind 매핑 제안): `sm 640` / `md 768`(태블릿) / `lg 1024` / `xl 1280`(데스크탑)
- **외부 배경**: 모바일 캡처는 `#b8bcc8` 외부 회색 + 중앙 정렬(앱 쉘 느낌)

## Motion

- **Default duration**: 150–200ms (UI 피드백)
- **Easing**: ease-out 기본 (상세 튜닝 _TBD_)

## Accessibility

- **WCAG level**: 2.1 AA 목표
- **Color contrast**: 본문 gray-900 on white (19.3:1) · gray-700 on gray-50 (통과) · 보조 텍스트 gray-500 사용 시 대비 주의
- **Focus indicator**: primary-600 링 2px
- **상태 색**: 색 외에 텍스트/아이콘 병기 (색각 이상 대응)

---

_Last updated: 2026-06-23_
_Populated by: Claude Design HTML 분석 (MoAI orchestrator)_
