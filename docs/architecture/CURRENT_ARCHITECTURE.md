# 架構現況與提案邊界

現況更新：2026-09-18。Career 2.0 已建立獨立 Git baseline（`74e05d0bdd20e55453b64504bd04d77bb408ed86`），M1 close-out commit `911a10392a1d2073145c7859feb001d0dd38fe2c` 已推送至 `origin/main`；M1 Foundation hardening implementation 依核准 threat model 完成。Static symlink/hard-link、Darwin recovery-path、stale-recovery concurrency 與 non-Darwin stale-claim crash/takeover regressions 通過；active same-user .career2 replacement at lock-open 未防護，依使用者決策列為 M1 non-goal/future hardening，fixture skipped，不宣稱 race 已修復。Foundation tests 17 PASS / 1 SKIPPED / 0 FAIL。H5 fresh Electron startup acceptance 已通過：fresh PID 79150 載入實際 Career 2.0 main entry、建立並顯示 BrowserWindow、renderer/preload/IPC 正常、synthetic private root 的 store READY version 1 與 identity/root binding 正常；完成 8 秒 visible observation，使用者實際看到視窗，並以 code 0 / signal null clean exit。Build、OpenSpec strict 通過。Read-only M1 acceptance review PASS；`establish-m1-foundation` 已 sync/archive。`m1-opportunity-evidence-substrate` 的最小 Opportunity/JD 與 Career Evidence/revision runtime、additive migration、migration ownership checkpoints、degraded foundation fallback、true cross-process restart/read-back、domain schema readiness validation、public error-boundary sanitization、main writer 與 narrow IPC/preload 已實作，36 PASS / 1 SKIPPED / 0 FAIL 的 domain validation 與獨立 read-only acceptance 通過，已 archive 至 `openspec/changes/archive/2026-09-18-m1-opportunity-evidence-substrate/`；完整 M1 product-domain features 仍未實作或 accepted。`m2-intelligence-vertical-slice` planning 已 accepted，Batch 1 scoped implementation 已完成 10/26 tasks，acceptance repair/re-review pending；executor、UI、backup coverage、完整 M2 acceptance 與其他 batches 尚未完成。

## 已觀察現況

| 項目 | Evidence / Status |
| --- | --- |
| 本案工作位置 | /Users/kao_oak/Desktop/Kao_oaK/Career 2.0，由當前工作環境指定 |
| 初始目錄 | 2026-09-11 初次盤點為空；目前有規劃、兩個 active OpenSpec changes、Electron/React/Vite source、tests 與本地 `.git` baseline；已有最小 Opportunity/JD 與 Career Evidence/revision substrate，但沒有完整 M1 product-domain features |
| 最接近的適用文件 | 使用者貼入的 AGENTS 規則與 /Users/kao_oak/AGENTS.md；較近的父目錄沒有 AGENTS.md |
| 圖索引 | 本輪 list_projects 只列舊 Job-Ops 的另一工作區；沒有本案 index，generation = Insufficient evidence |
| 本案程式發現 | M1 Foundation source 與 tests 已存在；code graph 未建立，本案圖譜 generation = Insufficient evidence |
| 現有 runtime / local data | 本案目錄內不存在；外部是否已有相關資料為 Insufficient evidence，沒有廣泛掃描私人目錄 |
| 外部 repo / remote / release | 獨立 local Git repo 已建立；`origin` = `https://github.com/christinekao/Career-2.0.git`，`main` tracks `origin/main`；尚無 release 或 worktree；Engineering Memory 不屬本案依賴 |
| 本輪狀態 | Foundation hardening 已依核准 threat model 完成並通過 read-only M1 acceptance review；static path confinement、Darwin recovery-path、stale-recovery concurrency 與 non-Darwin stale-claim crash/takeover regressions 通過。Active same-user path swap 是未防護的 future-hardening non-goal。H5 fresh Electron GUI acceptance 已完成並具 automated + human-observed evidence；OpenSpec M1 changes 已 sync/archive。`m1-opportunity-evidence-substrate` 的最小 runtime、validation 與獨立 acceptance 已完成並 archive；`m2-intelligence-vertical-slice` planning 已 accepted，Batch 1 scoped implementation 已完成 10/26 tasks。完整 product-domain runtime schema/workflow、executor、UI、backup coverage 與 full M2 acceptance 尚未被宣稱完成 |

