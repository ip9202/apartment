---
id: "SPEC-ATTACHMENT-001"
version: "0.1.0"
status: "Draft"
created: "2026-06-24"
updated: "2026-06-24"
author: "강력쇠주먹"
priority: "P0"
issue_number: 0
---

# SPEC-ATTACHMENT-001: 첨부파일 (공지/건의 공용 — 업로드/열람/다운로드/삭제)

아이뜨락 아파트 커뮤니티 플랫폼의 첨부파일(ATTACHMENT) 교차 도메인 스펙. 본 SPEC은 NOTICE(공지)와 SUGGEST(건의) 도메인이 공유하는 단일 첨부파일 기능(업로드/메타데이터 열람/다운로드/삭제)을 정의한다. SPEC-NOTICE-001과 SPEC-SUGGEST-001이 "첨부파일 = 별도 SPEC"으로 이연했던 P0 갭을 본 SPEC이 닫는다(`.moai/project/product.md` NOTICE-01~05 명시 `attachments: file[]`, SUGGEST 자연 확장).

---

## HISTORY

- **2026-06-24**: 최초 작성 (강력쇠주먹). 확정 결정 5종 반영: (1) **저장소 = 로컬 파일시스템**, 경로는 환경변수 `ATTACHMENTS_DIR`(기본 `./public/uploads`). 단, 로컬 파일시스템은 영구 볼륨(self-hosted / VPS / Docker volume / Railway Volume)을 전제로 한다 — Vercel(ephemeral filesystem) 배포 시 재배포마다 파일이 소실되므로 비권장. 완화책으로 파일 메타데이터는 DB에 저장하고 바이너리만 디스크에 두어, 향후 클라우드 스토리지(S3/Supabase Storage) 이전 시 저장소 계층만 교체하면 DB는 동일하게 유지된다. (2) **허용 파일 = 이미지(PNG/JPG/JPEG/WEBP) + 문서(PDF/HWP/DOCX)**, 파일당 최대 10MB, 게시물당 최대 5개. 화이트리스트 MIME + 확장자 + 매직 바이트(최소한 signature) 교차 검증. (3) **접근 제어 = 기존 SUGGEST 가시성 매트릭스 재사용** — NOTICE 첨부는 모든 인증 사용자가 읽기 가능; SUGGEST 첨부는 건의 가시성(공개=인증 사용자, 비공개=작성자+담당동 REP+CHAIR+ADMIN)을 따른다; 업로드/편집/삭제는 NOTICE=ADMIN, SUGGEST=작성자 본인+ADMIN. (4) **구조 = 단일 SPEC-ATTACHMENT-001 + 단일 `attachments` 테이블**(다형성 target: `target_type NOTICE|SUGGEST` + `target_id`), 두 개의 FK 테이블이 아님 — 근거는 §10 설계 노트. (5) **삭제 cascade** — 공지 영구 삭제(NOTICE hard delete), 건의 아카이브(SUGGEST archive 익명화), AUTH 강제 탈퇴(deactivate) 시 첨부파일 메타데이터 + 디스크 바이너리가 일관되게 정리된다.

---

## 1. 배경 및 목적

아이뜨락 아파트(총 2개 동 / 38세대)의 관리사무소(ADMIN)가 공지에 이미지·문서를 첨부하여 전달하고, 입주민이 건의에 사진(PDF/HWP 등)을 첨부할 수 있게 한다. SPEC-AUTH-001 P0가 JWT 인증을, SPEC-SETUP-001 P0가 RBAC 헬퍼(`requireAdmin`/`requirePrivileged`/응답 빌더)를, SPEC-NOTICE-001 P0가 `notices` 테이블 + ADMIN RBAC 패턴을, SPEC-SUGGEST-001 P0가 `suggestions` 테이블 + 역할별 비공개 분기(`buildVisibilityCondition`/`canAccessPrivate`)를 구축했으므로, 본 SPEC은 이를 재사용하여 단일 첨부파일 하위 시스템을 NOTICE/SUGGEST 양쪽에 제공한다.

본 SPEC은 다음을 달성해야 한다:

- ATT-01: 첨부 업로드 — NOTICE(`POST /api/notices/[id]/attachments`)는 ADMIN, SUGGEST(`POST /api/suggestions/[id]/attachments`)는 작성자 본인+ADMIN
- ATT-02: 첨부 메타데이터 목록 — 공지 상세의 첨부 목록, 건의 상세의 첨부 목록(역할별 가시성 적용)
- ATT-03: 첨부 다운로드/스트리밍 — `GET /api/attachments/[id]`, 다운로드 권한은 대상 게시물(NOTICE/SUGGEST)의 가시성 규칙을 따름
- ATT-04: 첨부 삭제 — `DELETE /api/attachments/[id]`, NOTICE=ADMIN, SUGGEST=작성자 본인+ADMIN
- ATT-05: 검증 — 허용 MIME/확장자, 파일당 10MB, 게시물당 5개 한도
- M-ATT: `attachments` 테이블 + 인덱스 마이그레이션 010
- M-DEL: NOTICE hard delete / SUGGEST archive / AUTH deactivate 트랜잭션에 첨부 cascade 정리

기술 결정 근거는 `.moai/project/tech.md`(파일 스토리지 = Railway Volume, 영구 볼륨)를 참조한다.

---

## 2. 범위

### 2.1 In-Scope (본 SPEC이 구현하는 것)

