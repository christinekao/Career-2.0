# Career 2.0 規劃入口

建立：2026-09-11；凍結：2026-09-12，R1。第一版先給本人使用；本案是 Career 2.0 全新產品，非舊 Job-Ops 改寫。

PRODUCT_DIRECTION = APPROVE_WITH_MINOR_ADJUSTMENTS（三項調整已寫回）

PLAN = APPROVED / FROZEN

IMPLEMENTATION = NOT_STARTED

NEXT = PROJECT MOTHER BOOTSTRAP

**產品核心：每個職缺都有一份可持續更新的求職檔案，幫你決定怎麼投、怎麼講、接下來做什麼。**

| 閱讀順序 | 文件 | 重點 |
| --- | --- | --- |
| 1 | [產品規劃](docs/PRODUCT_PLAN.md) | 定位、使用旅程、亮點、完整功能清單、資料規則、UX、MVP |
| 2 | [階段與任務](docs/superpowers/plans/2026-09-11-career-2-product-delivery.md) | 16 個核心任務、8 個後續任務、依賴圖、20 項驗收條件 |
| 3 | [OSS 候選比較](docs/OSS_REUSE.md) | 可重用能力、原始來源、三條路線、選型批准方式 |
| 4 | [架構現況與五張圖](docs/architecture/CURRENT_ARCHITECTURE.md) | 已觀察現況、Proposed 邊界、資料流、權責與交付 |

## R1 Scope Review

使用者於 2026-09-12 指示寫回三項調整後 freeze；本版已同步產品規劃、任務、驗收與架構圖，不重做產品研究。

1. **Career Evidence 提前至 M1 foundation。** 與 Opportunity 同時存在，可手動建立/編輯/確認並保存版本；T04 送出快照與 T06 M1 驗收均依賴 T07 Evidence。
2. **已送材料是不可變歷史快照。** 封存內容、submitted_at、opportunity、source、當時 Evidence references 與附件；面試指向對方實際看過的版本。歷史引用缺失明示未知，不能事後回填成當時事實。
3. **M1 Interaction 僅保留九項輕量紀錄。** who、when、channel、summary、recruiter feedback、important facts、concern、next step、follow-up；排除 lead scoring、contact pipeline、organization CRM、outreach campaign、automation。

M1 Opportunity 頁籤：Overview、Interactions、Application、Documents。Career 入口提供 Evidence 編輯。M2 隨功能可用逐步開啟 Match & Gaps、Positioning、CV、Interview；完整 M2 驗收時全部可用。

## Frozen Product Invariants

1. Career Evidence is canonical truth.
2. Generated CV / Story never becomes career truth automatically.
3. CV and Interview Story must derive from the same evidence.
4. Submitted application materials are immutable historical snapshots.
5. Opportunity is the center of the user workflow.

詳細語意及未知歷史材料處理以 [產品規劃第 0、L 節](docs/PRODUCT_PLAN.md) 為準。凍結產品核心與階段邊界，不固定 framework、database、model；後續產品範圍變更要記錄新決策。

交付節奏：M1 Foundation（Career Evidence + Opportunity）→ M1 Workspace → M2 Intelligence，兩階段合計才是完整 MVP；M3 及 Later 維持既定範圍。

已完成：產品及實施規劃、公開 OSS 文件調查、概念架構。未開始：產品程式、repo 初始化、相依安裝、schema、固定 framework/model/provider、部署。

接續順序：Plan Freeze → Project Mother bootstrap → Career 2.0 canonical repo → Phase 0 architecture → OSS capability selection → M1 vertical slice。

本輪只完成 freeze，bootstrap 未執行。下一步應依實際 Project Mother 權威入口進行；本文件不自製 bootstrap 命令。產品範圍已批准，候選工具仍需依後續能力選型流程處理。
