# 現成能力與 OSS 候選

查閱日期：2026-09-12。T01 已完成 current-source capability audit；只查官方文件、官方 repository/release 與 package registry，沒有安裝、執行或複製程式。頁面內容會變動；implementation kickoff 仍須重新確認 release、授權檔、相依套件與 runtime compatibility。

2026-09-12 scope freeze 註記：沿用本次參考研究，不重新擴張產品研究。Career 2.0 independent Git baseline 與 T02 Phase 0 architecture 已完成；本文件的 T01 section 記錄 M1 capability boundary。Engineering Memory 僅為 optional cross-project reference，沒有 bootstrap/binding 或 runtime dependency。這是概念選型，不代表已安裝或已完成 implementation validation；AI/renderer 等 M2 能力仍按需另選，不能阻擋 M1。

## 1. 目前可確認的參考

| 候選 | 查得能力 | 本案建議 | 尚未證明 |
| --- | --- | --- | --- |
| [Career Ops](https://github.com/career-ops-hq/career-ops) | 原 santifer/career-ops 轉至此 repo；README 描述本機 CLI 職缺評估、CV、Story Bank、追蹤及面試流程，標示 MIT | ADAPT_CONCEPT：研究如何從資料選案例及組織評估。只借相關概念，不 fork 整套系統 | 引用精度、可拆用性、與本案不變條件相容、實際品質；使用者所指的同名參考是否就是此 repo |
| [Reactive Resume](https://github.com/reactive-resume/app) | 舊 amruthpillai/reactive-resume 轉至此 repo；MIT，可自架，README 列 PDF/JSON/DOCX 輸出與 JSON Resume 匯入 | REUSE_FROM_OSS 候選：模板與輸出；也可先把它當獨立輸出工具比較 | 能否以現有公開介面接入、模板能否獨立使用、中文斷頁、引用映射保留與維護成本 |
| [JSON Resume](https://jsonresume.org/schema) | 社群履歷資料格式，官方頁標示 MIT，涵蓋基本資料、工作、學歷等 | USE_DIRECTLY 候選：履歷交換格式。只用作輸出邊界，不當作完整 Career Evidence 主模型 | 本案 claim-level provenance 不由此格式完整承接；匯入/匯出保真需樣本驗證 |
| [resume-cli](https://github.com/jsonresume/resume-cli) | 原 repo 說明開發移至 jsonresume/jsonresume.org 的 packages/cli；含格式驗證與輸出介面 | REUSE_FROM_OSS 候選：配合現成 theme 與標準輸出；選型須查看新維護位置 | 不可把舊 repo 歷史用法當新版本已測；中文、PDF、runtime 支援需核查 |
| [SQLite](https://www.sqlite.org/whentouse.html) | 官方將本機應用資料儲存列為適用場景 | REUSE_FROM_OSS：T01 選定為 M1 structured persistence；driver 與 Electron ABI 風險見下方決策 | exact install/version pin、migration test、Electron compatibility 尚待 implementation kickoff |
| [Tiptap](https://tiptap.dev/docs/editor/getting-started/overview) | 官方說明基於 ProseMirror 的可擴充 editor；開源核心 MIT，另有付費 extensions | REUSE_FROM_OSS 候選：僅在結構化文件編輯超出原生表單能力時使用 | 付費功能不可默認可用；不為版本快照而購建協作平台 |
| [Job Tracker](https://jobtracker.shunzz.com) | 本次讀取未取得可檢視的頁面內容 | DEFER：保留為使用者指定參考 | Insufficient evidence；不聲稱有看板、版本、AI 或其他功能，未做視覺評估 |

另有同名 Career Ops 專案，本文件只使用上表明列的候選，不混用名稱推論功能。舊本機 Job-Ops 本輪未讀取、未引用其架構或實作。

## 2. 每類能力的取用策略

分類含義：USE_DIRECTLY 是利用現成原生/標準能力；REUSE_FROM_OSS 是採用成熟 OSS 能力；ADAPT_CONCEPT 僅借設計概念；BUILD_DIFFERENTIATOR 是本案特有產品行為；DEFER 是本階段不需要。T01 的 capability decision 已完成；所有依賴仍未安裝，implementation validation 與 exact lockfile pin 留在下一階段。

| 能力 | Classification | 第一選項 | 替代與比較重點 |
| --- | --- | --- | --- |
| JD 輸入 | USE_DIRECTLY | 貼文字、手動 URL | 自動擷取延後，無需本期 crawler |
| 基本表單、搜尋、filter、日期輸入 | USE_DIRECTLY | 選定框架後的原生/現成 controls | 不自製控件庫；比較鍵盤可用性與中文 |
| CV/筆記編輯 | USE_DIRECTLY | 結構化欄位或文字區 | 必要時 REUSE_FROM_OSS editor，避免先造文字處理器 |
| CV 交換格式 | USE_DIRECTLY | JSON Resume 候選 | 如模板工具原生格式更合適，需確認可退出與保留引用 |
| 排版與 PDF | REUSE_FROM_OSS | 現成單欄 ATS template + 成熟 renderer 候選 | 與 Reactive Resume 獨立輸出比較；原生 print 只在既有模板可用時評估，不自建排版引擎 |
| 資料持久化/查詢 | REUSE_FROM_OSS | SQLite + replaceable driver boundary | 與 file-only state 比較；T01 選定 SQLite，driver 風險及退出方式見下方 |
| 附件/備份/匯出 | USE_DIRECTLY | 私人檔案目錄、平台檔案 API、標準備份工具 | 不建 object-storage 平台；完整引用清單是本案匯出內容 |
| 版本文字差異 | REUSE_FROM_OSS | 選定 runtime 中成熟 diff 套件 | M1 先比較檔案/日期/備註；M2 才需文字 diff |
| AI 產生 | USE_DIRECTLY | 批准的既有 CLI/API/原生結構化回傳 | 保留供應商選項但一次接一種可用能力；不建 custom adapter/router |
| AI review/recheck | ADAPT_CONCEPT | 有限流程：檢查、問題、修正、再檢查 | 使用現有執行能力；不建 agent framework |
| 職缺分析/故事準備 | ADAPT_CONCEPT | 上述 Career Ops 的流程參考 | 不移植評分閾值、batch、scanner、目錄結構 |
| 事實引用/責任邊界/版本影響 | BUILD_DIFFERENTIATOR | 固定來源版本與產品檢查規則 | 只建領域行為，不建通用 graph platform |
| 要求匹配/缺口/定位 | BUILD_DIFFERENTIATOR | 有理據的匹配、主定位與取捨 | 不用全文相似度代替適配判斷 |
| 同源 CV/Interview Pack | BUILD_DIFFERENTIATOR | 同一策略、證據、版本基準 | 外部 renderer 只負責文件呈現 |
| 投遞封存/準備連續性 | BUILD_DIFFERENTIATOR | 檔案及定位快照、面試接續 | 元件可重用，但業務規則由本案維護 |
| 公司研究 | DEFER | Phase 2 使用現有搜尋/瀏覽/引用能力 | 先保留人工來源筆記；不自建 browser runtime |
| 行事曆/郵件/外部提醒 | DEFER | 本期只記錄與 app 內下一步 | 將來選現有 connector；不默認外部發送權限 |
| 向量搜尋/大規模語意索引 | DEFER | 小量經歷先用一般查詢與明示引用 | 資料量與品質證明需要後再比較 OSS |
| Auth、多租戶、同步、CRM、analytics | DEFER | 單人本機不需平台化 | Full CRM / complex analytics 為明確排除，並非稍後重建 |

## 3. 三條可選架構路線

| 方案 | 優點 | 代價 | 本次判斷 |
| --- | --- | --- | --- |
| A. 小型自有工作區 + 現成儲存/輸出/AI 能力 | 容易以 Evidence、版本、下一步為核心；能控制操作流程 | 需要實作本案領域行為 | T01 選定 M1 路線；M2 AI/輸出仍按需選型 |
| B. 以既有完整 Career Ops 系統為基底 | 可利用現有求職功能 | 其資料、流程與 UX 是否合適尚未驗證，容易引入不在範圍的能力 | 保留比較，不推薦直接 fork |
| C. 先組合筆記/試算表 + 既有履歷工具 | 可用最少產品開發驗證日常需求 | 跨文件引用與歷史一致性多靠人工 | 可作流程驗證或輸出 fallback，非完整差異化 MVP 的替代驗收 |

這是產品架構取捨，不是固定 framework 決定；本次不實作任何方案。

## 4. 開工前的能力評估順序與證據

本輪完成 T01 的 current-source audit：確認本案仍無既有應用；查官方 OSS 文件、release/activity、license、相依與 runtime compatibility；記錄比較標準。沒有套件實測、安裝或 implementation approval；這些是下一個 execution gate 的證據。

每個必要能力在 T01 依以下順序形成一張決策紀錄：

1. 既有專案能力：目前為空目錄，無可重用本案程式。
2. 成熟 GitHub OSS：用途、維護位置、版本、license、相依、已知限制。
3. 平台原生能力：檔案/輸入/列印是否已足夠。
4. Skills / Plugins / MCP：當前執行環境可用能力是否適合開發驗證，不能假定會隨產品交付。
5. CLI/API/標準介面：是否真的公開、可穩定使用、能保留本案資料。
6. 至少兩個可行選項或一個選項加不用此能力的 fallback，按本案樣本比較。
7. 明確推薦、額外服務需求、資料出機範圍、成本上限、替換方式及待測項目。
8. T01 只批准 capability boundary 與推薦路線；使用者/coordinator 批准 implementation kickoff 後，才安裝、建置、試跑；產品範圍批准不能取代此步。

候選的通過條件：完整資料可匯出、無須把私人資料放 repo、能使用現成介面、不引入禁止基礎設施、維護者/授權/版本可追溯、能通過本案失敗與真實樣本驗收。

## 5. T01 M1 capability selection — FINAL

T01 decision scope is the smallest capability set needed for M1. It does not
approve installation, create a package manifest, or start product
implementation. Exact versions below are a research snapshot taken on
2026-09-12; the implementation kickoff must re-check the selected release and
pin it before installation. A failed compatibility check is a stop-and-review
condition, not permission to silently substitute another tool.

### 5.1 Capability summary

| Capability | Decision | Selected approach | Why |
| --- | --- | --- | --- |
| Structured persistence | USE_EXISTING_OSS — APPROVED capability | SQLite through `better-sqlite3` 13.0.3, behind an application-owned persistence boundary | Transactions, relations, stable IDs, migrations and portable local backup fit T02. The driver is replaceable; domain contracts do not depend on its API. |
| File / attachment handling | USE_NATIVE — APPROVED | Electron/Node `fs`, `path`, and `crypto`; private-root path policy remains Career 2.0 domain code | M1 needs safe paths, copy/reference, metadata, missing state and SHA-256, not a document-management system. |
| Immutable snapshots | BUILD_PRODUCT_DIFFERENTIATOR — APPROVED domain behavior | SQLite constraints plus staged native file writes, exact hashes, operation identity and explicit submission state | Immutability is a Career 2.0 historical rule. No snapshot library or append-only infrastructure is justified. |
| Backup / restore | USE_EXISTING_OSS + BUILD_PRODUCT_DIFFERENTIATOR — APPROVED | `fflate` 0.8.3 as a ZIP container; Career 2.0 owns the deterministic manifest and restore policy | The container is replaceable. The manifest, SHA-256 checks, complete preflight, new-root materialization and no-merge rule are product contracts. |
| Local application / runtime | USE_EXISTING_OSS — APPROVED | Electron stable v44 line; 44.3.0 was the current stable release observed on 2026-09-12 | One JavaScript application can own the main-process writer, private-root access and UI without a required server. The binary is heavier than Tauri, but the single-language operational model is simpler for M1. |
| UI framework | USE_EXISTING_OSS — RECOMMENDED | React 19.3 with Vite 8.3 and `@vitejs/plugin-react` 6.1.1 | Fits the approved workspace IA and keeps UI replaceable from the domain/application layer. Vite is a build/dev tool; the packaged app has no required network server. |
| Testing / validation | USE_NATIVE — APPROVED | Node `node:test`, `node:assert/strict`, temporary directories, deterministic fixtures and manual UI acceptance | Covers domain, persistence, files, hashes, snapshots, backup/restore and privacy without a second test platform. UI automation remains deferred unless M1 evidence later requires it. |

Explicit decisions:

```text
M1_PERSISTENCE_SELECTION = SQLite via better-sqlite3 behind a replaceable persistence boundary
M1_FILE_CAPABILITY = NATIVE
M1_SNAPSHOT_IMPLEMENTATION_APPROACH = domain rules + SQLite transaction + staged immutable bytes; no dedicated snapshot library
M1_BACKUP_CONTAINER = fflate 0.8.3 ZIP with fixed ordering, fixed metadata and fixed compression settings
M1_BACKUP_MANIFEST = versioned Career 2.0 manifest.json with sorted logical entries, identity, source class, media type, size and SHA-256
M1_RESTORE_APPROACH = validate the complete bundle first, stage into a new private root, then make it selectable; no overwrite or silent merge
M1_RUNTIME_SELECTION = Electron stable v44 line (44.3.0 research snapshot)
M1_PLATFORM_SCOPE = local desktop application; Electron is a replaceable shell choice, not a new cross-platform product promise
M1_UI_FRAMEWORK_SELECTION = React 19.3 + Vite 8.3 + @vitejs/plugin-react 6.1.1
M1_TEST_STACK = Node built-in node:test + node:assert/strict + native filesystem fixtures + manual UI acceptance
```

These are conceptual selections, not installed dependencies. M1 remains
local-first, single-writer and usable without AI, network, cloud sync or a
server process.

### 5.2 Candidate comparison

Scores are 1–5: 1 poor, 3 acceptable, 5 excellent. `Mnt` means maintenance,
`Simp` simplicity, `Repl` replaceability, `Priv` privacy fit, `Test`
testability and `Ops` operational cost (5 = low cost). The choice is based on
the M1 trade-off, not on the total alone.

#### Structured persistence

| Candidate | Fit | Maturity | Mnt | Simp | Repl | Priv | Test | Ops | Lock-in | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| SQLite + `better-sqlite3` | 5 | 5 | 4 | 4 | 4 | 5 | 5 | 4 | 4 | SELECT; native-addon rebuild is the accepted cost |
| SQLite + Node `node:sqlite` | 5 | 3 | 5 | 5 | 4 | 5 | 5 | 5 | 4 | Fallback/re-evaluate; v24 API is release-candidate status |
| File-only JSON/YAML | 3 | 4 | 2 | 5 | 3 | 5 | 4 | 5 | 5 | REJECT; transactions, migrations and relational integrity become custom code |

`better-sqlite3` wins over the native Node API despite the extra rebuild step:
the current package exposes full SQLite transaction support and a stable,
well-established synchronous interface, while the Node v24 `node:sqlite` API
was still documented as release-candidate. Electron’s official documentation
also makes the rebuild requirement explicit, so this is a visible bounded risk
rather than a hidden runtime assumption.

The package registry and official package metadata both reported 13.0.3 during
this audit. The GitHub release view exposed an older release as its latest
loaded entry, so the exact package/release relationship must be rechecked before
installation; this is a version-audit gate, not permission to switch drivers
silently.

#### Local runtime and UI

| Candidate | Fit | Maturity | Mnt | Simp | Repl | Priv | Test | Ops | Lock-in | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Electron + React/Vite | 5 | 5 | 5 | 3 | 4 | 5 | 5 | 3 | 3 | SELECT; heavier binary, simpler JS-only delivery |
| Tauri 2 + React/Vite | 5 | 4 | 4 | 3 | 4 | 5 | 4 | 3 | 4 | REJECT for M1; Rust + JS project/build boundary is extra operational surface |
| SwiftUI/AppKit + system SQLite | 4 | 5 | 5 | 4 | 2 | 5 | 5 | 4 | 1 | REJECT; macOS lock-in is not established by product authority |
| Browser/PWA + browser storage | 2 | 5 | 5 | 4 | 4 | 2 | 3 | 5 | 4 | REJECT; does not reliably satisfy configurable private-root and file/database ownership |

Electron is intentionally selected over the smaller Tauri binary because M1
has no evidence that binary size outweighs the Rust toolchain, two-language
project structure and native integration surface. The main process is the
only writer; the renderer receives narrow application commands and never owns
the database or private-root policy.

#### Backup container

| Candidate | Fit | Maturity | Mnt | Simp | Repl | Priv | Test | Ops | Lock-in | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `fflate` ZIP | 5 | 4 | 4 | 5 | 4 | 5 | 5 | 5 | 4 | SELECT; zero runtime dependencies and fixed mtime support |
| `archiver` ZIP/TAR | 5 | 5 | 4 | 3 | 4 | 5 | 5 | 3 | 4 | REJECT for M1; mature but larger dependency surface than needed |
| OS archive command | 3 | 5 | 3 | 4 | 3 | 5 | 4 | 4 | 3 | REJECT as canonical cross-platform binding; acceptable diagnostic fallback only |

`fflate` is only a container capability. It does not define what Career 2.0
backs up, and it cannot decide whether a submission is immutable or complete.
Entries are sorted by logical path, the archive timestamp and file attributes
are normalized, and the manifest is validated independently of ZIP checksums.

Backup capture coordinates the SQLite snapshot and private files under the
single writer: state is read consistently, each selected byte is copied or
read back and hashed, and the manifest/bundle is published only after every
required entry passes. A changed or unreadable source fails the backup rather
than producing a partial success. The product contract defines deterministic
logical contents and ordering; a pinned `fflate` version plus fixed ZIP
metadata makes the same input reproducible at the container level.

#### Testing and validation

| Candidate | Fit | Maturity | Mnt | Simp | Repl | Priv | Test | Ops | Lock-in | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Node `node:test` + native assertions/fixtures | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | SELECT for M1 |
| Vitest + Playwright | 5 | 5 | 4 | 3 | 4 | 4 | 5 | 3 | 4 | DEFER; add only if implementation evidence requires component/E2E automation |

M1 automated evidence is sufficient for domain, persistence, filesystem,
immutability, backup/restore and privacy. The visual workspace, keyboard flow,
mobile-width behavior and final user acceptance remain manual for M1; adding a
browser runtime solely for those checks is not justified.

### 5.3 Current-source audit

The following sources were checked on 2026-09-12. Release numbers are a
selection snapshot, not a promise that the same patch should be installed
later.

| Candidate | Current source evidence | License | Maintenance / compatibility finding |
| --- | --- | --- | --- |
| SQLite | [SQLite transactions](https://www.sqlite.org/lang_transaction.html), [atomic commit](https://www.sqlite.org/atomiccommit.html), [backup API](https://www.sqlite.org/backup.html) | Public SQLite license | Official documentation covers one-writer transactions, crash-safe commit and online backup snapshots; directly fits local state and backup requirements. |
| `better-sqlite3` 13.0.3 | [official package metadata](https://github.com/WiseLibs/better-sqlite3/blob/master/package.json), [official repository](https://github.com/WiseLibs/better-sqlite3) | MIT | Current registry/repository evidence shows Node >=22, full transactions and a synchronous API. It is a native addon; Electron requires rebuild against Electron’s ABI. |
| Electron 44.3.0 | [official release](https://github.com/electron/electron/releases/tag/v44.3.0), [official overview](https://www.electronjs.org/docs/latest) | MIT | Current stable release line observed; official docs support one JS/HTML/CSS cross-platform app. Main-process filesystem/database access remains a bounded application boundary. |
| `@electron/rebuild` 4.2.0 | [official releases](https://github.com/electron/rebuild/releases), [official package metadata](https://github.com/electron/rebuild/blob/main/package.json) | MIT | Current official build helper; build-only and required only to make the selected native SQLite driver load in Electron. |
| React 19.3 | [official versions](https://react.dev/versions), [official package](https://github.com/react/react/blob/main/packages/react/package.json) | MIT | Current official documentation/repository is active; renderer-only dependency with no ownership of domain state. |
| Vite 8.3.0 | [official release](https://github.com/vitejs/vite/releases/tag/v8.3.0), [official repository](https://github.com/vitejs/vite) | MIT | Release observed 2026-09-10; current active build tool. It is not an M1 application server. |
| `@vitejs/plugin-react` 6.1.1 | [official package](https://www.npmjs.com/package/@vitejs/plugin-react), [official repository](https://github.com/vitejs/vite-plugin-react) | MIT | Current registry release observed; peer range supports Vite 8 and Node 20.19+/22.12+. Build-only JSX/Fast Refresh capability. |
| `fflate` 0.8.3 | [official repository](https://github.com/101arrowz/fflate), [package registry](https://www.npmjs.com/package/fflate) | MIT | Current registry release observed; pure JavaScript, zero runtime dependencies, ZIP support, streaming APIs and fixed mtime option. Container only. |
| Node `node:test`, `fs`, `path`, `crypto` | [Node v24 test API](https://nodejs.org/docs/latest-v24.x/api/test.html), [filesystem API](https://nodejs.org/docs/latest-v24.x/api/fs.html), [crypto API](https://nodejs.org/docs/latest-v24.x/api/crypto.html) | Node.js project license | Native capabilities remove unnecessary packages for tests, paths and SHA-256. Node `node:sqlite` was checked but not selected as primary because its v24 documentation marks it release-candidate. |

Compatibility boundary: the selected native driver must be loaded only in the
Electron main process and must pass a small synthetic open/write/transaction/
reopen check before M1 persistence work is accepted. If the check fails, stop
and re-evaluate the driver/runtime decision; do not replace it silently.

### 5.4 Proposed dependency list

No dependency is installed by T01. The conceptual dependency list is:

| Name | Purpose | License | Current maintenance status | Why needed | Native alternative | Replaceability boundary |
| --- | --- | --- | --- | --- | --- | --- |
| `electron` 44.x | Desktop shell, main/renderer process boundary, native dialogs | MIT | Active official stable line; current snapshot 44.3.0 | Provides one local application with private-root access and no required server | SwiftUI/AppKit, but platform-specific | Shell and IPC only; no product semantics |
| `better-sqlite3` 13.0.3 | SQLite driver | MIT | Active official repository/registry; current package metadata checked | Transactions, relations and deterministic local reads/writes | `node:sqlite` is a fallback candidate but release-candidate | Persistence implementation behind domain/application ports |
| `@electron/rebuild` 4.2.0 | Rebuild native SQLite addon for Electron ABI | MIT | Active official Electron project; current release checked | Required by Electron’s native-module ABI boundary | Avoid only by selecting a different SQLite binding/runtime | Build-only; never part of domain/runtime contracts |
| `react` 19.3 + `react-dom` 19.3 | UI composition and DOM rendering | MIT | Active official React project | Matches workspace IA and information-rich but calm UI | Plain DOM, but would add UI plumbing without product value | Renderer only |
| `vite` 8.3.0 | Renderer development/build pipeline | MIT | Active official Vite project; current release checked | Small, replaceable build tool for React renderer | Other standard bundler, no product dependency | Build-only |
| `@vitejs/plugin-react` 6.1.1 | JSX transform and development refresh | MIT | Active official Vite project; current release checked | Standard React/Vite integration | Manual JSX transform, not justified | Build-only |
| `fflate` 0.8.3 | ZIP container for deterministic backup bundle | MIT | Active official repository/registry; zero runtime dependencies | Portable archive bytes without OS-specific command dependency | OS archive or future standard library, subject to portability | Container only; manifest and restore rules remain Career 2.0 |

`better-sqlite3` and `@electron/rebuild` are the only native-addon-related
complexity in the recommended route. No ORM, repository framework, document
manager, archive framework, model client, browser runtime, agent framework or
provider adapter is selected.

### 5.5 Native capabilities and build/adopt gate

No new dependency is necessary for:

- private-root path joins, normalization and existence checks (`fs`/`path`);
- copying, staging, read-back and file metadata (`fs`);
- SHA-256 file identity (`crypto`);
- deterministic unit/domain fixtures and temporary directories (`node:test`,
  `node:assert/strict`, `fs`);
- Electron native file dialogs and the main-process boundary.

The native capability is not enough for relational transactions or a portable
archive container, which is why SQLite and `fflate` remain the only selected
runtime OSS capabilities.

```text
EXISTING_NATIVE_CAPABILITY_AVAILABLE = YES for filesystem, SHA-256, fixtures and test runner; NO for relational persistence and portable ZIP container
MATURE_OSS_AVAILABLE = YES for SQLite binding, Electron, React/Vite and ZIP container
WHY_EXISTING_OPTIONS_FAIL = file-only state lacks transactional relational integrity; browser storage cannot own the configured private root; OS archive commands are not a portable application binding
WHY_CUSTOM_BUILD_IS_PRODUCT_DIFFERENTIATOR = only Career 2.0 domain rules, manifest fields and validation behavior are product-specific; no generic infrastructure is needed
CUSTOM_BUILD = NOT_AUTHORIZED
```

The only `BUILD_PRODUCT_DIFFERENTIATOR` items are the Evidence/snapshot rules,
manifest contract and validation decisions already required by T02. They are
not a new framework, adapter, router, harness or backup engine.

### 5.6 Runtime, privacy, backup and testing consequences

Minimal M1 execution shape:

```text
React renderer (Vite-built)
        ↓ narrow preload/IPC commands
Electron main process: application + domain + single canonical writer
        ↓
better-sqlite3 SQLite state + native private filesystem/path/crypto + fflate backup container
```

There is no application server, background worker, scheduler, sync process or
second writer. Vite’s development server, if used during development, is not a
required product runtime or network dependency. The renderer cannot directly
edit the database or private root.

The selected capabilities support:

```text
PRIVATE_ROOT_OUTSIDE_GIT = SUPPORTED
REAL_PRIVATE_DATA_IN_GIT = 0
NO_REQUIRED_CLOUD = TRUE
NO_REQUIRED_NETWORK = TRUE
DETERMINISTIC_MANIFEST = SUPPORTED by product manifest + sorted archive entries
SHA256_PER_ENTRY = SUPPORTED by native crypto
FULL_PRE_RESTORE_VALIDATION = SUPPORTED by application/domain logic
RESTORE_TO_NEW_ROOT = SUPPORTED by native filesystem staging
NO_SILENT_MERGE = SUPPORTED by destination checks and fail-before-materialize rule
```

Validation mapping for the selected stack:

| Area | Capability | M1 evidence | Manual-only remainder |
| --- | --- | --- | --- |
| DOMAIN | Node `node:test` + native assertions | Evidence revision, Opportunity state, idempotent submission, generated-content non-promotion | None for stated domain rules |
| PERSISTENCE | SQLite + `better-sqlite3` | transaction behavior, reopen, migration version, stable references | None beyond implementation compatibility probe |
| FILESYSTEM | Node `fs`/`path`/`crypto` | safe-root checks, copy/reference, missing file, size/media type/hash | final OS permission smoke check if platform-specific |
| IMMUTABILITY | domain + persistence + staged bytes | old revisions/submissions unchanged after updates; no hash mismatch accepted | manual inspection of one visible historical record |
| BACKUP_RESTORE | `fflate` + manifest contract | deterministic manifest, per-entry hash/size, corrupt/missing rejection, restore to new root/no merge | manual user-facing restore confirmation |
| PRIVACY | configured-root tests + Git scan | repo contains no real private data; unavailable root fails closed | user confirms chosen private root at setup |
| UI | React/Vite renderer | manual M1-A–M1-H flow, keyboard and mobile-width checks | all visual/interaction acceptance remains manual for M1 |

### 5.7 Rejected and deferred options

Rejected for M1:

- file-only JSON/YAML persistence: its apparent simplicity would move
  transaction, migration, relationship and conflict behavior into a custom
  persistence engine;
- Node `node:sqlite` as primary binding: attractive zero-dependency option,
  but the current v24 API is release-candidate and Electron runtime coupling
  must not be treated as stable without a later recheck;
- Tauri: smaller runtime footprint, but the Rust + JavaScript project/build
  boundary is not justified by current M1 requirements;
- SwiftUI/AppKit: strong native fit, but macOS lock-in is not a Career 2.0
  product decision;
- browser/PWA storage: cannot satisfy the configured private-root and
  application-owned database semantics without adding an unwanted server or
  browser-specific permission model;
- `archiver` and `node-tar`: capable archive libraries, but their broader
  surface/dependency or licensing/portability trade-offs are unnecessary for a
  small ZIP bundle;
- Vitest + Playwright: mature, but a second test platform and browser runtime
  are not required for M1’s explicitly manual UI acceptance;
- Reactive Resume, JSON Resume and Career Ops: reference/output or concept
  sources only; none owns Career Evidence, immutable submissions or the
  Opportunity-centered workflow.

Deferred beyond M1: AI execution and provider/model choice; CV/Interview
generation and document renderer/PDF; rich editor; company research and
public-source ingestion; calendar/email/connectors; cloud sync; multi-user;
complex analytics; Job Discovery; CRM; encryption/key management; scheduling;
semantic/vector search; and automated visual browser review.

### 5.8 OSS-first and replaceability result

`OSS_FIRST = TRUE` and `REPLACEABILITY_FIRST = TRUE` remain active. The
application owns only the product-specific domain rules and narrow interfaces:

- changing the SQLite driver does not change Evidence, Opportunity, revision or
  submission contracts;
- changing the ZIP library does not change the manifest or restore behavior;
- changing Electron, React or Vite does not change the application/domain
  writer or private-data layout contract;
- generated output and future AI capabilities remain outside canonical state.

T01 result: capability selection is complete for M1. Installation, exact
lockfile pinning, compatibility probes and product implementation remain
separate authorized work.
