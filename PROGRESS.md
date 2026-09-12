# 規劃進度

開始日期：2026-09-11；minor scope review 與 R1 freeze：2026-09-12。

- 已確認：全新產品，第一版單人自用，平靜的 Opportunity 工作區，Job Discovery 延後。
- 已交付：產品定義、完整功能分期、概念模型/事實規則、OSS 候選、MVP backlog/依賴/驗收、五張 Mermaid 架構圖。
- 已確認現況：開始時工作目錄為空；目前沒有本案程式，已建立獨立 Git repo，baseline commit 為 `74e05d0bdd20e55453b64504bd04d77bb408ed86`。
- 來源調查限制：Job Tracker 頁面未取得可檢視內容；Career Ops 使用明列候選，不能確定使用者指的是哪個同名專案。
- 未執行：產品 OSS 依賴安裝/試跑、產品程式、schema、runtime、UI prototype、PDF 輸出、產品 acceptance tests；Engineering Memory 未 bootstrap 或 binding。
- Scope review：Evidence 已移到 M1 foundation；Submitted Material 的內容/時間/職缺/來源/當時 Evidence 引用不可變；M1 Interaction 九項紀錄及非 CRM 邊界明列。
- Frozen：五條 product invariants；M1 四個可用頁籤；M2 intelligence；完整 MVP = M1 + M2。
- 文件檢查通過：11 份 Markdown 的本地連結與 code fences 完整；16 個核心任務欄位齊備、依賴無循環；T04/T06 必須先有 T07 Evidence；Phase 0 在選型前；8 項 M1 + 12 項完整 MVP 驗收與五條 invariant 齊備。Mermaid 為文件原稿，未做瀏覽器渲染驗收；產品測試未執行。
- PLAN = APPROVED / FROZEN（R1）；T00、T01、T02 完成；其餘 implementation task 未執行。
- T02 已完成：M1 persistence、file/attachment、canonical/generated/derived/immutable、revision、submission、privacy、backup/restore、single-writer 與 validation contracts 已記錄在 CURRENT_ARCHITECTURE.md。
- T01 已完成：選定 SQLite + `better-sqlite3`、native filesystem/hash/test APIs、`fflate` ZIP container、Electron stable v44 line、React 19.3 + Vite 8.3；比較、current-source audit、依賴邊界與退出方式記錄在 OSS_REUSE.md。沒有安裝依賴或建立 implementation。
- T01 限制：exact lockfile pin、Electron native-addon compatibility probe、樣本試驗與實作 gate 尚未執行；失敗時必須停下重評，不可靜默替換。
- OpenSpec 已採用為 Career 2.0 project-local change workflow（CLI 1.9.0，Codex Skills-only）；`openspec/specs/` 是 approved target behavior baseline，不宣稱已實作。
- PRE_OPENSPEC_BASELINE_HISTORY = T02 `6230a0832051a21d10cf439126b7fb67331c9c12` + T01 `a9412b155c21809cc84fdfd7616c84bf9932fe27`；未重建為 OpenSpec historical changes。
- 第一個 change `establish-m1-foundation` 已完成 proposal、delta spec、design、tasks；CHANGE_STATUS = PROPOSED / PLANNING_READY；apply 尚未開始。
- OpenSpec 與 Engineering Memory 分工：OpenSpec 問「現在要改 Career 2.0 什麼」；Engineering Memory 僅供跨專案可重用教訓參考，不自動互相同步。
- NEXT = REVIEW_FIRST_OPENSPEC_CHANGE_BEFORE_APPLY。M1 implementation 尚未開始；不等待 M2 AI/renderer 能力選型。
- IMPLEMENTATION = NOT_STARTED。

## 2026-09-13 Starter Kit bounded INITIALIZE

- 專案入口：[Project Dashboard](docs/project-dashboard.html)，含 architecture derived view；[Decision Log](docs/DECISION_LOG.md) 索引既有決策；[Validation Summary](docs/VALIDATION_SUMMARY.md) 區分文件檢查與未測 runtime。三者均不取代既有權威。
- CAREER_2_PROJECT_AUTHORITY = CAREER_2；ENGINEERING_MEMORY_SUGGESTS = TRUE；CAREER_2_DECIDES = TRUE；Engineering Memory 是 OPTIONAL_CROSS_PROJECT_REFERENCE，dependency = NONE。
- 修正現行入口、交付順序與圖中的 Project Mother/bootstrap 舊措辭；R1 freeze 歷史 provenance 保留並明示日期。
- `establish-m1-foundation` planning artifacts 完整，tasks 為 0/10；本次不 apply、不改 scope、不完成 tasks、不 sync/archive。既有三份未提交的 change edits 保留。
- Casebook 與 Interview Story candidate layer 維持 ABSENT_BY_DESIGN，等有實際且經驗證的工程案例才使用 ADD_CASE。沒有新 runtime、generator、watcher、database 或同步設施。
- NEXT 維持 REVIEW_FIRST_OPENSPEC_CHANGE_BEFORE_APPLY；完整驗證邊界與本次來源版本見 Validation Summary。