## 決策權與文件權威

最新使用者 scope review 為 R1 凍結依據：Career Evidence + Opportunity 同為 M1 foundation；其上是 M1 Workspace，再 M2 Intelligence；完整 MVP = M1 + M2。五條 frozen invariant 見 [產品規劃](../PRODUCT_PLAN.md)。附件是需求來源，OSS 文件只是參考。新案與 canonical repo 身份是 Career 2.0，不延伸舊 Job-Ops；正式對外品牌尚未決定。

交付順序（本案目前執行基線）：獨立 Git baseline → T02 Phase 0 architecture → T01 M1 capability selection → complete M1 Foundation hardening within approved threat model → H5 real Electron startup validation → read-only M1 review → OpenSpec sync/archive → commit/push → named M1 product-domain prerequisite (`m1-opportunity-evidence-substrate`) implementation → prerequisite read-only acceptance → prerequisite OpenSpec archive/commit/push → M2 planning acceptance/baseline close-out → M2 Intelligence Batch 1 scoped implementation → M1 Workspace/product vertical slices → later M2 batches。`m2-intelligence-vertical-slice` Batch 1 已完成其 10/26 scoped tasks；executor、UI、backup coverage 與 full M2 acceptance 尚未完成。現有架構契約與保留圖記錄產品規則及技術邊界；Foundation 與 minimum substrate code 不代表完整產品功能已上線。

OpenSpec 的責任是 project-local 的個別 change lifecycle：proposal、delta specs、design、tasks、apply、verify、sync/archive。它不取代 PLAN、PRODUCT_PLAN、CURRENT_ARCHITECTURE 或 OSS_REUSE 的 authority；`openspec/specs/` 的 baseline 是 approved target behavior，不是已實作證明。T01/T02 只保留為 PRE_OPENSPEC_BASELINE_HISTORY，不重建為 OpenSpec historical changes。Engineering Memory 仍是 optional cross-project learning，沒有 runtime、binding 或同步關係。

Change sizing rule：`ONE_OPENSPEC_CHANGE = ONE_COHERENT_BEHAVIORAL_OR_ENGINEERING_CHANGE`。M1 不合併成單一巨型 change，也不為每個微小檔案編輯建立 change。

## Active M2 planning boundary

`m2-intelligence-vertical-slice` 是目前的 M2 intelligence planning change，
狀態為 `PLANNING_ACCEPTED / BATCH_1_SCOPED_IMPLEMENTATION_COMPLETE / PARTIAL`。它只規劃單一
Opportunity、單一 JD revision、固定 Evidence snapshot、可追溯的
requirements/matches/gaps、versioned positioning，以及 bounded candidate
 execution；不代表完整 product-domain runtime 已存在。

M2 的硬性前置是 [`m1-opportunity-evidence-substrate`](../../openspec/changes/archive/2026-09-18-m1-opportunity-evidence-substrate/)，其最小 implementation、validation 與獨立 acceptance 已完成並 archive；該 gate 已滿足。M2 詳細的 identity、taxonomy、traceability、execution、migration 與 backup authority contract 由 active change 的 proposal/spec/design/tasks 擁有；M2 planning review 已 PASS，baseline close-out 已完成，Batch 1 已完成 10/26 scoped tasks；本文件只保留 current boundary 與 dependency，不複製整份 M2 spec。

## Active derived diagrams

目前只維護兩張 active derived diagrams，全部採 Mermaid 文件圖；本輪只交付概念與關係，沒有可操作 UI，也沒有 HTML 視覺驗收。實線表示圖內的邏輯關係，不代表功能已上線；每張圖都有 Current / Proposed 與證據說明。

