import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom', // JSX 처리를 위해 jsdom 사용
    setupFiles: ['./vitest.setup.ts'],
    // DB 통합 테스트는 커넥션 풀 충돌/잠금 경합 방지를 위해 단일 fork 에서 직렬 실행.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      // Phase A 커버리지 범위는 라이브러리(src/lib)에 한정.
      // scripts/*.ts 의 main() 진입점은 CLI 러너로 dev DB 통합 실행(db:migrate/db:seed)으로 검증됨.
      include: ['src/lib/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/lib/migration-test-helpers.ts', 'src/types/**'],
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 70,
      },
    },
  },
});
