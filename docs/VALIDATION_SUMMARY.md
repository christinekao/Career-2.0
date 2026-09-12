# Career 2.0 Validation Summary

日期：2026-09-13。這是有界 evidence index，不取代原 specs、tests、Git 或驗收來源。[Dashboard](project-dashboard.html) · [Decision Log](DECISION_LOG.md) · [Progress](../PROGRESS.md)

```text
IMPLEMENTED != VALIDATED
DOCUMENTED != EXECUTED
ARTIFACT_EXISTS != ARTIFACT_USABLE
A_PASS + B_PASS != A_TO_B_PASS
```

Career 2.0 尚無完成的 application runtime。文件契約與選型不代表行為已實作；baseline specs 表示 approved target behavior。此處的 planning PASS 不可轉用為 runtime PASS。

| VALIDATION_ID | SUBJECT | RESULT | 證明界線 |
| --- | --- | --- | --- |
| C2-V001 | OpenSpec planning / strict validation | PROVEN | 7 items 結構驗證通過，4/4 planning artifacts 完整，implementation tasks 0/10 |
| C2-V002 | 本次 Starter Kit 文件與邊界 | PROVEN | 只檢查 derived artifacts、source links、authority、freshness 與變更隔離 |
| C2-V003 | Foundation runtime | NOT_YET_TESTED | 尚無執行證據；不把未跑 probe 記為產品 defect |
| C2-V004 | M1 / M2 product acceptance | NOT_YET_TESTED | 尚未證明持久化產品流程、immutability、backup 或 UI acceptance |

## C2-V001 — Planning / specs

- VALIDATION_ID: C2-V001
- SUBJECT: `establish-m1-foundation` 與六份 baseline specs。
- WHAT_WAS_CHECKED: 對當前 working tree 執行 `openspec status --change establish-m1-foundation --json` 與 `openspec validate --all --strict --no-interactive`；另外直接數 tasks checkbox。
- RESULT: PROVEN（文件結構 / planning readiness）。
- PROVEN: 7 passed、0 failed；proposal/specs/design/tasks 全部 `done`，`isPlanningComplete = true`；tasks 0 checked / 10 total。
- NOT_PROVEN: semantic completeness、implementation approval、runtime correctness、task completion、產品驗收、sync/archive completion。
- LIMITATIONS: CLI status 的 `isComplete = true` 在此指 planning artifacts，不是產品 change 已實作完成。預設 `/usr/local/bin/openspec` 因系統 Node 的 `libsimdutf.34.dylib` 缺失而 exit 134；使用既有 bundled Node 執行同一份已安裝 OpenSpec CLI 後 exit 0，未安裝或修復系統環境。
- EVIDENCE: 下列執行摘要；[tasks](../openspec/changes/establish-m1-foundation/tasks.md)、[proposal](../openspec/changes/establish-m1-foundation/proposal.md)、[design](../openspec/changes/establish-m1-foundation/design.md)、[delta spec](../openspec/changes/establish-m1-foundation/specs/application-foundation/spec.md)、[baseline specs](../openspec/specs/)。
- DATE: 2026-09-13T03:27:52+08:00
- SOURCE_REVISION: `9b76e54c0f1f8596c2442e3d48649109d138a2ea+source-set-sha256:089ba608972faaf107606da5950339a97655b8e5be163cadfd420855147509c1`（下方具名 source set，含 pre-existing uncommitted edits）。

執行環境與結果（同一個 Career 2.0 工作目錄）：

```text
Node: /Users/kao_oak/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
OpenSpec CLI: /usr/local/Cellar/node/26.0.0/lib/node_modules/@fission-ai/openspec/bin/openspec.js
status --change establish-m1-foundation --json: exit 0
  isPlanningComplete: true
  proposal/specs/design/tasks: done
validate --all --strict --no-interactive: exit 0
  spec/backup-and-restore: PASS
  spec/career-evidence: PASS
  change/establish-m1-foundation: PASS
  spec/interaction-and-interview-history: PASS
  spec/opportunity-workspace: PASS
  spec/private-local-storage: PASS
  spec/submitted-material-history: PASS
  Totals: 7 passed, 0 failed (7 items)
Direct tasks checkbox inspection: 0 complete / 10 total
```

## C2-V002 — Starter Kit adoption