- ATT-01: 첨부 업로드 — `POST /api/notices/[id]/attachments`(ADMIN), `POST /api/suggestions/[id]/attachments`(작성자 본인+ADMIN)
- ATT-02: 첨부 메타데이터 목록 — 공지/건의 상세 응답에 `attachments[]` 배열 포함(id, original_filename, mime_type, size_bytes, created_at). SUGGEST는 역할별 가시성 분기 적용
- ATT-03: 첨부 다운로드 — `GET /api/attachments/[id]`, 대상 게시물 가시성 검사 후 바이너리 스트리밍(`Content-Disposition: attachment`)
- ATT-04: 첨부 삭제 — `DELETE /api/attachments/[id]`, DB 메타데이터 삭제 + 디스크 바이너리 제거(트랜잭션)
- ATT-05: 검증 — 허용 화이트리스트(PNG/JPG/JPEG/WEBP/PDF/HWP/DOCX), 파일당 최대 10MB, 게시물당 최대 5개
- M-ATT: `attachments` 테이블(id, target_type, target_id, uploader_id, original_filename, mime_type, size_bytes, storage_path, sha256, created_at) + 인덱스 마이그레이션 010
- M-DEL: NOTICE hard delete / SUGGEST archive(DELETE route) / AUTH deactivate 트랜잭션에서 첨부 cascade 정리(DB 행 + 디스크 파일)
- AUTH/SETUP/NOTICE/SUGGEST 산출물 재사용: `src/lib/{db,auth,rbac,suggest-rbac}.ts`, `requireAdmin`, `requireAuthenticated`, `buildVisibilityCondition`, `canAccessPrivate`, RBAC 응답 빌더, UUID 정규식, zod 검증, route-level Bearer 인증 패턴

### 2.2 Out-of-Scope (별도 SPEC)

- 클라우드 스토리지(S3/Supabase Storage/R2) 마이그레이션 — 본 SPEC은 로컬 파일시스템(영구 볼륨 전제). 클라우드 이전은 후속 ADR/SPEC. 단, 메타데이터/바이너리 분리 설계로 이원화 준비
- 바이러스 스캐닝(ClamAV 등) — 본 SPEC 범위 아님
- 이미지 썸네일 자동 생성 — `sharp` 패키지가 설치되어 있으나 본 SPEC에서는 다루지 않음. 필요시 별도 SPEC
- 첨부 파일 복수 동시 업로드(multipart batch) — 단일 파일 단위 업로드만 지원. 클라이언트가 N회 호출
- 첨부 파일 검색/전문 색인
- 주차 추첨(PARKING) 도메인 첨부 — 별도 SPEC 필요시 본 테이블 확장
- 첨부 수정(파일 교체) — 업로드/삭제만 지원. 교체 = 삭제+재업로드

---

## 3. 가정 및 사전 조건 (Dependencies)

본 SPEC은 다음 사전 조건이 충족되었다고 가정한다:

1. **SPEC-AUTH-001 P0 완료·병합**: `users`/`roles` 테이블 스키마(migration 001), JWT 인증(`verifyAccessToken`), AUTH 강제 탈퇴(deactivate) 트랜잭션(`src/app/api/auth/users/[id]/deactivate/route.ts`)이 존재한다.
2. **SPEC-SETUP-001 P0 완료·병합**: RBAC 헬퍼 `src/lib/rbac.ts`(`requireAdmin`, 응답 빌더 `unauthorized`/`forbidden`/`badRequest`/`notFound`/`conflict`/`validationError`)가 존재한다.
3. **SPEC-NOTICE-001 P0 완료·병합**: `notices` 테이블(migration 006), `requireAdmin` ADMIN 전용 쓰기 패턴, route-level Bearer 인증 패턴(`src/app/api/notices/route.ts`, `src/app/api/notices/[id]/route.ts`), 공지 영구 삭제(hard delete) DELETE 핸들러가 존재한다.
4. **SPEC-SUGGEST-001 P0 완료·병합**: `suggestions` 테이블(migration 004 + 007), `suggest-rbac.ts` `requireAuthenticated`, 역할별 비공개 분기(`buildVisibilityCondition`, `canAccessPrivate`), 건의 아카이브(archive, 익명화) DELETE 핸들러가 존재한다.
5. **DB 라이브러리 재사용 가능**: `src/lib/db.ts`(PostgreSQL 연결 풀, `query`, `withTransaction`)가 존재하며 본 SPEC이 재사용한다. 첨부 cascade 삭제는 `withTransaction` 내부에서 수행된다.
6. **영구 볼륨 사용 가능**: 배포 환경이 영구 볼륨을 제공한다(Railway Volume, VPS 디스크, Docker volume 등). `.moai/project/tech.md`는 "파일 스토리지 = Railway Volume"으로 명시. Vercel(ephemeral filesystem) 배포 시 파일이 소실되므로 비권장 — 본 SPEC은 이 제약을 명시적으로 문서화한다.
7. **환경 변수**: `ATTACHMENTS_DIR`(기본 `./public/uploads`) 추가. 기존 `DATABASE_URL`, `JWT_SECRET` 등은 동일.
8. **HTTPS 강제**: 모든 API는 HTTPS. 다운로드는 HTTPS 스트리밍.
9. **역할 5종 고정**: ADMIN/CHAIR/REP/AUDITOR/RESIDENT. NOTICE 첨부 읽기=5종 전체, NOTICE 첨부 쓰기=ADMIN만; SUGGEST 첨부 읽기=건의 가시성 준거, SUGGEST 첨부 쓰기=작성자 본인+ADMIN.

