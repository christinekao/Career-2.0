# 架構現況與提案邊界

現況更新：2026-09-12，Plan Frozen R1。產品範圍已凍結；執行架構、bootstrap 與實作尚未開始。

## 已觀察現況

| 項目 | Evidence / Status |
| --- | --- |
| 本案工作位置 | /Users/kao_oak/Desktop/Kao_oaK/Career 2.0，由當前工作環境指定 |
| 初始目錄 | 2026-09-11 初次盤點為空；本次已有規劃文件，仍未建立本地 `.git` 或產品程式 |
| 最接近的適用文件 | 使用者貼入的 AGENTS 規則與 /Users/kao_oak/AGENTS.md；較近的父目錄沒有 AGENTS.md |
| 圖索引 | 本輪 list_projects 只列舊 Job-Ops 的另一工作區；沒有本案 index，generation = Insufficient evidence |
| 本案程式發現 | 無程式可查，未查詢/借用舊 repo graph，也未建立本案 index |
| 現有 runtime / local data | 本案目錄內不存在；外部是否已有相關資料為 Insufficient evidence，沒有廣泛掃描私人目錄 |
| 外部 repo / remote / release | 本案尚未建立，無需 worktree 正規化 |
| 本輪完成後 | 僅 Markdown 規劃文件；無產品程式、schema、安裝、runtime、prototype |

## 決策權與文件權威

最新使用者 scope review 為 R1 凍結依據：Career Evidence + Opportunity 同為 M1 foundation；其上是 M1 Workspace，再 M2 Intelligence；完整 MVP = M1 + M2。五條 frozen invariant 見 [產品規劃](../PRODUCT_PLAN.md)。附件是需求來源，OSS 文件只是參考。新案與 canonical repo 身份是 Career 2.0，不延伸舊 Job-Ops；正式對外品牌尚未決定。

交付順序：Plan Freeze → Project Mother bootstrap → Career 2.0 canonical repo → Phase 0 architecture → OSS capability selection → M1 vertical slice。現有圖是凍結產品規則與 Proposed 技術邊界的紀錄，不能當作 bootstrap 或 Phase 0 已完成的證據。

## 五張圖

全部採 Mermaid 文件圖；本輪只交付概念與關係，沒有可操作 UI，也沒有 HTML 視覺驗收。實線表示圖內的邏輯關係，不代表功能已上線；每張圖都有 Current / Proposed 與證據說明。

| 圖 | 目的 |
| --- | --- |
| [Workspace Boundary Map](diagrams/workspace-boundary-map.md) | 本案工作區、私人資料、參考資料與外部能力邊界 |
| [Repository Responsibility Map](diagrams/repository-responsibility-map.md) | 現在文件責任與未來單一應用的領域邊界 |
| [Authority and Ownership Map](diagrams/authority-ownership-map.md) | 人、事實、分析、送出版本的權威 |
| [Runtime and Data Flow Map](diagrams/runtime-data-flow-map.md) | 未來一份 JD 到同源文件及封存的流程 |
| [Change Delivery Flow](diagrams/change-delivery-flow.md) | 規劃、選型批准、垂直交付、驗收的順序 |

## KEEP / MOVE / DELETE

| Action | 對象 | 決定 |
| --- | --- | --- |
| KEEP | 本輪規劃文件 | 留在目前工作位置供審查 |
| KEEP | 使用者附件及舊 Job-Ops | 維持原位置；附件是需求來源，舊案不做修改或搬移 |
| MOVE | 既有本案 runtime/private data | 未發現，無可執行搬移；未來私人資料須在 repo 外 |
| DELETE | 任何既有檔案/ref/repo | 無；本輪不刪除任何內容 |

## Proposed 執行形式

一個單人應用擁有 canonical 寫入責任；以六個產品領域整理責任，不拆多服務。M1 Career Evidence 可手動建立/編輯/確認，與 Opportunity 共同支撐工作區；送出快照封存當時引用。M1 Interaction 限九項紀錄，不包含 CRM pipeline/scoring/campaign/automation。M2 AI 產生候選；domain rules 與人確認決定是否接納。公開研究與 recruiter 說法保留來源，不提高為無條件事實。

framework、儲存實作、API/CLI 執行方、檔案位置、成本與交期均未批准；目前不能畫成既成部署拓撲。架構圖不具備對未選工具的驗證效力。
