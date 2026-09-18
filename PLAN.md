# Career 2.0 規劃入口

建立：2026-09-11；凍結：2026-09-12，R1。第一版先給本人使用；本案是 Career 2.0 全新產品，非舊 Job-Ops 改寫。

PRODUCT_DIRECTION = APPROVE_WITH_MINOR_ADJUSTMENTS（三項調整已寫回）

PLAN = APPROVED / FROZEN

IMPLEMENTATION = M1_FOUNDATION_HARDENING_COMPLETE_WITHIN_APPROVED_THREAT_MODEL; M1_OPPORTUNITY_EVIDENCE_SUBSTRATE_IMPLEMENTATION_COMPLETE

VALIDATION = PASS FOR M1 FOUNDATION HARDENING（Foundation tests 17 PASS / 1 SKIPPED / 0 FAIL；Darwin recovery-path 與 non-Darwin stale-claim crash/takeover regressions PASS；same-user path-swap 是明確的 M1 threat-model non-goal / future hardening；build、OpenSpec strict 與 fresh Electron H5 startup acceptance PASS；包含 automated evidence 與 human-observed visible window）

ACCEPTANCE_REVIEW = M1_FOUNDATION_PASS; M1_OPPORTUNITY_EVIDENCE_SUBSTRATE_PASS

M1_STATUS = FOUNDATION_ACCEPTED_AND_ARCHIVED; OPPORTUNITY_EVIDENCE_SUBSTRATE_ACCEPTED_AND_ARCHIVED

NEXT = M2_PLANNING_REPAIR

本檔為專案入口；下表列出產品、交付、技術與架構的權威來源。衍生導覽：[Project Dashboard](docs/project-dashboard.html)（只提供 navigation、status 與 source links，不取代 canonical authority）。

**產品核心：每個職缺都有一份可持續更新的求職檔案，幫你決定怎麼投、怎麼講、接下來做什麼。**

| 閱讀順序 | 文件 | 重點 |
| --- | --- | --- |
| 1 | [產品規劃](docs/PRODUCT_PLAN.md) | 定位、使用旅程、亮點、完整功能清單、資料規則、UX、MVP |
| 2 | [階段與任務](docs/superpowers/plans/2026-09-11-career-2-product-delivery.md) | 16 個核心任務、8 個後續任務、依賴圖、20 項驗收條件 |
| 3 | [OSS 候選比較](docs/OSS_REUSE.md) | 可重用能力、原始來源、三條路線、選型批准方式 |
| 4 | [架構現況與兩張 active 圖](docs/architecture/CURRENT_ARCHITECTURE.md) | 已觀察現況、Proposed 邊界、保留的空間邊界與權責 |

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

詳細語意及未知歷史材料處理以 [產品規劃第 0、L 節](docs/PRODUCT_PLAN.md) 為準。凍結產品核心與階段邊界；M1 T01 能力選型已完成，M2 AI/provider/renderer 等後續能力仍不在本次產品 freeze 內；後續產品範圍變更要記錄新決策。

交付節奏：M1 Foundation（Career Evidence + Opportunity）→ M1 Workspace → M2 Intelligence，兩階段合計才是完整 MVP；M3 及 Later 維持既定範圍。

已完成：產品及實施規劃、獨立 Git baseline、T02 架構契約、T01 M1 能力選型，以及依核准 threat model 完成的 M1 Foundation hardening。Static symlink/hard-link、Darwin recovery-path、stale-recovery concurrency 與 non-Darwin stale-claim crash/takeover tests 通過；same-user path-swap 仍未防護，明列為 M1 non-goal/future hardening，並保留為 skipped fixture，不宣稱已修復。Foundation suite 為 17 PASS / 1 SKIPPED / 0 FAIL。H5 fresh Electron startup acceptance 已有 automated app-layer evidence 與使用者實際觀察到的 visible window：fresh PID 79150 載入 Career 2.0 main entry、renderer、preload/IPC，synthetic private root 的 store READY version 1，完成 8 秒可見觀察並以 code 0 / signal null 結束。Read-only M1 acceptance review 已 PASS；`establish-m1-foundation` 已 sync 並 archive 至 `openspec/changes/archive/2026-09-16-establish-m1-foundation`。命名的 `m1-opportunity-evidence-substrate` 已完成最小 Opportunity/JD 與 Career Evidence/revision implementation、validation、read-only acceptance 與 archive，位於 `openspec/changes/archive/2026-09-18-m1-opportunity-evidence-substrate`；M2 planning repair 與 read-only planning review 尚待完成，M2 implementation 仍未開始。詳細狀態見 [PROGRESS.md](PROGRESS.md)。完整 M1 Workspace/product-domain features 與部署仍未開始；M2 model/provider 選型仍延後。

目前交付順序：Plan Freeze → Career 2.0 independent Git baseline → T02 Phase 0 architecture → T01 M1 capability selection → M1 Foundation implementation/hardening → real Electron startup acceptance → read-only M1 review → OpenSpec sync/archive → commit/push → named `m1-opportunity-evidence-substrate` implementation → read-only prerequisite acceptance → prerequisite OpenSpec archive/commit/push → M2 planning repair/read-only review → M1 Workspace/product vertical slices → M2 Intelligence。

2026-09-12 R1 freeze 當時只完成規劃；後續 Git、T02、T01 與 OpenSpec 進展見 [PROGRESS.md](PROGRESS.md)。Career 2.0 自行擁有產品、架構與交付權威；Engineering Memory 僅為 optional cross-project reference，不是 bootstrap 前置條件，沒有 runtime dependency。
