# 規劃進度

開始日期：2026-09-11；minor scope review 與 R1 freeze：2026-09-12。

## Current status — 2026-09-18

- M1 Foundation hardening implementation is complete within the user's approved threat model: pre-existing static symlink/hard-link confinement, Darwin recovery-path validation, stale-recovery concurrency, and non-Darwin stale-claim crash/takeover regressions pass. Active same-user .career2 replacement between path validation and the filesystem open syscall remains unmitigated, explicitly out of scope for M1, and retained as a skipped future-hardening fixture; it is not claimed fixed. Foundation tests are 17 PASS / 1 SKIPPED / 0 FAIL; build and OpenSpec strict pass. H5 PASS on 2026-09-16: fresh PID 79150 loaded the actual Career 2.0 main entry, created a BrowserWindow, reached ready-to-show with isVisible=true, isMinimized=false, isDestroyed=false, and 900x680 bounds, loaded the local renderer, exercised preload and the narrow getStatus IPC capability, initialized the synthetic private root and READY store version 1 with expected identity/root binding, held an 8-second visible observation window, and exited with code 0 / signal null after ownership reacquisition. The user observed the Career 2.0 window during that interval. No OS approval prompt was observed for the final run. Read-only M1 acceptance review PASS；OpenSpec sync/archive complete；M1 Foundation = ACCEPTED_AND_ARCHIVED.
- `m1-opportunity-evidence-substrate` 的最小 Opportunity/JD 與 Career Evidence/revision implementation 已完成；domain tests、foundation regression、migration ownership-loss rollback、degraded-foundation fallback、true cross-process restart/read-back、narrow IPC/preload boundary、schema-readiness 與 public error-boundary regressions、syntax、build、OpenSpec strict 與 diff check 通過，合計 36 PASS / 1 SKIPPED / 0 FAIL。新增的 direct Electron public-IPC error probe 亦通過 private-path、SQLite/config、stack redaction、unknown-code fallback、known classification 與 success cases；main error envelope 與 preload transport decoder 只保留安全 `{ code, message }`，不改變成功 payload。2026-09-17 fresh PID 54523 的 bounded Electron probe 亦通過：實際載入 main、visible 900x680 BrowserWindow、local renderer、preload identity/IPC、synthetic Opportunity/JD 與 Evidence/revision records、store metadata/root binding，完成 8 秒觀察並 code 0 clean exit、ownership reacquisition；本輪未改變其 startup path，因此沿用該已接受 H5 evidence。獨立 read-only prerequisite acceptance 已 PASS，change 已 archive 至 `openspec/changes/archive/2026-09-18-m1-opportunity-evidence-substrate/`；M2 planning 已通過 read-only acceptance，baseline close-out 完成，M2 implementation 尚未開始且 READY_TO_START_M2_IMPLEMENTATION = YES。本輪沒有改變 M1/M2 範圍或 dependency versions。