- VALIDATION_ID: C2-V002
- SUBJECT: 四項 capability 的 static project-owned adoption。
- WHAT_WAS_CHECKED: HTML / Decision Log / Validation Summary 的本地連結與 anchors；9 筆 decision 的全部欄位及 RELATED_SOURCES；source-set hashes；五條 invariant；stale wording 分類；新增/修改檔案與 commit scope；OpenSpec / Engineering Memory 前後檔案 hashes；`git diff --check`；HTML bounded browser inspection。
- RESULT: PROVEN（本次 static adoption 的有界檢查）。
- PROVEN: 四項 capability 存在；138 個本地 link / anchor 檢查通過；9/9 decision records 與 4/4 validation records 欄位齊備；23 份 source hashes 一致；OpenSpec 與 Engineering Memory bytes 前後一致；沒有 Casebook / Interview Story placeholder；HTML 在兩個 viewport 無水平溢出。
- NOT_PROVEN: application runtime、product UI、外部網站可用性、OSS 版本最新性、使用者 30 秒理解目標、完整 accessibility certification、所有既有 Markdown/Mermaid 的視覺驗收。
- LIMITATIONS: 僅檢查本次三份新增 derived artifacts 與七份修改文件中的本地 source links；不以讀取 Git 狀態證明所有外部資料存在與否。Graph discovery 只有 Job-Ops index，沒有 Career 2.0 project/generation，故本次文件直接讀原檔；不借用舊專案 graph，不建立 index。驗證用臨時 scripts / 瀏覽器檢查不屬專案 runtime，不留 generator 或測試框架。
- EVIDENCE: 本文件的 check ledger、wording audit、source manifest；[Decision Log](DECISION_LOG.md)、[HTML dashboard](project-dashboard.html)、[Progress](../PROGRESS.md) 與本次限定 Git diff。Engineering Memory 只讀用來取得 global Starter Kit contract，未修改。
- DATE: 2026-09-13T03:27:52+08:00
- SOURCE_REVISION: `9b76e54c0f1f8596c2442e3d48649109d138a2ea+source-set-sha256:089ba608972faaf107606da5950339a97655b8e5be163cadfd420855147509c1`；新增 derived files 由本次 Starter Kit commit 記錄，不納入自己的 source hash，避免自我引用。

### Check ledger

2026-09-13，對本次 10 份檔案（3 新增、7 修改）執行；驗證暫存工具與截圖不納入 repo。

| Check | Result / bounded evidence |
| --- | --- |
| SOURCE_LINK_CHECK | PASS：138 個本地 path / anchor occurrences；包含 23 份來源 manifest links。27 個既有外部 URL 未重新連線，不宣稱外部可用性。 |
| AUTHORITY_CHECK | PASS：Dashboard/Log/Summary 均為 source-linked views；原 PLAN、Product Plan、Architecture、OSS、OpenSpec 與 Git 的 authority 保留；9 筆 decisions 逐項對照原來源。 |
| FRESHNESS_CHECK | PASS：23 個 source SHA-256 與具名 source-set ID 一致；三份 uncommitted OpenSpec edits 明示；HTML 與本 Summary 的 metadata 一致。 |
| CLAIM_BOUNDARY_CHECK | PASS：planning 與 runtime 分離；無產品 implementation / acceptance PASS；9/9 decision 與 4/4 validation contracts 齊備；five invariants 原意保留。 |
| RENDERED_HTML_CHECK | PASS：既有 Chrome、隔離 temporary profile、file URL；1365×1000 與 390×844 均無水平 overflow、page errors = 0、scripts = 0，history disclosure 可開關；已人工檢視兩張 full-page screenshots。僅此靜態文件，不是 product UI acceptance。 |
| BROWSER_LIMITATION | Playwright 預設 browser binary 不存在；既有 Chrome 在 restricted launch 中 SIGABRT，經核准的隔離 Chrome launch 完成檢查；沒有下載 browser 或新增 dependency。 |
| GIT_DIFF_CHECK | PASS：`git diff --check` 無輸出；parent 檢視全部 task-owned diff；獨立 reviewer 對 HTML、Decision Log 與 wording scope 無 actionable findings。 |
| OPENSPEC_PRESERVATION | PASS：12 份 OpenSpec 檔案 SHA-256 前後一致；tasks 仍 0/10。三份既有 dirty edits 不屬本次 stage/commit allowlist。 |
| ENGINEERING_MEMORY_PRESERVATION | PASS：134 份非 `.git` 檔案的 paths / SHA-256 與 Git status 前後一致；未寫 Engineering Memory。 |
| CASEBOOK_BOUNDARY | PASS：`docs/cases/`、Interview Story candidate files / directories 不存在；新增檔案僅 Dashboard、Decision Log、Validation Summary。 |

以上為執行結果摘要，不是永久保存的 browser trace 或完整 accessibility audit；本次新增產物的確切 bytes 由 Starter Kit commit 保存。