| 圖 | 目的 |
| --- | --- |
| [Workspace Boundary Map](diagrams/workspace-boundary-map.md) | 本案工作區、私人資料、參考資料與外部能力邊界 |
| [Authority and Ownership Map](diagrams/authority-ownership-map.md) | 人、事實、分析、送出版本的權威 |

## Historical reference

| 圖 | 狀態 |
| --- | --- |
| [Runtime and Data Flow Map](diagrams/runtime-data-flow-map.md) | HISTORICAL_REFERENCE；保留其 Proposed 流程，但不作 current runtime 或 architecture authority |

## Documentation reduction boundary

| Action | 對象 | 決定 |
| --- | --- | --- |
| KEEP | 現有規劃與架構契約 | 由各自 canonical owner 維護 |
| KEEP | 兩張 active derived diagrams | 只保留空間邊界與權責 lineage 兩個視圖 |
| HISTORICAL | Runtime and Data Flow Map | 保留作歷史參考，不宣稱有 runtime |
| KEEP | 使用者附件及舊 Job-Ops | 維持原位置；附件是需求來源，舊案不做修改或搬移 |
| MOVE | 既有本案 runtime/private data | 未發現，無可執行搬移；未來私人資料須在 repo 外 |
| KEEP AS DERIVED VIEW | `docs/project-dashboard.html` overview | 僅提供 navigation/status/security summary；不取代 PLAN、PROGRESS、CURRENT_ARCHITECTURE 或 OpenSpec authority |

## Proposed 執行形式

一個單人應用擁有 canonical 寫入責任；以六個產品領域整理責任，不拆多服務。最小 M1 Career Evidence 與 Opportunity/JD substrate 已由 main process 經 narrow boundary 實作，與後續工作區共同支撐；完整送出、互動、面試與工作區流程仍屬後續 scope。M2 AI 產生候選；domain rules 與人確認決定是否接納。公開研究與 recruiter 說法保留來源，不提高為無條件事實。

T01 已選定 M1 capability boundary：Electron stable v44 line + React/Vite renderer、SQLite through `better-sqlite3`、native filesystem/path/crypto/test APIs，以及 `fflate` ZIP container。Foundation dependency pins 與 ABI probe 曾通過；目前實作 Foundation runtime 與最小 Opportunity/Evidence substrate，不代表完整產品功能已上線。

## T01 M1 selected capability boundary

Status：CONCEPTUAL SELECTION，2026-09-12。此處只記錄 T01 能力選型，不代表安裝或實作狀態；目前實作另見下節。

- Application shape：React/Vite renderer → narrow preload/IPC → Electron main process/application/domain，main process 是唯一 canonical writer；沒有 server、background worker、scheduler、sync 或第二 writer。
- Structured state：SQLite via `better-sqlite3` behind a replaceable persistence boundary. Evidence revisions, Opportunity state, interactions, application events and submission references remain T02 domain contracts.
- Files and identity：native `fs`/`path`/`crypto`; the configured private root remains outside Git, and generated content cannot promote itself to Evidence.
- Backup：`fflate` supplies only the ZIP container. Career 2.0 owns the sorted manifest, SHA-256 entries, complete pre-restore validation, new-root staging and no-silent-merge policy.
- Validation：Node `node:test` plus native fixtures is the selected validation approach; current Foundation and prerequisite substrate evidence is recorded in the active/archived OpenSpec changes. Full M1 product UI acceptance remains separate.
- Replacement gate：the selected SQLite binding passed its synthetic Electron open/write/transaction/reopen gate on 2026-09-15. Earlier 2026-09-16 runtime attempts ended with Electron SIGABRT before probe output, but the final fresh PID 79150 H5 acceptance passed; no dependency change is justified or made.

The detailed current-source audit, score matrices, license records and rejected
options are maintained in [OSS_REUSE.md](../OSS_REUSE.md). No T01 decision
changes the five product invariants or the T02 canonical/generated/derived/
immutable boundaries.