---

## 4. 기능 요구사항 (EARS)

### M1. 첨부 업로드 (ATT-01)

#### REQ-ATT-001 (Event-driven) — ADMIN 공지 첨부 업로드

> **When** ADMIN이 특정 공지(id)에 대해 파일을 multipart/form-data로 업로드 요청(`POST /api/notices/[id]/attachments`)하면, the system **shall** 파일을 검증(REQ-ATT-005)한 후 디스크에 저장하고 `attachments` 테이블에 메타데이터(target_type='NOTICE', target_id=공지 id, uploader_id=ADMIN user id, original_filename, mime_type, size_bytes, storage_path, sha256)를 INSERT하며 `201 Created` 응답과 함께 첨부 id, 원본 파일명, mime_type, size_bytes, created_at을 반환한다.

#### REQ-ATT-002 (Event-driven) — 건의 첨부 업로드 (작성자 본인 or ADMIN)

> **When** 특정 건의(id)의 작성자 본인(author_id == 요청자 user id) 또는 ADMIN이 파일을 multipart/form-data로 업로드 요청(`POST /api/suggestions/[id]/attachments`)하면, the system **shall** REQ-ATT-001과 동일하게 검증/저장/메타데이터 INSERT를 수행하되 target_type='SUGGEST', target_id=건의 id, uploader_id=요청자로 설정하고 `201 Created` 응답을 반환한다.

#### REQ-ATT-003 (Unwanted) — 비-ADMIN 공지 첨부 업로드 금지 (403)

> **If** 요청자 역할이 ADMIN이 아닌 상태에서 공지 첨부 업로드를 시도하면, **then** the system **shall not** 파일을 저장하고 `403 Forbidden` 응답을 반환한다 (NOTICE 쓰기 권한은 ADMIN 전용 — SPEC-NOTICE-001 준거).

#### REQ-ATT-004 (Unwanted) — 타인/비-ADMIN 건의 첨부 업로드 금지 (403)

> **If** 요청자가 건의 작성자(author_id)가 아니며 동시에 ADMIN도 아닌 상태에서 건의 첨부 업로드를 시도하면, **then** the system **shall not** 파일을 저장하고 `403 Forbidden` 응답을 반환한다.

#### REQ-ATT-005 (State-driven) — 파일 검증 (유형/크기/개수)

> **While** 첨부 업로드를 처리하는 동안, the system **shall** (a) MIME 타입이 화이트리스트(PNG/JPG/JPEG/WEBP/PDF/HWP/DOCX에 해당하는 MIME)에 포함되는지, (b) 파일 확장자가 화이트리스트와 일치하는지, (c) 파일 크기가 10MB(10,485,760 bytes) 이하인지, (d) 해당 게시물의 기존 첨부 수 + 신규가 게시물당 최대 5개 한도를 초과하지 않는지 검증한다. 위반 시 `422 Unprocessable Entity` 응답을 반환하고 파일을 저장하지 않는다.

#### REQ-ATT-006 (Unwanted) — 미인증 업로드 거부 (401)

> **If** 업로드 요청이 유효한 액세스 토큰 없이 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다.

#### REQ-ATT-007 (Unwanted) — 미존재 게시물 업로드 404

> **If** 업로드 대상 공지/건의 id가 DB에 존재하지 않으면, **then** the system **shall** `404 Not Found` 응답을 반환한다.

#### REQ-ATT-008 (Ubiquitous) — 파일명 새니타이제이션

> **The system shall** 업로드된 파일의 원본 파일명(original_filename)은 DB에 보존하되, 디스크에 저장되는 물리 파일명(storage_path)은 UUID 기반으로 생성하여 경로 순회(path traversal, `../`, 절대 경로) 공격을 원천 차단한다. 사용자 제공 파일명을 디스크 경로에 직접 사용하지 않는다.

---

### M2. 첨부 메타데이터 목록 (ATT-02)

#### REQ-ATT-009 (Event-driven) — 공지 상세 첨부 목록 포함

> **When** 인증된 사용자가 공지 상세(`GET /api/notices/[id]`)를 조회하면, the system **shall** 공지 본문 응답에 `attachments[]` 배열(id, original_filename, mime_type, size_bytes, created_at)을 포함하여 반환한다. 정렬은 `created_at ASC`.

#### REQ-ATT-010 (Event-driven) — 건의 상세 첨부 목록 포함 (역할별 가시성)

> **When** 인증된 사용자가 건의 상세(`GET /api/suggestions/[id]`)를 조회하고(비공개 건의는 SPEC-SUGGEST-001 `canAccessPrivate` 통과 후)하면, the system **shall** 건의 본문 응답에 `attachments[]` 배열을 포함하여 반환한다. 무권한 비공개 건의 접근은 첨부 목록 노출 전 `403 Forbidden`으로 차단된다(SPEC-SUGGEST-001 REQ-SUGGEST-024 준거).

#### REQ-ATT-011 (Ubiquitous) — 첨부 목록에 storage_path 미노출

> **The system shall** 첨부 목록/상세 응답 본문에 `storage_path`(내부 디스크 경로)를 포함하지 않는다. 클라이언트는 첨부 id로 다운로드 엔드포인트를 호출한다.

---

