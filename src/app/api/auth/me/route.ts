/**
 * GET /api/auth/me — 세션 복원 엔드포인트.
 *
 * REQ-AUTH-INT-001: at 쿠키를 읽어 jose(HS256)로 검증, 유효하면 200 OK + 사용자 정보 반환
 * REQ-AUTH-INT-002: at 쿠키 없음/만료/무효 → 401 Unauthorized
 * REQ-AUTH-INT-003: middleware.ts와 동일한 JWT_SECRET + jose 검증
 *
 * @MX:NOTE: [AUTO] 순수 비즈니스 로직은 src/lib/api/auth.ts에 분리하여 단위 테스트 가능.
 *                 이 route.ts는 Next.js 래퍼 역할만 담당.
 */

import { handleGetMe } from '../../../../lib/api/auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleGetMe(request);
  } catch (error) {
    // 예기치 못한 에러 처리
    console.error('[/api/auth/me] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다' },
      { status: 500 }
    );
  }
}
