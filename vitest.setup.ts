import { config } from 'dotenv';
import { resolve } from 'node:path';
import '@testing-library/jest-dom';

// 테스트 실행 전 .env.local 로드 — src/lib/env.ts 의 fail-fast 검증이 통과하도록 보장.
config({ path: resolve(process.cwd(), '.env.local') });

// 모든 DB 기반 테스트는 TEST_DATABASE_URL 로 라우팅한다 (SPEC-AUTH-001 제약).
// db.ts 는 process.env.DATABASE_URL 에서 연결 문자열을 읽으므로, 테스트 컨텍스트에서는
// DATABASE_URL 을 TEST_DATABASE_URL 로 치환하여 개발 DB(aitteulak) 오염을 방지한다.
if (process.env.TEST_DATABASE_URL && !process.env.DISABLE_TEST_DB_ROUTING) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