### M3. 첨부 다운로드/스트리밍 (ATT-03)

#### REQ-ATT-012 (Event-driven) — 인증 사용자 첨부 다운로드

> **When** 인증된 사용자가 특정 첨부(id)의 다운로드(`GET /api/attachments/[id]`)를 요청하면, the system **shall** (a) 첨부 메타데이터를 조회하여 target_type/target_id를 해석하고, (b) 대상 게시물의 가시성 규칙(NOTICE=모든 인증 사용자, SUGGEST=건의 가시성 분기)을 검사한 후, (c) 권한이 있으면 파일 바이너리를 `Content-Type: <mime_type>`, `Content-Disposition: attachment; filename="<original_filename>"` 헤더와 함께 스트리밍한다.

#### REQ-ATT-013 (Unwanted) — 비공개 건의 첨부 무권한 다운로드 403

> **If** 요청자가 비공개 건의에 귀속된 첨부를 다운로드하려 하고 해당 건의에 대한 열람 권한(`canAccessPrivate` 분기)이 없으면, **then** the system **shall** `403 Forbidden` 응답을 반환한다 (존재 여부 누출 방지 — 404가 아닌 403, SPEC-SUGGEST-001 REQ-SUGGEST-024 준거).

#### REQ-ATT-014 (Unwanted) — 미존재 첨부 다운로드 404

> **If** 다운로드 요청의 첨부 id가 DB에 존재하지 않으면, **then** the system **shall** `404 Not Found` 응답을 반환한다.

#### REQ-ATT-015 (Unwanted) — 미인증 다운로드 거부 (401)

> **If** 다운로드 요청이 유효한 액세스 토큰 없이 수신되면, **then** the system **shall not** 바이너리를 반환하고 `401 Unauthorized` 응답을 반환한다.

#### REQ-ATT-016 (Unwanted) — 디스크 파일 소실 시 500/404

> **If** DB 메타데이터는 존재하나 디스크 파일(storage_path)이 존재하지 않으면, **then** the system **shall** 애플리케이션 에러로 로그를 남기고 `404 Not Found`(또는 `500 Internal Server Error`) 응답을 반환한다 (메타데이터/바이너리 불일치는 비정상 상태 — 모니터링 대상).

---

### M4. 첨부 삭제 (ATT-04)

#### REQ-ATT-017 (Event-driven) — ADMIN 공지 첨부 삭제

> **When** ADMIN이 특정 첨부(id)의 삭제(`DELETE /api/attachments/[id]`)를 요청하고 해당 첨부의 target_type='NOTICE'이면, the system **shall** `withTransaction` 내에서 (a) `attachments` 테이블의 해당 행을 DELETE하고, (b) 디스크의 storage_path 파일을 제거한 후 `200 OK` 응답을 반환한다. 디스크 제거 실패 시 트랜잭션을 롤백한다(메타데이터/바이너리 일관성).

#### REQ-ATT-018 (Event-driven) — 건의 첨부 삭제 (작성자 본인 or ADMIN)

> **When** 특정 첨부(id)의 target_type='SUGGEST'이고 요청자가 해당 건의 작성자(author_id) 본인 또는 ADMIN이면, the system **shall** REQ-ATT-017과 동일한 트랜잭션 삭제 절차를 수행하고 `200 OK` 응답을 반환한다.

#### REQ-ATT-019 (Unwanted) — 타인/비-ADMIN 첨부 삭제 금지 (403)

> **If** 요청자가 첨부 작성자(uploader_id)가 아니며 동시에 ADMIN도 아닌 상태에서 첨부 삭제를 시도하면(공지 첨부의 경우 ADMIN이 아니면 항상 거부), **then** the system **shall not** 삭제를 수행하고 `403 Forbidden` 응답을 반환한다.

#### REQ-ATT-020 (Unwanted) — 미존재 첨부 삭제 404

> **If** 삭제 요청의 첨부 id가 DB에 존재하지 않으면, **then** the system **shall** `404 Not Found` 응답을 반환한다.

#### REQ-ATT-021 (Unwanted) — 미인증 삭제 거부 (401)

> **If** 삭제 요청이 유효한 액세스 토큰 없이 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다.

---

### M5. 검증 (ATT-05)

#### REQ-ATT-022 (State-driven) — MIME 스푸핑 방지

> **While** 파일 검증을 수행하는 동안, the system **shall** 클라이언트가 선언한 Content-Type만 신뢰하지 않고 파일 시그니처(magic bytes)를 최소한으로 교차 확인한다(예: PNG `89 50 4E 47`, PDF `%PDF-`, JPEG `FF D8 FF`). 선언 MIME과 시그니처가 불일치하면 `422 Unprocessable Entity`로 거부한다.

#### REQ-ATT-023 (Unwanted) — 파일 크기 초과 422

> **If** 업로드된 파일 크기가 10MB(10,485,760 bytes)를 초과하면, **then** the system **shall not** 파일을 저장하고 `422 Unprocessable Entity` 응답을 반환한다.

#### REQ-ATT-024 (Unwanted) — 게시물당 첨부 수 초과 422

> **If** 업로드 완료 시 해당 게시물의 첨부 수가 5개를 초과하게 되면, **then** the system **shall not** 파일을 저장하고 `422 Unprocessable Entity` 응답을 반환한다.

#### REQ-ATT-025 (Unwanted) — 허용되지 않은 파일 유형 422