## C2-V003 — Foundation runtime

- VALIDATION_ID: C2-V003
- SUBJECT: `establish-m1-foundation` 的 offline application、private root、writer ownership 與 SQLite initialize/reopen。
- WHAT_WAS_CHECKED: 僅閱讀 change scope、design、delta spec 與 10 個未勾選 tasks；未執行任何 foundation implementation 或 probe。
- RESULT: NOT_YET_TESTED。
- PROVEN: 待驗證契約與 test expectations 已有文件；不代表功能存在。
- NOT_PROVEN: Electron/native SQLite ABI、offline startup、unsafe-root rejection、second-instance conflict、transaction failure、initialization/reopen、repository-private-data protection 的執行行為。
- LIMITATIONS: 沒有本案 runtime 可執行。Native ABI failure 目前是風險，未實際發生；不得因此建立 fake repair case。若後續 probe 真正失敗才另記 BLOCKED，完成修復與驗證後再判斷是否 ADD_CASE。
- EVIDENCE: [Foundation tasks](../openspec/changes/establish-m1-foundation/tasks.md)、[design / risks](../openspec/changes/establish-m1-foundation/design.md)、[T01 selection / gates](OSS_REUSE.md)。
- DATE: 2026-09-13T03:27:52+08:00
- SOURCE_REVISION: `9b76e54c0f1f8596c2442e3d48649109d138a2ea+source-set-sha256:089ba608972faaf107606da5950339a97655b8e5be163cadfd420855147509c1`。

## C2-V004 — Product behavior / acceptance

- VALIDATION_ID: C2-V004
- SUBJECT: M1-A–M1-H、M2 MVP-01–MVP-12、Evidence / submission immutability、backup/restore 與可見 workflow。
- WHAT_WAS_CHECKED: 只對照既有產品與架構規則及 roadmap；本次沒有實作或執行 product acceptance tests。
- RESULT: NOT_YET_TESTED。
- PROVEN: 驗收規則已被文件化，CV / Story 同源、Opportunity workflow 與 immutable history 有權威來源。
- NOT_PROVEN: Evidence revision 固定不變、實際送出快照不變、reopen 正確、deterministic backup/restore、keyboard/mobile/product UI、真實 JD 工作流程與市場需求。
- LIMITATIONS: Foundation change 本身不包含這些 product features；本次 Dashboard 的視覺檢查不能當成 application UI pass。PROGRESS 記載較早的文件 link / DAG 檢查，屬歷史報告，本次不冒充重新執行該整套驗證。
- EVIDENCE: [Delivery plan / acceptance](superpowers/plans/2026-09-11-career-2-product-delivery.md)、[CURRENT_ARCHITECTURE — T02 §9](architecture/CURRENT_ARCHITECTURE.md)、[Product Plan — P](PRODUCT_PLAN.md)、[Progress](../PROGRESS.md)。
- DATE: 2026-09-13T03:27:52+08:00
- SOURCE_REVISION: `9b76e54c0f1f8596c2442e3d48649109d138a2ea+source-set-sha256:089ba608972faaf107606da5950339a97655b8e5be163cadfd420855147509c1`。

## Project Mother / bootstrap wording audit

範圍：`PLAN.md`、`PROGRESS.md`、`docs/**/*.md`、`openspec/**/*.md` 與 `openspec/config.yaml` 中的 Project Mother / bootstrap / Engineering Memory 引用。以下列出原引用位置與本次處理；來源的歷史 commit 不重寫。

