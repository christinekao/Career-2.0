# Workspace Boundary Map

Scope：本案工作位置與外部邊界。Current：M1 Foundation runtime 與 repo/private-root boundary 已建立並通過 acceptance；產品私人資料流程尚未建立。Proposed：產品私人資料及外部執行能力仍未建立。

```mermaid
flowchart LR
    U[使用者需求與確認] --> P[Career 2.0 規劃文件]
    R[公開 OSS 參考] -. 僅供比較 .-> P
    subgraph Future [Proposed]
        A[未來單一應用] -->|讀寫| D[repo 外私人資料與備份]
        A -->|最小必要輸入| X[批准的外部或本機 AI 能力]
        X -->|候選結果| A
    end
    P -. 批准後實作 .-> A
    O[舊 Job-Ops] -. 概念參考限定 .-> P
```

- Owner：使用者擁有資料與產品決策；coordinator 整理規劃與驗證。
- Source of truth：本輪需求；未來私人事實由使用者確認的版本化紀錄承接。
- Boundary / read-write：只有未來應用可寫私人主資料；AI 與 OSS 不直接寫入；本輪不讀舊案資料。
- Invariants：私人資料不進 repo；本案不繼承舊 repo；外部 AI 發送範圍需先批准。
- Open questions：私人根目錄、是否允許外部推論、所選執行能力，Insufficient evidence。
- Validation evidence：Foundation 使用 synthetic private root 並驗證 repo isolation；產品-domain data/workflow 尚未執行。圖內產品 Proposed 邊界不等同於 Foundation runtime 已驗收。