> **If** 업로드된 파일의 MIME/확장자가 화이트리스트(PNG/JPG/JPEG/WEBP/PDF/HWP/DOCX)에 없으면, **then** the system **shall not** 파일을 저장하고 `422 Unprocessable Entity` 응답을 반환한다.

---

### M6. 삭제 Cascade (M-DEL)

#### REQ-ATT-026 (Event-driven) — 공지 영구 삭제 시 첨부 cascade

> **When** ADMIN이 공지를 영구 삭제(`DELETE /api/notices/[id]`, SPEC-NOTICE-001 REQ-NOTICE-008)하면, the system **shall** 해당 공지에 귀속된 모든 첨부(target_type='NOTICE', target_id=공지 id)의 DB 행을 삭제하고 디스크 파일을 일괄 제거한다. 이 과정은 공지 삭제 트랜잭션 내에서 원자적으로 수행된다.

#### REQ-ATT-027 (Event-driven) — 건의 아카이브 시 첨부 cascade

> **When** 건의가 아카이브(`DELETE /api/suggestions/[id]`, SPEC-SUGGEST-001 REQ-SUGGEST-012/013)되면, the system **shall** 해당 건의에 귀속된 모든 첨부(target_type='SUGGEST', target_id=건의 id)의 DB 행을 삭제하고 디스크 파일을 일괄 제거한다. 건의 행 자체는 익명화 전환으로 보존되지만 첨부 파일은 영구 제거된다(익명화된 건의의 첨부는 더 이상 의미가 없으므로).

#### REQ-ATT-028 (Event-driven) — AUTH 강제 탈퇴 시 첨부 cascade

> **When** AUTH 강제 탈퇴(`POST /api/auth/users/[id]/deactivate`, SPEC-AUTH-001 REQ-AUTH-014) 트랜잭션이 실행되면, the system **shall** 탈퇴 대상 사용자가 업로드한 모든 첨부(uploader_id=대상 user id)를 대상 게시물(NOTICE/SUGGEST)과 무관하게 DB 행 삭제 + 디스크 파일 제거로 정리한다. 단, SUGGEST 첨부는 건의 아카이브(REQ-ATT-027) 시 이미 정리되므로 deactivated 사용자의 SUGGEST 첨부는 일반적으로 이미 없다(이중 안전망).

---

### M7. attachments 테이블 마이그레이션 (M-ATT)

#### REQ-ATT-029 (Ubiquitous) — attachments 테이블 스키마

> **The system shall** `attachments` 테이블을 migration 010으로 생성한다: `id UUID PK DEFAULT gen_random_uuid()`, `target_type VARCHAR(10) NOT NULL CHECK (target_type IN ('NOTICE','SUGGEST'))`, `target_id UUID NOT NULL`, `uploader_id UUID NOT NULL REFERENCES users(id)`, `original_filename VARCHAR(255) NOT NULL`, `mime_type VARCHAR(100) NOT NULL`, `size_bytes BIGINT NOT NULL`, `storage_path TEXT NOT NULL`, `sha256 CHAR(64) NOT NULL`, `created_at TIMESTAMPTZ DEFAULT now()`. 인덱스: `(target_type, target_id)` 복합 인덱스, `uploader_id`. FK는 `target_id`에 대해 다형성이므로 DB 레벨 FK 대신 애플리케이션 레벨 검증(REQ-ATT-007)으로 보완한다.

---

## 5. Exclusions (What NOT to Build)

본 SPEC은 다음 항목을 구현하지 않는다:

1. **클라우드 스토리지(S3/Supabase Storage/R2)** — 본 SPEC은 로컬 파일시스템(영구 볼륨) 저장소만 다룬다. 메타데이터/바이너리 분리 설계로 향후 이원화 준비는 되어 있으나, 클라우드 이전 자체는 후속 ADR/SPEC.
2. **바이러스 스캐닝** — ClamAV 등 백신 스캔은 본 SPEC 범위 아님. 파일 유형 화이트리스트 + 매직 바이트 검증만 수행.
3. **이미지 썸네일 자동 생성** — `sharp` 패키지가 설치되어 있으나 본 SPEC에서 사용하지 않음. 필요시 별도 SPEC.
4. **복수 동시 업로드(multipart batch)** — 단일 파일 단위 업로드만. 클라이언트가 N회 반복 호출.
5. **첨부 수정(파일 교체)** — 업로드/삭제만 지원. 교체 = 삭제 + 재업로드.
6. **첨부 검색/전문 색인** — 첨부 메타데이터 검색은 범위 아님.
7. **PARKING(주차 추첨) 첨부** — 본 SPEC은 NOTICE/SUGGEST만. 필요시 본 테이블 target_type 확장.
8. **청크 분할 업로드(resumable upload)** — 10MB 한도 내 단일 요청 업로드만.

---

## 6. 비기능 요구사항 (제약)

### 6.1 보안 (Security)