| 原引用位置 | 分類 | 處理 |
| --- | --- | --- |
| PLAN：NEXT、接續順序、下一步要求 Mother authority | STALE_ACTIVE_WORDING | 改成現行 independent Git → T02 → T01 → reviewed OpenSpec 順序 |
| PLAN：freeze 當時只完成規劃 | HISTORICAL_VALID | 保留 freeze 時點，區分後續進展 |
| PRODUCT_PLAN：Q 的 bootstrap 順序、下一步；末尾未標時點的 NEXT | STALE_ACTIVE_WORDING | Q 改現行流程；舊最終狀態標為 R1 freeze 歷史，保留原 NEXT 並明示已取代 |
| PRODUCT_PLAN：R1 當時的未建 repo / 未選型 / 授權界線 | HISTORICAL_VALID | 保留當時規劃 provenance；非現行 Git 或 T01 狀態 |
| OSS_REUSE：引言宣稱 Project Mother bootstrap 已完成 | STALE_ACTIVE_WORDING | 改為有 Git evidence 的 independent baseline / T02，移除無支持的 bootstrap 完成宣稱 |
| Delivery plan：T00 validation 的 bootstrap 順序、T02 input、DAG Mother 節點 | STALE_ACTIVE_WORDING | 依同文件 current baseline 更正，保留 task IDs、scope、checkbox 與 dependencies |
| Delivery plan：current baseline / workflow 的 optional Engineering Memory；末尾未 bootstrap/binding | CURRENT_AND_CORRECT | 保留；未發生 binding 是歷史與當前均成立，不是待完成工作 |
| PROGRESS：未 bootstrap/binding；OpenSpec 與 Engineering Memory 分工 | CURRENT_AND_CORRECT | 保留，不推論為必要前置條件 |
| Change Delivery Flow：Current bootstrap 未開始、Mother 節點、等批准才建 repo / 選型 | STALE_ACTIVE_WORDING | 同步已成立的 Git、T02、T01 與 OpenSpec planning 狀態，保留產品實作未開始 |
| Repository Responsibility Map：Current 無 Git repo、framework 未選定 | STALE_ACTIVE_WORDING | 改為有 independent baseline；連回 Current Architecture / T01，仍無產品程式 |
| CURRENT_ARCHITECTURE：Engineering Memory 無 dependency / optional reference | CURRENT_AND_CORRECT | 未修改 |
| OpenSpec config：optional reference、archive 不自動產生 lesson | CURRENT_AND_CORRECT | 未修改 |
| Active change proposal/design/tasks：application/persistence bootstrap、Engineering Memory 關係不變 | CURRENT_AND_CORRECT | bootstrap 指應用儲存初始化，不是 Project Mother；整個 change 未修改 |

## Source state

<a id="source-state"></a>

```text
LAST_REFRESHED = 2026-09-13T03:27:52+08:00
BASE_COMMIT = 9b76e54c0f1f8596c2442e3d48649109d138a2ea
SOURCE_REVISION = 9b76e54c0f1f8596c2442e3d48649109d138a2ea+source-set-sha256:089ba608972faaf107606da5950339a97655b8e5be163cadfd420855147509c1
FRESHNESS_STATUS = CURRENT
DASHBOARD_IS_SOURCE_OF_TRUTH = NO
ENGINEERING_MEMORY_SUGGESTS = TRUE
CAREER_2_DECIDES = TRUE
CAREER_2_PROJECT_AUTHORITY = CAREER_2
ENGINEERING_MEMORY = OPTIONAL_CROSS_PROJECT_REFERENCE
ENGINEERING_MEMORY_DEPENDENCY = NONE
```

CURRENT 僅表示 Dashboard 已核對此具名 source set。來源包括本次 authority wording corrections、PROGRESS adoption entry，以及 task 開始前已存在的三份 uncommitted OpenSpec edits：`design.md`、`specs/application-foundation/spec.md`、`tasks.md`。這些 OpenSpec bytes 會保留在 worktree，**不進本次 commit**；因此 BASE_COMMIT 單獨不足以還原此來源狀態，這是 freshness 的明示限制。

Manifest 包含 PLAN、PROGRESS、既有 docs Markdown 與 OpenSpec 文件；不包含三份新增 derived views、global Skills、Engineering Memory、`.git` 或 private data。Hash 演算法：逐檔 SHA-256；將 repo-relative paths 依字典序排序，每筆串接 `path + NUL + lowercase_sha256 + LF` 的 UTF-8 bytes，對整串再做 SHA-256，形成 source-set ID。下表可直接比對檔案 bytes。

手動刷新：先讀 authority / OpenSpec / Git，重新比較 manifest 的路徑集合與 hashes；相關 source 變動則標 STALE，無法比較標 UNKNOWN。更新摘要後寫新的 LAST_REFRESHED / SOURCE_REVISION，驗證通過才標 CURRENT。Commit 只變動 derived views 不會自動使 source set 過期；未來新增 relevant source 也必須納入重新檢查。沒有 generator、watcher 或背景同步。

