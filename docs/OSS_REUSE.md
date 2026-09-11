# 現成能力與 OSS 候選

查閱日期：2026-09-11。僅公開文件研究；沒有安裝、執行、複製程式或批准任何選型。頁面內容會變動，build 前需查核選用 release、授權檔及相依套件。

2026-09-12 scope freeze 註記：沿用本次參考研究，不重新擴張產品研究。正式 capability selection 排在 Project Mother bootstrap、Career 2.0 canonical repo 與 Phase 0 architecture 之後。T01 先選 M1 儲存/介面/檔案能力，AI/renderer 等 M2 需要時再完成選型，不能阻擋 M1。產品凍結不等於候選工具已批准。

## 1. 目前可確認的參考

| 候選 | 查得能力 | 本案建議 | 尚未證明 |
| --- | --- | --- | --- |
| [Career Ops](https://github.com/career-ops-hq/career-ops) | 原 santifer/career-ops 轉至此 repo；README 描述本機 CLI 職缺評估、CV、Story Bank、追蹤及面試流程，標示 MIT | ADAPT_CONCEPT：研究如何從資料選案例及組織評估。只借相關概念，不 fork 整套系統 | 引用精度、可拆用性、與本案不變條件相容、實際品質；使用者所指的同名參考是否就是此 repo |
| [Reactive Resume](https://github.com/reactive-resume/app) | 舊 amruthpillai/reactive-resume 轉至此 repo；MIT，可自架，README 列 PDF/JSON/DOCX 輸出與 JSON Resume 匯入 | REUSE_FROM_OSS 候選：模板與輸出；也可先把它當獨立輸出工具比較 | 能否以現有公開介面接入、模板能否獨立使用、中文斷頁、引用映射保留與維護成本 |
| [JSON Resume](https://jsonresume.org/schema) | 社群履歷資料格式，官方頁標示 MIT，涵蓋基本資料、工作、學歷等 | USE_DIRECTLY 候選：履歷交換格式。只用作輸出邊界，不當作完整 Career Evidence 主模型 | 本案 claim-level provenance 不由此格式完整承接；匯入/匯出保真需樣本驗證 |
| [resume-cli](https://github.com/jsonresume/resume-cli) | 原 repo 說明開發移至 jsonresume/jsonresume.org 的 packages/cli；含格式驗證與輸出介面 | REUSE_FROM_OSS 候選：配合現成 theme 與標準輸出；選型須查看新維護位置 | 不可把舊 repo 歷史用法當新版本已測；中文、PDF、runtime 支援需核查 |
| [SQLite](https://www.sqlite.org/whentouse.html) | 官方將本機應用資料儲存列為適用場景 | REUSE_FROM_OSS 候選：單人資料持久化，與普通私人附件目錄配合 | 本案尚未選定；備份/交易/所選環境需驗證 |
| [Tiptap](https://tiptap.dev/docs/editor/getting-started/overview) | 官方說明基於 ProseMirror 的可擴充 editor；開源核心 MIT，另有付費 extensions | REUSE_FROM_OSS 候選：僅在結構化文件編輯超出原生表單能力時使用 | 付費功能不可默認可用；不為版本快照而購建協作平台 |
| [Job Tracker](https://jobtracker.shunzz.com) | 本次讀取未取得可檢視的頁面內容 | DEFER：保留為使用者指定參考 | Insufficient evidence；不聲稱有看板、版本、AI 或其他功能，未做視覺評估 |

另有同名 Career Ops 專案，本文件只使用上表明列的候選，不混用名稱推論功能。舊本機 Job-Ops 本輪未讀取、未引用其架構或實作。

## 2. 每類能力的取用策略

分類含義：USE_DIRECTLY 是利用現成原生/標準能力；REUSE_FROM_OSS 是候選重用；ADAPT_CONCEPT 僅借設計概念；BUILD_DIFFERENTIATOR 是本案特有產品行為；DEFER 是本階段不需要。所有「建議採用」均待批准，不等於已安裝。

| 能力 | Classification | 第一選項 | 替代與比較重點 |
| --- | --- | --- | --- |
| JD 輸入 | USE_DIRECTLY | 貼文字、手動 URL | 自動擷取延後，無需本期 crawler |
| 基本表單、搜尋、filter、日期輸入 | USE_DIRECTLY | 選定框架後的原生/現成 controls | 不自製控件庫；比較鍵盤可用性與中文 |
| CV/筆記編輯 | USE_DIRECTLY | 結構化欄位或文字區 | 必要時 REUSE_FROM_OSS editor，避免先造文字處理器 |
| CV 交換格式 | USE_DIRECTLY | JSON Resume 候選 | 如模板工具原生格式更合適，需確認可退出與保留引用 |
| 排版與 PDF | REUSE_FROM_OSS | 現成單欄 ATS template + 成熟 renderer 候選 | 與 Reactive Resume 獨立輸出比較；原生 print 只在既有模板可用時評估，不自建排版引擎 |
| 資料持久化/查詢 | REUSE_FROM_OSS | SQLite 候選 | 與現成文件儲存比較；按交易、備份、歷史引用、維護負擔評估 |
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
| A. 小型自有工作區 + 現成儲存/輸出/AI 能力 | 容易以 Evidence、版本、下一步為核心；能控制操作流程 | 需要實作本案領域行為 | 推薦，需 T01 完整比較後批准 |
| B. 以既有完整 Career Ops 系統為基底 | 可利用現有求職功能 | 其資料、流程與 UX 是否合適尚未驗證，容易引入不在範圍的能力 | 保留比較，不推薦直接 fork |
| C. 先組合筆記/試算表 + 既有履歷工具 | 可用最少產品開發驗證日常需求 | 跨文件引用與歷史一致性多靠人工 | 可作流程驗證或輸出 fallback，非完整差異化 MVP 的替代驗收 |

這是產品架構取捨，不是固定 framework 決定；本次不實作任何方案。

## 4. 開工前的能力評估順序與證據

本輪完成初步項目：確認新目錄沒有既有應用；查官方 OSS 文件；盤點可用的原生/技能/工具類型；記錄比較標準。尚未完成套件實測、release audit 或安裝授權。

每個必要能力在 T01 依以下順序形成一張決策紀錄：

1. 既有專案能力：目前為空目錄，無可重用本案程式。
2. 成熟 GitHub OSS：用途、維護位置、版本、license、相依、已知限制。
3. 平台原生能力：檔案/輸入/列印是否已足夠。
4. Skills / Plugins / MCP：當前執行環境可用能力是否適合開發驗證，不能假定會隨產品交付。
5. CLI/API/標準介面：是否真的公開、可穩定使用、能保留本案資料。
6. 至少兩個可行選項或一個選項加不用此能力的 fallback，按本案樣本比較。
7. 明確推薦、額外服務需求、資料出機範圍、成本上限、替換方式及待測項目。
8. 使用者批准具體選型和必要實驗後，才安裝/建置/試跑；產品範圍批准不能取代此步。

候選的通過條件：完整資料可匯出、無須把私人資料放 repo、能使用現成介面、不引入禁止基礎設施、維護者/授權/版本可追溯、能通過本案失敗與真實樣本驗收。