- **RBAC + 게시물 가시성**: 첨부 업로드/삭제는 NOTICE=ADMIN, SUGGEST=작성자+ADMIN(서버 사이드 검증). 다운로드는 대상 게시물(NOTICE/SUGGEST)의 가시성 규칙을 따른다 — NOTICE=모든 인증 사용자, SUGGEST=건의 가시성 분기(REQ-SUGGEST-021/022). 클라이언트 단독 신뢰 금지.
- **경로 순회(path traversal) 방어**: 디스크 파일명은 UUID 기반 생성, 사용자 제공 파일명을 경로에 직접 사용 금지(REQ-ATT-008). `storage_path`는 항상 `ATTACHMENTS_DIR` 하위로 제한.
- **MIME 스푸핑 방어**: 클라이언트 Content-Type만 신뢰하지 않고 매직 바이트 교차 검증(REQ-ATT-022).
- **SQL Injection 방어**: 모든 DB 쿼리는 Parameterized Query.
- **입력 유효성 검증**: 서버 사이드 zod 스키마. path param UUID 형식 검증, multipart 필드 검증.
- **다운로드 권한 재검증**: 다운로드 엔드포인트는 첨부 id로 메타데이터 조회 후 대상 게시물 가시성을 매번 재검증 — URL만 알면 다운로드 가능한 직접 링크 금지(REQ-ATT-013).
- **sha256 기록**: 파일 무결성 검증용 sha256 해시를 DB에 저장(REQ-ATT-029). 다운로드 시 검증은 선택적(성능 고려).

### 6.2 성능 (Performance)

- 업로드/다운로드 API 응답 시간: P95 1초 이하(파일 I/O 포함, PRD §5-1 완화 — 파일 크기 의존).
- 다운로드는 Node.js `ReadableStream`/`createReadStream` 기반 스트리밍 — 메모리에 전체 파일 적재 금지.
- 게시물당 첨부 수 최대 5개이므로 상세 응답의 `attachments[]`는 최대 5항목.
- `(target_type, target_id)` 복합 인덱스로 게시물별 첨부 목록 조회 고속화.

### 6.3 가용성 (Availability)

- 단일 PostgreSQL + 단일 영구 볼륨 의존.
- 로컬 파일시스템 제약: Vercel(ephemeral filesystem) 배포 시 재배포마다 파일 소실. Railway Volume/VPS/Docker volume 등 영구 볼륨 필수. 배포 환경 문서에 명시.
- migration 010은 migration 009 이후 순차 적용. `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`로 멱등성 보장.

### 6.4 감사 (Auditability)

- 첨부 업로드/삭제 이벤트는 애플리케이션 로그로 기록(PII 제외).
- 권한 오용 시도(타인 첨부 업로드/삭제, 무권한 비공개 첨부 다운로드)는 경고 로그로 기록 권장.

### 6.5 데이터 일관성 (Consistency)

- 첨부 삭제는 `withTransaction` 내에서 DB 행 삭제 + 디스크 파일 제거가 원자적으로 수행(REQ-ATT-017/018). 디스크 제거 실패 시 롤백.
- cascade 삭제(NOTICE hard delete, SUGGEST archive, AUTH deactivate)도 동일한 원자성 보장(REQ-ATT-026/027/028).
- 메타데이터/바이너리 불일치(REQ-ATT-016)는 비정상 상태로 간주, 모니터링 대상.

---

## 7. 데이터 모델 (제안, run phase에서 생성)

> **NOTE**: 본 DDL은 제안이다. run phase에서 `migrations/010_attachments.sql`로 생성된다. 본 SPEC(plan phase)에서는 마이그레이션 파일을 작성하지 않는다.

```sql
-- migrations/010_attachments.sql (제안)
-- SPEC-ATTACHMENT-001 (M-ATT, REQ-ATT-029)
--
-- @MX:ANCHOR: [AUTO] ATTACHMENT 스키마 불변 지점 — attachments 테이블 정의
-- @MX:REASON:  target_type/target_id 다형성 참조는 DB FK 대신 애플리케이션 검증으로 보완.
--             uploader_id FK는 users(id) — AUTH deactivate cascade(REQ-ATT-028) 호환성 필수.
--
-- 멱등성: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS attachments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type       VARCHAR(10) NOT NULL CHECK (target_type IN ('NOTICE','SUGGEST')),
    target_id         UUID NOT NULL,
    uploader_id       UUID NOT NULL REFERENCES users(id),
    original_filename VARCHAR(255) NOT NULL,
    mime_type         VARCHAR(100) NOT NULL,
    size_bytes        BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
    storage_path      TEXT NOT NULL,
    sha256            CHAR(64) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 게시물별 첨부 목록 조회용 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_attachments_target
    ON attachments(target_type, target_id);

-- 업로더별 첨부 조회(AUTH deactivate cascade용)
CREATE INDEX IF NOT EXISTS idx_attachments_uploader_id
    ON attachments(uploader_id);
```

---

## 8. API Surface (제안, run phase에서 구현)

> **NOTE**: 본 엔드포인트 목록은 제안이다. run phase에서 구현된다.

| Method | Path | 목적 | 권한 |
|--------|------|------|------|
| POST | `/api/notices/[id]/attachments` | 공지 첨부 업로드 | ADMIN |
| POST | `/api/suggestions/[id]/attachments` | 건의 첨부 업로드 | 작성자 본인 + ADMIN |
| GET | `/api/attachments/[id]` | 첨부 다운로드(스트리밍) | 대상 게시물 가시성 준거 |
| DELETE | `/api/attachments/[id]` | 첨부 삭제 | NOTICE=ADMIN, SUGGEST=작성자+ADMIN |

추가로 기존 엔드포인트 수정(첨부 목록 포함):
- `GET /api/notices/[id]` 응답 본문에 `attachments[]` 추가(REQ-ATT-009)
- `GET /api/suggestions/[id]` 응답 본문에 `attachments[]` 추가(REQ-ATT-010)

