/**
 * db:migrate 스크립트 — migrations/ 디렉토리의 SQL 파일을 순서대로 DATABASE_URL 에 적용.
 *
 * 사용: npm run db:migrate
 * 환경변수는 .env.local 또는 런타임 환경에서 로드 (--env-file=.env.local 권장).
 * 파일명 접두사(001, 002, 003) 순으로 정렬하여 실행한다.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { config } from 'dotenv';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATIONS_DIR = resolve(process.cwd(), 'migrations');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[migrate] DATABASE_URL 이 설정되지 않았습니다');
    process.exit(1);
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[migrate] 적용할 마이그레이션 파일이 없습니다');
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const file of files) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] 적용 중: ${file}`);
      await pool.query(sql);
      console.log(`[migrate] 완료: ${file}`);
    }
    console.log(`[migrate] 총 ${files.length}개 마이그레이션 적용 완료`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[migrate] 실패:', err);
  process.exit(1);
});