## Current M1 Foundation and prerequisite implementation status

Foundation hardening implementation is complete within the approved M1
threat model. The implementation checks canonical `.career2` and state-file
paths, validates both Darwin ownership state paths, serializes same-root stale
recovery with a generation-bound crash-recoverable claim on non-Darwin (Darwin
holds a kernel-managed `O_EXLOCK` lease), checks ownership through READY publication, and exposes
`{ metadata, close() }` rather than raw SQLite handles. Pre-existing
symlink/hard-link confinement cases pass. An active same-user replacement of
`.career2` between validation and lock open remains unmitigated by decision;
it is an explicit M1 non-goal/future-hardening item and its fixture is skipped.
The foundation suite is 17 passed, 1 skipped, 0 failed; prerequisite domain
tests and the repair regressions extend the current run to 36 passed, 1 skipped,
0 failed, including migration ownership-loss rollback, degraded-foundation
fallback, true cross-process restart/read-back, domain-schema readiness checks,
and public status plus direct domain-IPC error-boundary checks; renderer build passes. The
named prerequisite implementation and its separate read-only acceptance are
complete for its minimum substrate; the change is archived.
The fresh bounded prerequisite Electron probe on 2026-09-17 used PID 54523
and passed the real main/renderer/preload/IPC path, synthetic Opportunity/JD
and Evidence/revision operations, metadata/root binding, visible observation,
and clean ownership reacquisition; the formal prerequisite acceptance passed.
A separate direct Electron probe also passed the public domain-error
transport through `ipcRenderer.invoke -> preload -> renderer`, including
private-path, SQLite/config, stack, unknown-code, known-classification, and
success controls; successful payloads remained unchanged.
H5 is now PASS: fresh PID 79150 loaded the actual Career 2.0 main entry,
created a visible 900x680 BrowserWindow, loaded the local renderer, exercised
the preload and narrow IPC status capability, initialized the synthetic
private-root store to READY version 1 with expected identity/root binding,
held an 8-second visible observation window, and exited with code 0 / signal
null after ownership reacquisition. The user observed the window during the
observation interval. The test-only probe verifies the production
BrowserWindow configuration from the checked-in main source and proves preload
execution through the actual narrow IPC handshake; production window behavior
and dependencies were unchanged. Read-only M1
acceptance review passed and the OpenSpec change is archived. The prerequisite
change remains archived after its separate acceptance review.

## T02 M1 executable architecture contracts

Status：FINALIZED，2026-09-12。此節是 Career 2.0 架構 authority 的 M1 行為契約；不是 database schema、runtime implementation 或 vendor selection。所有 private data 均在 repo 外；所有 generated/derived output 均不能自動提升為 Career Evidence。

### 1. Persistence contract

M1 持久化的是單人工作區的 user-owned state，不是 server state。最小範圍如下：

- Minimal CareerProfile：可選的身份/偏好欄位；未完成 Profile 不阻擋 Opportunity。
- Experience / Career Evidence 與 Evidence revisions：保存來源、本人責任、結果、metric 定義、確認狀態及固定 revision。
- Opportunity 與 JD source revisions：公司、角色、來源 URL、原文捕捉、狀態及歷程；新 JD 增加 revision，不覆蓋舊版。
- Contact、九項 Interaction、InterviewEvent、ApplicationEvent、Application state 與 NextAction。
- Working document/file records、attachment metadata、submitted material snapshots。
- Backup manifest metadata：format/contract version、建立時間、檔案 identity、hash 與包含範圍。

持久化行為：

1. Canonical state 由使用者確認或使用者記錄；current pointer 可變，已被引用的 revision/ snapshot 不可變。
2. 每筆引用保存 opaque identity；不得只依賴「latest」指標。
3. Generated/derived records 必須保存 input revision identities，失效後可重建；不成為 Evidence。
4. Runtime 或 implementation replacement 必須只需搬移 structured state、private bytes、file identities、revision references 與 backup manifest，不得依賴特定 provider、model、framework 或 process。
5. M1 不需要 event sourcing、distributed transaction、server、sync 或 generic repository layer。

