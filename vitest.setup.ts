import { config } from 'dotenv';
import { resolve } from 'node:path';
import '@testing-library/jest-dom';

// 테스트 실행 전 .env.test 로드 (우선순위)
// .env.test가 없으면 .env.local 사용
const envTestPath = resolve(process.cwd(), '.env.test');
const envLocalPath = resolve(process.cwd(), '.env.local');

try {
  require('fs').accessSync(envTestPath);
  config({ path: envTestPath });
} catch {
  config({ path: envLocalPath });
}

// 모든 DB 기반 테스트는 TEST_DATABASE_URL 로 라우팅한다 (SPEC-AUTH-001 제약).
// db.ts 는 process.env.DATABASE_URL 에서 연결 문자열을 읽으므로, 테스트 컨텍스트에서는
// DATABASE_URL 을 TEST_DATABASE_URL 로 치환하여 개발 DB(aitteulak) 오염을 방지한다.
if (process.env.TEST_DATABASE_URL && !process.env.DISABLE_TEST_DB_ROUTING) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