기존 cascade 훅 지점(트랜잭션 내 첨부 정리 추가):
- `DELETE /api/notices/[id]`(SPEC-NOTICE-001 REQ-NOTICE-008 hard delete)
- `DELETE /api/suggestions/[id]`(SPEC-SUGGEST-001 REQ-SUGGEST-012/013 archive)
- `POST /api/auth/users/[id]/deactivate`(SPEC-AUTH-001 REQ-AUTH-014)

---

## 9. 의존성 및 위험 (Dependencies & Risks)

### 의존성

- **SPEC-AUTH-001 P0**: `users` 스키마(uploader_id FK), JWT 인증, deactivate 트랜잭션 cascade 훅(REQ-ATT-028).
- **SPEC-SETUP-001 P0**: RBAC 헬퍼(requireAdmin, 응답 빌더).
- **SPEC-NOTICE-001 P0**: `notices` 테이블, 공지 DELETE hard delete cascade 훅(REQ-ATT-026).
- **SPEC-SUGGEST-001 P0**: `suggestions` 테이블, `suggest-rbac.ts`, 가시성 분기 로직, 건의 DELETE archive cascade 훅(REQ-ATT-027).
- **`src/lib/db.ts`**: `query`, `withTransaction` 재사용.

### 위험

1. **[CRITICAL] 로컬 파일시스템 영속성**: Vercel(ephemeral filesystem) 배포 시 재배포마다 업로드된 파일이 소실된다. 완화책 — (a) Railway Volume/VPS/Docker volume 등 영구 볼륨 필수 사용, (b) 메타데이터는 DB에 저장하여 클라우드 이전 시 저장소 계층만 교체 가능, (c) 배포 환경 문서에 명시. `.moai/project/tech.md`는 "파일 스토리지 = Railway Volume"으로 명시되어 있어 기본 배포 환경은 안전.
2. **[HIGH] 메타데이터/바이너리 불일치**: DB 행은 존재하나 디스크 파일이 소실(수동 삭제, 볼륨 손상)된 경우. 완화책 — 다운로드 시 404/500 반환(REQ-ATT-016), 모니터링 대상. 정기一致性 점검 스크립트 권장(본 SPEC 범위 외).
3. **[MEDIUM] 다형성 FK 무결성**: `target_id`가 DB FK가 아니므로 게시물이 삭제된 후에도 첨부 행이 남을 수 있다. 완화책 — cascade 훅(REQ-ATT-026/027/028)으로 원자적 정리, 애플리케이션 레벨 검증(REQ-ATT-007).
4. **[MEDIUM] MIME 스푸핑 우회**: 매직 바이트 검증을 우회하는 악성 파일 가능성. 완화책 — 화이트리스트 MIME + 확장자 + 시그니처 교차 검증(REQ-ATT-022). 백신 스캔은 Out-of-Scope.
5. **[LOW] 대용량 업로드 메모리**: multipart 파싱 시 메모리 적재. 완화책 — 10MB 상한으로 제한(REQ-ATT-023), Next.js 기본 body 크기 제한 확인 필요(run phase).

---

## 10. 설계 노트: 데이터 모델 선택 (Polymorphic vs Dual-FK)

### 결정: 단일 `attachments` 테이블 + 다형성(target_type + target_id)

**선택한 방식**: `attachments` 테이블에 `target_type VARCHAR(10) CHECK IN ('NOTICE','SUGGEST')` + `target_id UUID` 조합으로 NOTICE/SUGGEST 양쪽을 단일 테이블에서 처리.

**거부한 방식**: 두 개의 FK 테이블(`notice_attachments`, `suggestion_attachments`).

**근거**:

1. **중복 제거**: 두 FK 테이블 방식은 동일한 컬럼 7종(original_filename, mime_type, size_bytes, storage_path, sha256, uploader_id, created_at)을 두 벌로 복제 → DRY 위반, 유지보수 비용 2배.
2. **단일 쿼리 경로**: 다운로드/삭제 엔드포인트(`GET/DELETE /api/attachments/[id]`)가 단일 테이블 조회로 처리 가능. 두 테이블 방식은 target 도메인 분기를 위한 추가 조회 또는 UNION 필요.
3. **확장 용이성**: 향후 PARKING 등 다른 도메인 첨부 추가 시 `target_type` CHECK 제약에 새 값만 추가하면 됨 — 스키마 중복 없이 동일 테이블 재사용.
4. **기존 패턴 부합**: `suggestion_replies` 테이블(migration 007)이 `suggestion_id` 전용 FK를 사용한 것과 대비되나, replies는 단일 도메인 전용이라 FK가 적합했다. 본 SPEC은 교차 도메인 공용이라 다형성이 더 자연스럽다.
5. **FK 무결성 트레이드오프**: 다형성 `target_id`는 DB FK가 아니므로 참조 무결성이 DB 레벨에서 보장되지 않는다. 단, cascade 훅(REQ-ATT-026/027/028)이 애플리케이션 레벨에서 원자적으로 정리하므로 실질적 위험은 낮다. 38세대 소규모 단지에서 성능보다 단순성이 우선.

**복잡성 억제 원칙**: 본 선택은 단순성을 우선했다. 두 FK 테이블이 DB 무결성 면에서 더 엄격하지만, 38세대 단지 커뮤니티 규모에서 다형성 접근의 실질적 위험은 낮고 코드 중복 감소 이점이 크다.

