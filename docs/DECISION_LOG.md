# Career 2.0 Decision Log

本檔是既有持久決策的檢索索引，不另立 ADR authority。決策內容與衝突處理仍由 RELATED_SOURCES 的 Career 2.0 文件負責；修改決策應先改權威來源，再刷新本索引。

索引建立：2026-09-13。DATE 是來源記錄日期，不假設每一條細則都有獨立批准時間。`FINALIZED_CONTRACT` / `SELECTED_NOT_IMPLEMENTED` / `ADOPTED_WORKFLOW` 區分契約、選型與已採用的文件流程，均不表示產品驗證通過。未見來源比較的項目明列「未記錄」，不補造 alternatives。

[Dashboard](project-dashboard.html) · [Validation Summary / 來源版本](VALIDATION_SUMMARY.md)

| DECISION_ID | 決策 | STATUS | 原權威 |
| --- | --- | --- | --- |
| [C2-D001](#c2-d001) | Local-first 私人儲存 | FINALIZED_CONTRACT | T02 |
| [C2-D002](#c2-d002) | Private root 在 Git 外 | FINALIZED_CONTRACT | T02 / private-local-storage |
| [C2-D003](#c2-d003) | 單一 canonical writer | FINALIZED_CONTRACT | T02 |
| [C2-D004](#c2-d004) | SQLite + better-sqlite3 | SELECTED_NOT_IMPLEMENTED | T01 |
| [C2-D005](#c2-d005) | Electron runtime | SELECTED_NOT_IMPLEMENTED | T01 |
| [C2-D006](#c2-d006) | Immutable Evidence revisions | FINALIZED_CONTRACT | R1 / T02 / career-evidence |
| [C2-D007](#c2-d007) | Immutable Submitted Material snapshots | FINALIZED_CONTRACT | R1 / T02 / submitted-material-history |
| [C2-D008](#c2-d008) | Project-local OpenSpec workflow | ADOPTED_WORKFLOW | Architecture / OpenSpec config |
| [C2-D009](#c2-d009) | Engineering Memory 可選且非權威 | DOCUMENTED_BOUNDARY | Architecture / delivery plan |

## C2-D001

- DECISION_ID: C2-D001
- DATE: 2026-09-12（T02）
- STATUS: FINALIZED_CONTRACT
- CONTEXT: M1 是單人、本人擁有資料的工作區。
- DECISION: 採 local-first private storage；核心工作不需要 network、cloud 或 server。
- WHY: 保存使用者資料與固定歷史，維持低操作負擔與可替換邊界。
- ALTERNATIVES_CONSIDERED: T02 將 cloud sync、multi-user、distributed database 延後；沒有記錄完整儲存部署方案評選。
- CONSEQUENCES: M1 必須可離線持久化；runtime replacement 需保留 state、private bytes、identities、revision references 與 backup manifest。
- RELATED_SOURCES: [CURRENT_ARCHITECTURE — T02 §§1、6、10、11](architecture/CURRENT_ARCHITECTURE.md)（commit `6230a0832051a21d10cf439126b7fb67331c9c12`）；[Private Local Storage spec](../openspec/specs/private-local-storage/spec.md)。

## C2-D002

- DECISION_ID: C2-D002
- DATE: 2026-09-12（T02）
- STATUS: FINALIZED_CONTRACT
- CONTEXT: Career records、來源、附件、產物與備份包含私人資料。
- DECISION: 使用 user-configured private root，位於 repository 外；不可將真實私人資料放入 Git。
- WHY: 分開 source code 與 user-owned data，避免 repo 成為隱性私人資料根目錄。
- ALTERNATIVES_CONSIDERED: T02 明確禁止 root failure 時 fallback 到 repository/browser storage 或 silent alternate root；不是另一次方案評選。
- CONSEQUENCES: 未設定、不可用或不安全時 fail closed；實際 root 路徑由使用者設定，文件不假定已存在。
- RELATED_SOURCES: [CURRENT_ARCHITECTURE — T02 §§2、6](architecture/CURRENT_ARCHITECTURE.md)；[Private Local Storage spec](../openspec/specs/private-local-storage/spec.md)。

## C2-D003

- DECISION_ID: C2-D003
- DATE: 2026-09-12（T02 / T01）
- STATUS: FINALIZED_CONTRACT
- CONTEXT: Canonical state 的競爭寫入或 stale edit 可能改寫較新的事實與歷史。
- DECISION: Career 2.0 local application 是唯一 canonical writer；T01 將責任落在 Electron main/application/domain，renderer 只透過 narrow preload/IPC 請求。
- WHY: 讓修訂、衝突與私人資料規則由一個 application owner 執行。
- ALTERNATIVES_CONSIDERED: T02 排除 server、scheduler、sync layer 與 multi-agent writer；未記錄完整並行架構評選。
- CONSEQUENCES: stale edits 必須拒絕或 reload/compare。Active change 的未提交 design/spec 進一步要求每個 root 的 second-instance conflict fail closed；不宣稱能阻止任意外部工具修改使用者檔案，ownership mechanism 尚待實作。
- RELATED_SOURCES: [CURRENT_ARCHITECTURE — T02 §8 / T01 boundary](architecture/CURRENT_ARCHITECTURE.md)；[Private Local Storage spec](../openspec/specs/private-local-storage/spec.md)；[active design — Application boundary](../openspec/changes/establish-m1-foundation/design.md)（working-tree planning，非已驗證行為）。

## C2-D004

- DECISION_ID: C2-D004
- DATE: 2026-09-12（T01）
- STATUS: SELECTED_NOT_IMPLEMENTED
- CONTEXT: M1 需要 transaction、relation、stable references 與 reopen 行為。
- DECISION: SQLite + `better-sqlite3`，位於可替換 persistence boundary 後方。
- WHY: T01 評估其 transaction 支援與成熟同步介面，接受 native-addon rebuild 成本。
- ALTERNATIVES_CONSIDERED: `node:sqlite` 在 T01 的 Node v24 文件快照屬 release-candidate，保留重評；file-only JSON/YAML 因自製交易、migration、關聯完整性成本而拒絕。
- CONSEQUENCES: exact package/lockfile 與 Electron ABI 需實測。Open/write/transaction/reopen probe 失敗就停下重評，不可靜默換 driver。此處不重查或宣稱套件版本為今日最新。
- RELATED_SOURCES: [OSS_REUSE — §§5.2–5.5、5.7](OSS_REUSE.md)（commit `a9412b155c21809cc84fdfd7616c84bf9932fe27`）；[CURRENT_ARCHITECTURE — T01 boundary](architecture/CURRENT_ARCHITECTURE.md)。

## C2-D005

- DECISION_ID: C2-D005
- DATE: 2026-09-12（T01）
- STATUS: SELECTED_NOT_IMPLEMENTED
- CONTEXT: 單一 desktop application 需直接管理 private root 與本地 SQLite。
- DECISION: Electron shell + React/Vite renderer；shell、renderer/build 與 domain semantics 分開。
- WHY: T01 接受較大 binary，以避免新增 Rust + JavaScript 雙語 build boundary；原生 private-root 操作符合 M1 需求。
- ALTERNATIVES_CONSIDERED: Tauri 的雙工具鏈；SwiftUI/AppKit 的 macOS lock-in；browser/PWA 的 storage permissions 與 private-root ownership 限制，見原比較。
- CONSEQUENCES: main process 擁有寫入，renderer 不直寫 DB/filesystem；Vite dev server 只是 build/dev concern，不是產品 network dependency。版本依原 T01 selection snapshot，installation、pin 與 compatibility 未驗證。
- RELATED_SOURCES: [OSS_REUSE — §§5.2–5.4、5.6–5.8](OSS_REUSE.md)；[CURRENT_ARCHITECTURE — T01 boundary](architecture/CURRENT_ARCHITECTURE.md)。

## C2-D006

- DECISION_ID: C2-D006
- DATE: 2026-09-12（R1 / T02）
- STATUS: FINALIZED_CONTRACT
- CONTEXT: 後續 Evidence 修訂不能使過去 CV / Story 的引用意義漂移。
- DECISION: Career Evidence 是 canonical truth；修改事實、來源、責任、metric 定義或確認狀態建立新 immutable revision，保留歷史引用的舊版本。
- WHY: CV 與 Interview Story 共用固定 Evidence revisions，能回查當時實際依據。
- ALTERNATIVES_CONSIDERED: 未記錄另一次 alternatives 評選；規則明確排除原地改寫 referenced revision 或 generated output 自動變成 Evidence。
- CONSEQUENCES: current pointer 可明確移動；generated/derived content 不能直接提升為 career truth。
- RELATED_SOURCES: [PRODUCT_PLAN — Frozen Product Invariants / L](PRODUCT_PLAN.md)；[CURRENT_ARCHITECTURE — T02 §§3–4](architecture/CURRENT_ARCHITECTURE.md)；[Career Evidence spec](../openspec/specs/career-evidence/spec.md)。

## C2-D007

- DECISION_ID: C2-D007
- DATE: 2026-09-12（R1 / T02）
- STATUS: FINALIZED_CONTRACT
- CONTEXT: 面試必須知道對方實際收到哪份材料，不能被 Working CV 或 Evidence 新版取代。
- DECISION: Submitted Material 是 immutable historical snapshot，保存 exact content/bytes、submitted_at、Opportunity、source、附件與當時 Evidence references；修正另建紀錄。
- WHY: 維持真實送出歷史與可追溯依據。
- ALTERNATIVES_CONSIDERED: 未記錄獨立評選；live path/latest pointer 或用新版 Evidence 補寫未知歷史引用皆被原契約排除。
- CONSEQUENCES: 缺少當時引用明列 missing/unknown；中斷不能報完整成功；重試不製造重複歷史。尚無執行證據。
- RELATED_SOURCES: [PRODUCT_PLAN — Frozen Product Invariants / L](PRODUCT_PLAN.md)；[CURRENT_ARCHITECTURE — T02 §5](architecture/CURRENT_ARCHITECTURE.md)；[Submitted Material History spec](../openspec/specs/submitted-material-history/spec.md)。

## C2-D008

- DECISION_ID: C2-D008
- DATE: 2026-09-12（OpenSpec adoption，commit `9b76e54c0f1f8596c2442e3d48649109d138a2ea`）
- STATUS: ADOPTED_WORKFLOW
- CONTEXT: T01/T02 後，需要將個別工程或行為變更分成可審查的範圍。
- DECISION: OpenSpec 是 project-local change workflow；baseline specs 表示 approved target behavior，T01/T02 保留 PRE_OPENSPEC_BASELINE_HISTORY。
- WHY: 每個 change 能獨立理解、實作、驗證與封存，原本產品、架構與 roadmap 權威仍保留。
- ALTERNATIVES_CONSIDERED: 未記錄工具比較；已明確排除將整個 M1 合成巨型 change，或每個 trivial maintenance 都強制開 change。
- CONSEQUENCES: planning complete 不等於 tasks complete；sync/archive 不自動產生 Engineering Memory lesson。
- RELATED_SOURCES: [CURRENT_ARCHITECTURE — 決策權與文件權威](architecture/CURRENT_ARCHITECTURE.md)；[Delivery plan — OpenSpec change workflow](superpowers/plans/2026-09-11-career-2-product-delivery.md)；[OpenSpec config](../openspec/config.yaml)。

## C2-D009

- DECISION_ID: C2-D009
- DATE: 2026-09-12（Architecture / OpenSpec adoption）；2026-09-13 索引確認
- STATUS: DOCUMENTED_BOUNDARY
- CONTEXT: 跨專案可重用教訓與當前產品決策需要分開。
- DECISION: Career 2.0 保有 project authority；Engineering Memory 是 OPTIONAL_CROSS_PROJECT_REFERENCE，沒有 runtime、binding 或自動同步依賴。
- WHY: 共用參考不能取代本案產品、架構、repository、lifecycle 或 validator。
- ALTERNATIVES_CONSIDERED: 未記錄正式比較；舊 Project Mother/bootstrap 文字不是現行批准的 dependency。
- CONSEQUENCES: ENGINEERING_MEMORY_SUGGESTS = TRUE；CAREER_2_DECIDES = TRUE。本次借用 global Starter Kit contract 的欄位，輸出留在本案；Dashboard 是可替換 derived view，Engineering Memory 未被修改。
- RELATED_SOURCES: [CURRENT_ARCHITECTURE — 決策權與文件權威](architecture/CURRENT_ARCHITECTURE.md)；[Delivery plan — 階段與退出標準](superpowers/plans/2026-09-11-career-2-product-delivery.md)；[OpenSpec config](../openspec/config.yaml)；[本次 adoption 進度](../PROGRESS.md)。