### 2. File and attachment boundary

| 類別 | 所在與 owner | 可否編輯 | Identity / retention | 可否重建 |
| --- | --- | --- | --- | --- |
| DATABASE / STRUCTURED STATE | Private data root；Career 2.0 application owns writes | Current records 可由 app 編輯；referenced revision 不可原地改 | Stable record ID、revision ID、content hash where bytes exist | 不能用 generated output 重建 canonical fact |
| WORKING FILE | Private `working` area；user owns content | Yes | file ID、path/handle、size、hash、media type、last observed state | 不自動重建 user-authored bytes |
| ATTACHMENT | Private `attachments` area 或明確 external source reference | Source file 不由 app 改；imported copy 由 app 管理 | file ID、source kind、captured hash、size、availability | 不可用另一檔案靜默替代 |
| GENERATED DOCUMENT | Private working/output area；app records provenance | Candidate 可重做或丟棄 | input revision IDs、generator metadata、output hash | Yes；不成為 Evidence |
| SUBMITTED SNAPSHOT | Private `submissions` area；app writes once | No | Snapshot manifest、exact bytes、hash、submission metadata | No；新送出才產生新 snapshot |
| BACKUP | Private/external backup location；user controls retention | Existing bundle 不改 | Bundle manifest、per-file hashes、contract version | 可建立新 backup；舊 backup 不改 |
| PRIVATE SOURCE MATERIAL | User-owned private source location | External/user may change; app only reads/copies by explicit action | Path/handle plus observed identity and missing state | No; changed source requires new capture |

Working files may be referenced while editing. At submission time, required material and attachment bytes are copied into the submitted snapshot and hashed; a live path alone is insufficient. Missing source files remain explicitly `MISSING` and cannot be reported as complete or silently substituted. User-authored working documents are included in a complete M1 backup; regenerable generated outputs are optional only when their input references and regeneration status are preserved.

### 3. Canonical / generated / derived / immutable contract

| Entity / artifact | Classification | Owner / writer | Source of truth | Mutation rule | Revisioned? | Regeneration rule | Deletion rule |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Minimal CareerProfile | CANONICAL | User; app writes | User-confirmed profile fields | Explicit app edit | No root revision; capture values when needed | Never from generated output | Explicit user delete; captured snapshot values remain |
| Experience / Career Evidence | CANONICAL | User; app writes | Confirmed Evidence record and current revision pointer | Only explicit confirmation moves the pointer; referenced revision is never edited | Yes | Never from generated output | Explicit archive/delete of current pointer; referenced revisions remain |
| Evidence Revision | CANONICAL | User meaning; app creates | Its fixed content, source refs, responsibility and metric definitions | No in-place mutation | Yes; immutable identity | No | No normal deletion while referenced; whole private-data deletion is explicit |
| Opportunity | CANONICAL | User; app writes | User/application Opportunity record | Explicit current-state edit | No root revision; JD revisions separate | No | Explicit archive/delete; submitted history survives |
| JD capture / revision | EXTERNAL_SOURCE | User/capture app | Exact captured source bytes and metadata | Each capture is immutable | Yes per capture | No | Removed source becomes missing; never silently substituted; snapshot copy remains |
| Contact / Interaction | CANONICAL | User; app writes | User-attributed record of who said what and when | Corrections are separate; no silent historical rewrite | Each record/correction is distinct | No | Explicit user deletion only; other records are not repointed |
| Application state / events / NextAction | CANONICAL | User; app writes | Current state plus recorded event history | State transitions explicit; events are not silently rewritten | Each event is distinct | No | Explicit archive/delete of current state; submitted history remains |
| InterviewEvent | CANONICAL | User; app writes | User notes plus explicit submitted-material reference | Notes may be corrected separately; submission binding cannot silently move | Correction is separate when historical meaning changes | No | Explicit user deletion; submission references remain unchanged |
| Working document / file | CANONICAL | User owns content; app writes through the single writer | Current user-authored working bytes | Editable while working; file observation/hash may change | File observation may be revisioned; no Evidence semantics | Never auto-recreated as user content | Explicit user delete; submitted copy remains |
| Attachment record / metadata | CANONICAL | User; app writes | App record of source/copy identity, hash, size, type and availability | Explicit metadata correction; source bytes are not silently replaced | Capture identity is retained | No | Source removal becomes missing; archived submitted copy remains |
| Generated CV / Interview Story | GENERATED | User owns candidate; app/generator writes | Fixed Evidence/JD/Positioning input revisions and generated bytes | Candidate may be edited, replaced or discarded | Yes | Yes; stale output is rebuildable, never Evidence |
| Analysis / EvidenceMatch / Finding / readiness | DERIVED | App computes from fixed inputs | Inputs plus validation rules | Replaceable when inputs or rules change | Yes by input set | Yes | Stale derived rows may be removed; canonical state is unaffected |
| Submitted Material and archived attachment copy | IMMUTABLE_SNAPSHOT | User owns history; app writes at explicit submission | Snapshot manifest, exact bytes and captured references | No ordinary mutation; correction is a separate record | Each submission is a new snapshot identity | No; submit again for a new snapshot | Only explicit whole-private-data deletion; never normal edit |
| Private source material | EXTERNAL_SOURCE | User-owned bytes outside repo | External/source bytes | External/user may change; app only captures explicitly | New capture when source changes | No | User deletion yields a missing reference; no substitute |
| Backup bundle / manifest | IMMUTABLE_SNAPSHOT | User controls retention; app writes | Bundle manifest and per-entry hashes | Existing bundle is not modified | Each backup is a new bundle identity | Create a new backup | Explicit retention deletion; does not alter live state |

