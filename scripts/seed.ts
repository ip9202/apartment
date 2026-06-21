/**
 * db:seed 스크립트 — 초기 마스터 데이터 (건물/호수/역할).
 *
 * @MX:NOTE: [AUTO] SETUP SPEC 소유 데이터 — 현재 AUTH 테스트/런타임용 픽스처로 시드.
 *           SETUP 마이그레이션 선행 시 이 시드의 소유권이 SETUP 으로 이관됨.
 *
 * 멱등: ON CONFLICT DO NOTHING 으로 재실행 시 안전.
 * 사용:
 *   - npm run db:seed  (DATABASE_URL 사용, 독립 실행)
 *   - runSeed(pool)    (테스트에서 Pool 주입)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { config } from 'dotenv';

config({ path: resolve(process.cwd(), '.env.local') });

// A동 호수: 1/2/3/5/6/7/8층, 층당 1~4호 (4층 제외) = 7층 * (2+2+4) ... 실제 산출:
//   1층(101,102), 2층(201,202,203,204), 3층(301,302,303,304),
//   5층(501,502,503,504), 6층(601,602,603,604), 7층(701,702,703,704), 8층(801,802,803,804)
//   = 2 + 4*6 = 26
const ADONG_UNITS = [
  '101', '102',
  '201', '202', '203', '204',
  '301', '302', '303', '304',
  '501', '502', '503', '504',
  '601', '602', '603', '604',
  '701', '702', '703', '704',
  '801', '802', '803', '804',
];

// B동 호수: 2/3/5/6/7/8층, 층당 1~2호 (1층 제외) = 6층 * 2 = 12
const BDONG_UNITS = [
  '201', '202',
  '301', '302',
  '501', '502',
  '601', '602',
  '701', '702',
  '801', '802',
];

const ROLES = [
  { code: 'ADMIN', name: '관리사무소', sort_order: 1 },
  { code: 'CHAIR', name: '회장', sort_order: 2 },
  { code: 'REP', name: '동대표', sort_order: 3 },
  { code: 'AUDITOR', name: '감사', sort_order: 4 },
  { code: 'RESIDENT', name: '일반 입주민', sort_order: 5 },
];

/**
 * 주어진 풀에 초기 마스터 데이터를 시드.
 * 트랜잭션으로 묶어 원자성 보장. ON CONFLICT DO NOTHING 으로 멱등.
 */
export async function runSeed(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. 건물
    await client.query(
      `INSERT INTO buildings (name) VALUES ('A동'), ('B동')
       ON CONFLICT (name) DO NOTHING`,
    );

    // 2. A동 호수
    await client.query(
      `INSERT INTO units (building_id, unit_number)
       SELECT b.id, v.unit_number FROM buildings b
       CROSS JOIN (VALUES ${ADONG_UNITS.map((_, i) => `($${i + 1})`).join(', ')}) AS v(unit_number)
       WHERE b.name = 'A동'
       ON CONFLICT (building_id, unit_number) DO NOTHING`,
      ADONG_UNITS,
    );

    // 3. B동 호수
    await client.query(
      `INSERT INTO units (building_id, unit_number)
       SELECT b.id, v.unit_number FROM buildings b
       CROSS JOIN (VALUES ${BDONG_UNITS.map((_, i) => `($${i + 1})`).join(', ')}) AS v(unit_number)
       WHERE b.name = 'B동'
       ON CONFLICT (building_id, unit_number) DO NOTHING`,
      BDONG_UNITS,
    );

    // 4. 역할
    for (const role of ROLES) {
      await client.query(
        `INSERT INTO roles (code, name, sort_order)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING`,
        [role.code, role.name, role.sort_order],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 독립 실행 진입점 (npm run db:seed).
 * 마이그레이션 미적용 시 자동으로 001/002/003 적용 후 시드.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[seed] DATABASE_URL 이 설정되지 않았습니다');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    // 마이그레이션 자동 적용 (멱등) — 시드 전 스키마 보장
    const migrationsDir = resolve(process.cwd(), 'migrations');
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
      await pool.query(sql);
    }
    console.log(`[seed] 마이그레이션 ${files.length}개 확인/적용 완료`);

    await runSeed(pool);

    const buildings = await pool.query(`SELECT COUNT(*)::int AS n FROM buildings`);
    const units = await pool.query(`SELECT COUNT(*)::int AS n FROM units`);
    const roles = await pool.query(`SELECT COUNT(*)::int AS n FROM roles`);
    console.log(
      `[seed] 완료: 건물 ${(buildings.rows[0] as { n: number }).n}개, 호수 ${(units.rows[0] as { n: number }).n}개, 역할 ${(roles.rows[0] as { n: number }).n}개`,
    );
  } finally {
    await pool.end();
  }
}

// 직접 실행 시에만 main 호출 (테스트 import 시에는 runSeed 만 노출)
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(process.cwd(), 'scripts/seed.ts');
if (isDirectRun) {
  main().catch((err) => {
    console.error('[seed] 실패:', err);
    process.exit(1);
  });
}
