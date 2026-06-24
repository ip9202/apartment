# Interview: 카카오 OAuth 소셜 로그인 (SPEC-AUTH-KAKAO-001)

## Round 1: Scope (계정 처리 + 동호수 인증)

### Q1: 카카오 로그인 사용자의 계정 처리 정책
Question: 카카오 로그인 사용자의 계정을 어떻게 처리할까요?
Answer: 이메일 기준 자동 연결 — 카카오가 제공한 이메일이 기존 계정과 같으면 해당 계정에 카카오 로그인 수단을 연결하고, 기존에 없으면 새 RESIDENT 계정을 자동 가입.

### Q2: 카카오 사용자의 동/호수 인증(verified)
Question: 카카오 로그인 사용자의 동/호수 인증을 어떻게 처리할까요?
Answer: 기존 verify-unit 플로우 유지 — verified:false면 /verify 화면으로 이동. 기존 인증 정책(src/middleware.ts)과 일관.

## Clarity Score
Initial: 7/10
Final: 9/10 (핵심 비즈니스 결정 확정)
Rounds completed: 1