Owner/writer rule: the user owns career meaning and confirms canonical facts; one Career 2.0 application is the sole canonical writer. Generated AI/CV/Story content can only create a candidate draft. Only an explicit user confirmation operation can create or update a Career Evidence revision; no import, regeneration, or parser may auto-promote it.

### 4. Revision contract

`EVIDENCE_REVISION_MODEL = immutable revision records + mutable current_revision_id pointer`.

- New Evidence revision is created for any saved factual edit, source change, responsibility/metric-definition change, or explicit confirmation change.
- A revision contains fixed content plus source/file identities, responsibility boundary, metric unit/period/basis/approximation, confirmation state and creation metadata.
- Existing revisions are never updated in place and remain readable while referenced.
- Working/generated artifacts store the exact Evidence revision IDs used. A changed input marks affected drafts stale and requires recheck.
- Submitted snapshots store both Evidence revision IDs and the captured referenced content/hash needed to explain that historical submission.
- Updating or deleting the current Evidence pointer does not mutate submitted snapshots. Normal deletion may mark referenced material unavailable; whole private-data deletion remains an explicit user operation.

### 5. Submitted-version contract

`SUBMITTED_SNAPSHOT_MODEL = one immutable submission record with a self-contained manifest and required bytes`.

On submission, capture:

- `submission_id` and operation identity;
- actual `submitted_at`, plus separate correction/recorded-at time when historical data is entered later;
- `opportunity_id` and enough company/role identity to explain the historical context;
- source/channel and recipient/context when known;
- working material identity, exact content/artifact bytes, media type and SHA-256;
- attachment file IDs, source identities, exact captured bytes/hashes or explicit missing status;
- Evidence `{evidence_id, revision_id, content_hash/content_snapshot}` references used at that time;
- positioning revision reference when applicable;
- immutable creation/provenance metadata.

Operational immutability means the application rejects ordinary edits to snapshot bytes and captured metadata. Corrections are separate records; they never rewrite the original. Repeated submission actions are idempotent for the same user operation, and an interrupted write cannot report a complete submission. Export is not submission; submission requires explicit user confirmation.

### 6. Privacy contract

`PRIVATE_DATA_ROOT_MODEL = one user-configured absolute root outside the Git repository`.