---

## 11. 열린 질문 / 가정 (Open Questions & Assumptions)

> run phase 시작 전 orchestrator가 확인해야 할 항목.

1. **[가정] 배포 환경 = Railway Volume(영구 볼륨)**: `.moai/project/tech.md` 명시 기준. Vercel 배포로 전환 시 본 SPEC의 로컬 파일시스템 접근은 무효 — 클라우드 스토리지 SPEC 선행 필요. run phase에서 `ATTACHMENTS_DIR` 환경변수가 영구 볼륨 경로인지 확인 권장.
2. **[가정] Next.js body size limit**: 10MB 파일 업로드를 위해 Next.js App Router의 기본 multipart body 크기 제한(보통 4MB)을 상향해야 할 수 있음. run phase에서 `next.config` 또는 route segment config `export const api = { bodyParser: { sizeLimit: '10mb' } }` 확인 필요(Next.js 15 App Router 방식은 다를 수 있음 — 구현 시 검증).
3. **[열린 질문] HWP magic byte**: HWP 파일의 매직 바이트 시그니처가 공식적으로 표준화되어 있지 않음(`HWP Document File` 시그니처는 있으나 버전별 상이). run phase에서 HWP 검증 전략(확장자 + 느슨한 시그니처 또는 확장자만) 확정 필요. 본 SPEC은 "최소한의 시그니처 교차 검증"을 요구하되 HWP는 예외적으로 확장자 우선 검증 허용 가능.
4. **[가정] AUDITOR 건의 첨부**: SPEC-SUGGEST-001 Known limitations에 따라 AUDITOR는 RESIDENT 동일 취급(공개+본인비공개 열람). 본 SPEC도 동일 정책 적용. AUDITOR 공개 건의 첨부 다운로드 허용.
5. **[열린 질문] 첨부 삭제 시 sha256 재검증**: 다운로드 시 저장된 sha256과 디스크 파일 해시를 재비교할지(무결성 강화) 또는 업로드 시 1회만 계산(성능 우선). 본 SPEC은 업로드 시 1회 계산 + 저장만 명시(REQ-ATT-029). 다운로드 재검증은 Out-of-Scope.
6. **[가정] 첨부 업로더 표기**: 공지 첨부는 uploader_id=ADMIN이므로 작성자=공지 작성자(ADMIN)와 일치. 건의 첨부는 uploader_id=작성자 본인이 원칙이나 ADMIN이 건의 첨부를 업로드하는 경우(관리사무소가 입주민 건의에 파일 첨부 보조?) 정책 미명시 — 본 SPEC은 ADMIN 업로드를 허용하되 uploader_id에 실제 업로더(ADMIN)를 기록. run phase에서 정책 확정 권장.

---

## 12. 검증 기준 요약

상세 Given/When/Then 시나리오는 `acceptance.md`(run phase에서 작성 예정)를 참조. 각 모듈(M1~M7)당 최소 2개 시나리오, 총 29개 REQ-ATT-XXX 요구사항(001~029)에 대한 검증 케이스를 정의한다. 주요 검증 영역:

- 업로드 권한 분기(NOTICE=ADMIN, SUGGEST=작성자+ADMIN)
- 파일 검증(MIME/확장자/매직바이트/크기/개수)
- 다운로드 권한 재검증(대상 게시물 가시성)
- 삭제 트랜잭션 원자성(DB+디스크)
- cascade 삭제(NOTICE hard delete, SUGGEST archive, AUTH deactivate)
- 경로 순회 방어(storage_path 새니타이제이션)
- 로컬 파일시스템 제약 문서화

---

## 13. 참조 문서

- `.moai/specs/SPEC-AUTH-001/spec.md`: AUTH 도메인(의존 SPEC, JWT 인증, REQ-AUTH-014 deactivate 트랜잭션 cascade 훅)
- `.moai/specs/SPEC-SETUP-001/spec.md`: SETUP 도메인(의존 SPEC, rbac.ts requireAdmin/응답 빌더)
- `.moai/specs/SPEC-NOTICE-001/spec.md`: NOTICE 도메인(의존 SPEC, notices 테이블, hard delete cascade 훅, 첨부파일 제외 명시)
- `.moai/specs/SPEC-SUGGEST-001/spec.md`: SUGGEST 도메인(의존 SPEC, suggestions 테이블, 가시성 분기, archive cascade 훅, 첨부파일 제외 명시)
- `.moai/project/product.md`: NOTICE-01~05 첨부파일 명시(P0 갭)
- `.moai/project/tech.md`: 파일 스토리지 = Railway Volume(영구 볼륨)
- 기존 구현: `src/app/api/notices/[id]/route.ts`, `src/app/api/suggestions/route.ts`(buildVisibilityCondition), `src/app/api/suggestions/[id]/route.ts`(canAccessPrivate), `src/app/api/auth/users/[id]/deactivate/route.ts`(cascade 훅 지점)
- 마이그레이션 관례: `migrations/006_notices.sql`, `migrations/007_suggestions_expand.sql`(IF NOT EXISTS 멱등성 패턴)

---

*본 SPEC은 plan phase 산출물이다. run phase에서 `migrations/010_attachments.sql` 및 첨부 엔드포인트 구현이 이루어지며, 기존 NOTICE/SUGGEST/AUTH-deactivate route에 cascade 훅이 추가된다(brownfield 수정 — 기존 테스트 회귀 주의).*
