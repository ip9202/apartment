/**
 * POST /api/parking/rounds — 회차 생성 (SPEC-PARKING-001 M1, PARKING-01).
 *
 * REQ-PK-001 (ADMIN/CHAIR 생성 → 201), REQ-PK-002 (기간 역전 422),
 * REQ-PK-003 (자리풀 부족 422), REQ-PK-004 (미인증 401), REQ-PK-005 (비권한 403).
 *
 * @MX:NOTE: [AUTO] slot assignment 도메인 — 자리풀(slot_pool)은 회차 생성 시 동적 입력(JSONB).
 *           시스템 고정 1~38 아님. 관리소가 회차마다 자리 번호 풀을 직접 입력.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { query } from '../../../../lib/db';
import { requirePrivileged, validationError } from '../../../../lib/rbac';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const createRoundSchema = z.object({
  name: z.string().min(1, '회차 이름은 필수입니다').max(100, '회차 이름은 100자 이하여야 합니다'),
  application_start: z.string().refine((v) => ISO_RE.test(v), 'application_start 형식 오류'),
  application_end: z.string().refine((v) => ISO_RE.test(v), 'application_end 형식 오류'),
  slot_pool: z
    .array(z.string().min(1))
    .min(1, '자리풀은 최소 1개 이상이어야 합니다'),
});

export async function POST(request: Request): Promise<Response> {
  const auth = await requirePrivileged(request, ['ADMIN', 'CHAIR']);
  if ('response' in auth) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationError('요청 본문이 올바른 JSON 이 아닙니다');
  }

  const parsed = createRoundSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '유효성 검증 실패');
  }
  const { name, application_start, application_end, slot_pool } = parsed.data;

  // REQ-PK-002: 기간 역전 금지
  if (new Date(application_start) >= new Date(application_end)) {
    return validationError('신청 시작일은 종료일보다 이전이어야 합니다');
  }

  // REQ-PK-003: 자리풀 >= 세대수 (units 테이블 행 수)
  const unitCountRes = await query<{ n: number }>('SELECT COUNT(*)::int AS n FROM units');
  const unitCount = unitCountRes.rows[0].n;
  if (slot_pool.length < unitCount) {
    return validationError(
      `자리풀(${slot_pool.length}개)은 세대수(${unitCount}세대) 이상이어야 합니다`,
    );
  }

  // REQ-PK-001: seed 자동 생성 (randomBytes 16 → base64, 불변)
  const seedValue = randomBytes(16).toString('base64');

  const insRes = await query<{
    id: string;
    name: string;
    application_start: string;
    application_end: string;
    slot_pool: string[];
    seed_value: string;
    status: string;
    is_published: boolean;
    created_at: string;
  }>(
    `INSERT INTO parking_rounds (name, application_start, application_end, slot_pool, seed_value)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, application_start, application_end, slot_pool, seed_value, status, is_published, created_at`,
    [
      name,
      application_start,
      application_end,
      JSON.stringify(slot_pool),
      seedValue,
    ],
  );

  const row = insRes.rows[0];
  return NextResponse.json(
    {
      success: true,
      data: {
        id: row.id,
        name: row.name,
        application_start: row.application_start,
        application_end: row.application_end,
        slot_pool: row.slot_pool,
        seed_value: row.seed_value,
        status: row.status,
        is_published: row.is_published,
        created_at: row.created_at,
      },
    },
    { status: 201 },
  );
}