The committed private-data contract contains no user-specific absolute private-data path; the observed repository path above is repository metadata, not a private-data location. Logical private subareas may include `state/`, `sources/`, `working/`, `attachments/`, `submissions/` and `backups/`; exact physical layout remains replaceable. Real CVs, Evidence, JD private notes, attachments, recruiter/contact data, interview notes, AI requests/responses and backups stay under the configured private root or an explicitly user-controlled external location. Git may contain source, contracts, sanitized documentation and synthetic fixtures only.

`REAL_PRIVATE_CAREER_DATA_IN_GIT = 0`.

If the private root is unset, unavailable, unreadable or fails integrity checks, operations requiring it fail closed: no fallback to repository/browser storage, no partial success, no silent alternate path, and no deletion. Unsaved user input must remain visibly unsaved/failed for the eventual UI. Encryption infrastructure is not required for T02/M1; deployment/security choices remain separate decisions.

### 7. Backup and restore contract

`BACKUP_UNIT = one logical deterministic bundle containing manifest, structured M1 state, user-authored working bytes, attachments, private source bytes required by references, and submitted snapshots`.

`BACKUP_INCLUDES_ATTACHMENTS = YES`.

`INTEGRITY_METHOD = manifest with per-entry SHA-256, byte count, media type, logical identity, source class and contract/format version`.

`RESTORE_MODE = validate completely, materialize into a new private root, then make that root selectable; no implicit in-place merge`.

`RESTORE_CONFLICT_POLICY = fail before replacement when destination is non-empty, identity collides, a required byte is missing/corrupt, or format/contract version is unsupported; never overwrite or silently merge`.

Restore must validate manifest, all required bytes and references before reporting success. Staging into a temporary target followed by a final directory replacement is sufficient M1 atomicity; distributed transactions are not required. Generated outputs may be omitted and regenerated only when their inputs remain intact; their absence cannot make canonical Evidence disappear.

### 8. Single-writer / runtime boundary

`ONE_CANONICAL_WRITER = Career 2.0 local application`.

- M1 has no background service, scheduler, server, distributed process, sync layer or multi-agent writer.
- Direct database/file editing outside the application is unsupported for canonical state. The user may use normal file tools for export, backup or explicit source management, but external edits are detected rather than silently absorbed.
- One local application process owns mutations. A stale edit must provide its base revision/identity; if current state changed, the write is rejected for reload/compare instead of overwriting newer content.
- External source changes, missing files and concurrent edits become visible conflict/missing states; no automatic latest-file substitution.

### 9. M1 validation strategy

Fixtures are synthetic, deterministic and local. Domain/persistence/file/backup checks must use fixed inputs, explicit clocks/identities where needed, stable ordering and no network. UI and mobile/keyboard acceptance remains manual for M1; no browser E2E dependency is selected.

| M1 acceptance area | Validation type | Automated/manual | Evidence |
| --- | --- | --- | --- |
| M1-A Opportunity + JD save/reopen/search | DOMAIN, PERSISTENCE, INTEGRATION, UI | Domain/persistence automated; UI manual acceptance | Same company/role/JD/source/NextAction after reopen; no duplicate Opportunity for multiple URLs |
| M1-B submitted V3 remains unchanged | DOMAIN, FILE_SYSTEM, IMMUTABILITY, PERSISTENCE | Automated plus manual inspection | Snapshot bytes, metadata, attachment hashes and Evidence revision contents unchanged after working/Evidence edits |
| M1-C duplicate click/interruption | DOMAIN, PERSISTENCE, IMMUTABILITY | Automated | One submission; interrupted operation has no false complete record; retry is recoverable |
| M1-D NextAction lifecycle | DOMAIN, PERSISTENCE, UI | Domain/persistence automated; UI manual | Reschedule/complete/pause/reopen consistent in list and timeline |
| M1-E Interaction/interview/result records | DOMAIN, PERSISTENCE, UI, MANUAL_ACCEPTANCE | Field/domain automated; flow manual | Nine fields preserved; correct Contact/Opportunity/Submission linkage; unknown feedback remains unknown |
| M1-F backup/restore | BACKUP_RESTORE, FILE_SYSTEM, PRIVACY, INTEGRATION | Deterministic automated fixture test plus manual smoke | Full M1 state/attachments/submissions restored; missing/corrupt input never reports success; no Git private data |
| M1-G Evidence without AI | DOMAIN, PERSISTENCE, IMMUTABILITY, UI | Domain/persistence automated; Career flow manual | Create/edit/confirm three Evidence records; old revisions remain; Opportunity works without Profile/AI |
| M1-H explicit submitted version for interview | DOMAIN, PERSISTENCE, IMMUTABILITY, UI | Linkage automated; visible flow manual | Interview opens selected submitted V3; unselected history shows needs-confirmation, never latest auto-selection |