| Source path | SHA-256 |
| --- | --- |
| [PLAN.md](../PLAN.md) | `a7e71242af0a6acda74eb91f43c31a965111367a94a5ed615e61d1ff1dbbec8e` |
| [PROGRESS.md](../PROGRESS.md) | `1f933d6d4ebd266310fa7515bd662c407890e9cb3d341636f19d96cbf96e88f8` |
| [docs/OSS_REUSE.md](OSS_REUSE.md) | `8c3d42d3489cb49fcd6e99480f3086537796cdef5e6474e92f9ba68f71da5eb9` |
| [docs/PRODUCT_PLAN.md](PRODUCT_PLAN.md) | `e82c3efa6dd5e6befaa28345a44853ad23e514c6c4e8d8fd87f81ab0ca3ed111` |
| [docs/architecture/CURRENT_ARCHITECTURE.md](architecture/CURRENT_ARCHITECTURE.md) | `e420c429ac27ac5533794ce988663629db96d50b57238e0753b7bd1e820d5a9d` |
| [docs/architecture/diagrams/authority-ownership-map.md](architecture/diagrams/authority-ownership-map.md) | `6c9377f43d4eac18352f29789ff5fbdeec6fc1e37505e306646a08bdd64cd554` |
| [docs/architecture/diagrams/change-delivery-flow.md](architecture/diagrams/change-delivery-flow.md) | `6bc91edecccb55970bb41bd2a7843a6882923f2f51a735b84fcb79928e126d3b` |
| [docs/architecture/diagrams/repository-responsibility-map.md](architecture/diagrams/repository-responsibility-map.md) | `e41c747f51300947de249f66d588eeced32eee6dd7f6d48ab3c0b627341c6951` |
| [docs/architecture/diagrams/runtime-data-flow-map.md](architecture/diagrams/runtime-data-flow-map.md) | `b5752d47e04b5fb0f837a9e8fb17dc87abc775b36100374bdff2d3df63899325` |
| [docs/architecture/diagrams/workspace-boundary-map.md](architecture/diagrams/workspace-boundary-map.md) | `3a63e23912ad835dbc9d8edb26d13e9e3e3ec7bdfbaf8866c326591d1535fe5b` |
| [docs/superpowers/plans/2026-09-11-career-2-product-delivery.md](superpowers/plans/2026-09-11-career-2-product-delivery.md) | `0b81c3c4f93e48c45e1275ccc90537448068f7200791bc011148c6bf796d71dd` |
| [openspec/changes/establish-m1-foundation/.openspec.yaml](../openspec/changes/establish-m1-foundation/.openspec.yaml) | `a4ed664eb8476e85e347872f52baefe664358318725d07ee4e28ea918d6fd9d4` |
| [openspec/changes/establish-m1-foundation/design.md](../openspec/changes/establish-m1-foundation/design.md) | `ee4fb3212c802e726ec0f00072fd377e5cfbad0693179af3381ab71bfa521692` |
| [openspec/changes/establish-m1-foundation/proposal.md](../openspec/changes/establish-m1-foundation/proposal.md) | `fc8d0502a1c45bd687fa8c6349f4a8229a73603f189df6c184ada2ad2b276568` |
| [openspec/changes/establish-m1-foundation/specs/application-foundation/spec.md](../openspec/changes/establish-m1-foundation/specs/application-foundation/spec.md) | `0609db1100f8e042dd95c6e11f70fffccb58fd8484a50965cdd629489299283d` |
| [openspec/changes/establish-m1-foundation/tasks.md](../openspec/changes/establish-m1-foundation/tasks.md) | `9be7c89d8031edc720d33fbfc3ace56370d272f46d0110ed83a8bc09cba227b3` |
| [openspec/config.yaml](../openspec/config.yaml) | `de0cee5c5823970cfad08206d4b4534e563c893555a6feb3fbaa96f3c025d45b` |
| [openspec/specs/backup-and-restore/spec.md](../openspec/specs/backup-and-restore/spec.md) | `cd7761d8e6daec0a14b026ddc360a933812a988f47b94f73f8d832406b997807` |
| [openspec/specs/career-evidence/spec.md](../openspec/specs/career-evidence/spec.md) | `c0a7fc6a1035d3668f9398280bd45e51e0bd7b3ee402c9ca1087c00d157ded8f` |
| [openspec/specs/interaction-and-interview-history/spec.md](../openspec/specs/interaction-and-interview-history/spec.md) | `aac9d3499aa1dfb68fe8ec28f84ea9d6b9e881f0b5c4a358be8212ff0ddc0091` |
| [openspec/specs/opportunity-workspace/spec.md](../openspec/specs/opportunity-workspace/spec.md) | `3997daac6b2868bd731fabd9a1e7a7c02ef86fe8ed86c90b0359db3be86050a0` |
| [openspec/specs/private-local-storage/spec.md](../openspec/specs/private-local-storage/spec.md) | `3e383b1d6595351a4ca45438291d5325157cd6538e4fc094ee22c8ddc121f4a6` |
| [openspec/specs/submitted-material-history/spec.md](../openspec/specs/submitted-material-history/spec.md) | `e65900ea6ea7532b0164e7d5a7acd73980436d4b0fe9dbf12f67ac7549338af9` |