- 已確認：全新產品，第一版單人自用，平靜的 Opportunity 工作區，Job Discovery 延後。
- 已交付：產品定義、完整功能分期、概念模型/事實規則、OSS 候選、MVP backlog/依賴/驗收、五張 Mermaid 架構圖。
- 已確認現況：工作目錄起初為空；已建立獨立 Git repo，baseline commit 為 `74e05d0bdd20e55453b64504bd04d77bb408ed86`。目前已有 Foundation source/tests、最小 Opportunity/JD 與 Career Evidence/revision substrate、以及 Electron/React/Vite skeleton；完整 M1 product-domain workflows/schema 尚未實作或 accepted。
- 來源調查限制：Job Tracker 頁面未取得可檢視內容；Career Ops 使用明列候選，不能確定使用者指的是哪個同名專案。
- 2026-09-13 規劃快照：當時尚未執行產品依賴安裝/試跑、程式、schema、runtime、UI prototype、PDF 輸出或產品 acceptance tests。此快照不代表目前 Foundation 狀態；Engineering Memory 仍為 optional cross-project reference，沒有 runtime dependency。
- Scope review：Evidence 已移到 M1 foundation；Submitted Material 的內容/時間/職缺/來源/當時 Evidence 引用不可變；M1 Interaction 九項紀錄及非 CRM 邊界明列。
- Frozen：五條 product invariants；M1 四個可用頁籤；M2 intelligence；完整 MVP = M1 + M2。
- 規劃文件檢查（2026-09-13 snapshot）通過：本輪指定規劃文件的本地連結與 code fences 完整；16 個核心任務欄位齊備、依賴無循環；T04/T06 必須先有 T07 Evidence；Phase 0 在選型前；8 項 M1 + 12 項完整 MVP 驗收與五條 invariant 齊備。Mermaid 為文件原稿，未做瀏覽器渲染驗收；當時產品測試未執行。
- PLAN = APPROVED / FROZEN（R1）；T00、T01、T02 完成。M1 Foundation 與最小 Opportunity/Evidence substrate implementation、acceptance、OpenSpec sync/archive 已完成；目前狀態以本節與 active `m2-intelligence-vertical-slice` change 為準；M2 planning 已 accepted 並完成 baseline close-out，implementation 尚未開始，完整 M1 product-domain workflows 尚未實作。
- T02 已完成：M1 persistence、file/attachment、canonical/generated/derived/immutable、revision、submission、privacy、backup/restore、single-writer 與 validation contracts 已記錄在 CURRENT_ARCHITECTURE.md。
- T01 已完成：選定 SQLite + `better-sqlite3`、native filesystem/hash/test APIs、`fflate` ZIP container、Electron stable v44 line、React 19.3 + Vite 8.3；比較與選型 provenance 在 OSS_REUSE.md。T01 當時尚未安裝依賴；後續 `establish-m1-foundation` 已建立並封存 Foundation runtime evidence。
- Dependency gate：lockfile pin 與 ABI gate 於 2026-09-15 PASS；2026-09-16 曾有 Electron probe 在回報 ABI 結果前 SIGABRT，但後續 fresh PID 79150 的實際 H5 startup acceptance PASS，不能據此聲稱 ABI 不相容或改選 dependency。不得靜默替換版本。
- OpenSpec 已採用為 Career 2.0 project-local change workflow（CLI 1.9.0，Codex Skills-only）；`openspec/specs/` 是 approved target behavior baseline；foundation implementation、hardening、acceptance 與 close-out evidence 保留於 `openspec/changes/archive/2026-09-16-establish-m1-foundation/`；named substrate implementation、acceptance 與 close-out evidence 保留於 `openspec/changes/archive/2026-09-18-m1-opportunity-evidence-substrate/`，不代表完整產品-domain 功能已 accepted。
- PRE_OPENSPEC_BASELINE_HISTORY = T02 `6230a0832051a21d10cf439126b7fb67331c9c12` + T01 `a9412b155c21809cc84fdfd7616c84bf9932fe27`；未重建為 OpenSpec historical changes。
- 2026-09-13 milestone：完成 Starter Kit bounded adoption；current change detail 與 lifecycle 由 OpenSpec artifacts 承接，本檔不追蹤 task count。
- OpenSpec 與 Engineering Memory 分工：OpenSpec 問「現在要改 Career 2.0 什麼」；Engineering Memory 僅供跨專案可重用教訓參考，不自動互相同步。

## 2026-09-13 Starter Kit bounded INITIALIZE

- 文件角色完成收斂：PLAN.md 為 project overview；Decision Log 為 derived index；Validation Summary 僅保存 adoption snapshot；三者均不取代既有權威。
- CAREER_2_PROJECT_AUTHORITY = CAREER_2；ENGINEERING_MEMORY_SUGGESTS = TRUE；CAREER_2_DECIDES = TRUE；Engineering Memory 是 OPTIONAL_CROSS_PROJECT_REFERENCE，dependency = NONE。
- 完成舊入口、交付順序與圖中文字的清理；R1 freeze 歷史 provenance 保留並明示日期。
- 本次 adoption 保持 change scope 不變，未修改、apply、sync 或 archive OpenSpec artifacts；既有三份未提交的 change edits 保留。
- Casebook 與 Interview Story candidate layer 維持 ABSENT_BY_DESIGN，等有實際且經驗證的工程案例才使用 ADD_CASE。沒有新 runtime、generator、watcher、database 或同步設施。
- Adoption snapshot 的驗證邊界與來源版本已留存於 Validation Summary；後續 runtime/product validation 不在本檔維護。
