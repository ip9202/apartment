# Design Research

> Source: Claude Design HTML 3종 (mobile 390px / tablet / desktop) — 아이뜨락 아파트 커뮤니티
> 분석일: 2026-06-23 · 방식: Claude Design "bundler" 자가압축 포맷 파싱 (22MB는 gzip JS 번들, 실제 디자인은 88KB template 페이지)

---

## Research Scope

- **대상**: 아파트 커뮤니티 관리 서비스 "아이뜨락"의 전체 UI
- **세그먼트**: 입주민(일반 거주자) + 관리자(동 호별 관리 권한)
- **디자인 문제**: 거주인증 기반 신뢰 커뮤니티 — 공지·건의·주차추첨 등 생활 기능을 단일 화면에서 처리

## Competitor / Reference Analysis

Claude Design 산출물 자체를 레퍼런스로 분석. 추가 경쟁사는 _TBD_.

| Reference | Strengths | Weaknesses | Design Patterns to Note |
|-----------|-----------|------------|------------------------|
| Claude Design 시안 (아이뜨락) | Tailwind 표준 팔레트로 일관성 확보, Pretendard 한글 최적화, 역할(입주민/관리자) 분기 명확 | 정적 뷰포트 캡처라 미디어쿼리 아님(3파일), 정보 밀도 높음 | 얕은 틴트 상태 배지, 카드+보더 스타일, blue 브랜드 신뢰 코드 |
| _TBD_ (경쟁 아파트앱) | | | |

## User Insights

아파트 커뮤니티 사용자 핵심 니즈 (Claude Design 시안에서 추론 + _TBD_ 보강 필요).

### Key Jobs-to-be-Done

- 거주자로서 우리 동/호수를 인증받아 신뢰할 수 있는 커뮤니티 기능 사용
- 공지사항을 놓치지 않고 확인
- 불편/건의 사항을 쉽게 등록하고 처리 상태 추적
- (기간제) 주차 자리 추첨에 공정하게 참여

### Pain Points

- 일반 커뮤니티와 달리 거주 인증이 신뢰의 전제 → 인증 없으면 기능 잠김
- 관리자/입주민 역할에 따라 보이는 정보가 달라야 함 (정보은닉)
- 주차 추첨은 공정성/투명성이 핵심 (결정론적 알고리즘 — 백엔드 SPEC-PARKING-001 참조)

### Behavioral Patterns

- 모바일 우선 (390px 기준 단일 컬럼 중앙 정렬)
- 역할 토글(👤 입주민 / 🔧 관리자)로 즉시 컨텍스트 전환
- 외부 로그인(카카오)으로 진입 장벽 최소화

## Patterns to Adopt

- **Tailwind 표준 팔레트 매핑**: 디자인 토큰 → Tailwind 4 `@theme` 변환이 1:1 직결 (blue-600 주 브랜드, gray 스케일 중성)
- **Pretendard**: 한글 가독성 최적, 웨이트 600~700 중심 본문 / 900 헤드라인
- **소프트 라운드**: radius 10~16px (친근함)
- **얕은 틴트 상태 배지**: success/error/warning을 짙은 텍스트 + 옅은 배경으로 표현
- **카드 + 보더**: 그림자 대신 gray-200 보더로 계층 분리 (깔끔한 정보 밀도)

## Anti-Patterns to Avoid

- 미디어쿼리 없이 뷰포트별 별도 파일로 렌더링 (→ Tailwind responsive breakpoint로 통일)
- 정보 과밀: Claude Design 시안은 한 화면에 많은 div(257개) — 적용 시 도메인별 페이지로 분산
- 거주 미인증자에게 민감 정보 노출 (백엔드 RBAC Option C와 정합)

## References

- Claude Design 시안: `~/Downloads/아이뜨락 아파트 관리*.html` (3종)
- 백엔드 SPEC: SPEC-PARKING-001 (주차 추첨, 결정론적 순열), SPEC-SUGGEST-001 (건의/문의)
- 폰트: Pretendard (Kil Hyung-jin, OFL) — https://github.com/orioncactus/pretendard

---

_Last updated: 2026-06-23_
_Populated by: Claude Design HTML 분석 (MoAI orchestrator)_