PASS requires exact acceptance behavior, no hidden fallback, no unresolved data-loss condition and evidence tied to the tested revision/fixture. Tests alone do not establish visual/manual acceptance.

### 10. T01 capability requirements

| Capability | REQUIRED | PREFERRED | NOT_REQUIRED | DEFERRED |
| --- | --- | --- | --- | --- |
| Structured persistence | Local-first records, stable IDs/revisions, atomic-enough writes, queries, export, private local execution, low operational burden, replaceable interface | Mature OSS, deterministic backup, small dependency footprint, easy migration | Distributed DB, event sourcing, multi-user sync, vector index | Cloud sync, scale-out, analytics |
| Attachment/document handling | Standard private filesystem/API, metadata, hash/size/type, copy/reference distinction, missing/corrupt state, no public upload | Portable files, streaming, easy recovery, low lock-in | Full DMS, collaboration, OCR, asset marketplace | Rich previews, document collaboration |
| Immutable snapshots | Exact bytes/content, metadata, Evidence revision refs, hashes, idempotent submission, ordinary mutation rejection | Atomic file handling, clear read-back and export | Blockchain, notarization, append-only DB infrastructure | Signed attestations |
| Backup/restore | Complete M1 state, attachments, deterministic manifest, integrity checks, version compatibility, new-root restore, no silent overwrite | Standard portable archive, low-cost verification, clear migration path | Cloud backup service, differential backup engine | Scheduling, remote replication |
| Local runtime/application framework | One local application, one writer, configurable private root, no required server/network, accessible controls | Mature OSS/native capability, small footprint, replaceable modules, easy test execution | Custom browser runtime, agent runtime, provider router, plugin framework | Multi-user/cloud runtime |
| Testing/validation | Deterministic domain/persistence/filesystem/backup/immutability/privacy checks plus manual UI acceptance | Existing/native test capability, readable fixtures, stable artifact evidence | Large test platform before need is proven, automatic visual grid by default | M2 AI/renderer evaluation and advanced semantic review |

T01 compared existing/native/OSS options against these requirements and recorded exit/migration cost, privacy behavior, license, maintenance, interfaces and current-source evidence in [OSS_REUSE.md](../OSS_REUSE.md). The selection is historical; the archived OpenSpec change records installed pins and foundation probes. Those probes do not imply full product-domain behavior; the named minimum substrate is recorded separately above and in its active OpenSpec change.

### 11. Deferred architecture

Beyond M1: AI execution and provider/model choice; CV/Interview generation; document editor and renderer/PDF; company research and public-source ingestion; external calendar/email/connectors; cloud sync and multi-user collaboration; complex analytics/feedback warehouse; Job Discovery/source aggregation; CRM; encryption/key-management infrastructure; background scheduling and automation.

Simplicity test result：M1 requires one local writer, private files, explicit revisions, immutable submission snapshots, deterministic backup/restore and bounded validation. It does not justify server architecture, generic adapters, agent/orchestration layers, custom browser runtime, plugin system, event-sourcing platform or future-scale infrastructure. Electron is the selected existing desktop shell; it is not a custom browser runtime.
