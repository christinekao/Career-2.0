# Change Delivery Flow

Scope：本案由規劃到可驗收產品的交付。Current：2026-09-12 Plan Frozen R1；bootstrap 與實作未開始。

```mermaid
flowchart TD
    P[Minor scope review 已寫回] --> U[Plan Approved / Frozen]
    U --> B[Project Mother bootstrap]
    B --> R[Career 2.0 canonical repo]
    R --> L[Phase 0 architecture]
    L --> C[M1 OSS capability selection]
    C --> A[使用者批准具體選型與實驗]
    A --> F[M1 Foundation：Evidence + Opportunity]
    F --> M1[M1 Workspace：版本 互動 下一步]
    M1 --> V1[M1 可視流程與還原驗收]
    V1 --> A2[M2 所需能力選型與批准]
    A2 --> M2[M2 四層策略與同源材料]
    M2 --> V2[一真實 JD 與第二 JD 重用驗收]
    V2 --> D[coordinator 查看產物與測試結果]
    D --> N[M3 公司情境與回顧]
```

- Owner：使用者批准產品及工具；coordinator 負責 scope、順序、衝突、最終驗證；任務完成回報不能代替驗收。
- Source of truth：本次 scope review、R1 frozen plan、後續選型證據與實際測試/產物。
- Boundary / read-write：本輪只寫規劃；批准後才建 repo/選用依賴/實作；push、部署、發訊息不由本圖自動授權。
- Invariants：M1 Evidence 不延後到 M2；快照含當時證據；Interaction 不變 CRM；M1 不冒充完整 MVP；BLOCKED 不算 PASS；五條產品 invariant 優先於工具選擇。
- Open questions：投入工時、日程、選型批准內容，Insufficient evidence。
- Validation evidence：實施計畫保留 16 個核心工作項目，更新為 20 項驗收場景；T00 範圍凍結，其餘未執行，無 implementation pass。
