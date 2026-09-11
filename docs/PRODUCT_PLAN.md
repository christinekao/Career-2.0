# Career 2.0 產品規劃

建立日期：2026-09-11；凍結日期：2026-09-12。PLAN = APPROVED / FROZEN，基線 R1；IMPLEMENTATION = NOT_STARTED。

## 0. 決策與範圍

本案從零建立，不是舊 Job-Ops 改寫。Career 2.0 是工作名稱，尚未決定正式品牌。第一版使用者已確認為你本人。

| 項目 | 本次處理 |
| --- | --- |
| 需求來源 | 原四層規劃、LATEST PRODUCT DECISIONS、附件完整需求，以及 2026-09-12 minor scope review |
| 優先順序衝突 | 附件原本先做 AI 核心、之後追蹤；依本輪較新的三階段指示，改為先交付投遞版本與進度，再完成四層策略 |
| MVP 定義 | M1 是可先使用的基礎版；M1 + M2 才是完整差異化 MVP，不能以 tracker 完成宣稱整個 MVP 完成 |
| Foundation | Career Evidence 與 Opportunity 同屬 M1 foundation；Evidence 可建立、編輯、確認與保存版本，不等待 M2 AI |
| 送出快照 | content snapshot、submitted_at、opportunity、source 與當時 evidence references 一起封存，不隨 Working CV 或 Evidence 新版變動 |
| M1 Interaction | who、when、channel、summary、recruiter feedback、important facts、concern、next step、follow-up；不擴為 CRM |
| 第一版客群 | 單人、自用、已有真實經歷、正在針對數個職缺準備投遞或面試 |
| 設計假設 | 以桌面深度準備為主，手機查看進度及快速補記；繁中介面、可產出英文 CV，均待實際使用驗證 |
| 私人資料 | 與原始碼目錄分離；本次文件只有需求與假設案例 |
| 技術選擇 | 僅候選與比較；未固定 framework、model、provider、browser 或 agent 工具 |
| 授權界線 | 只做規劃文件；不建立 Git repo、不安裝、不建立程式 schema、不寫產品程式、不部署 |
| 發現職缺 | JOB_DISCOVERY = LATER；MVP = NOT A JOB SEARCH ENGINE |

本輪使用者對方向給予 APPROVE_WITH_MINOR_ADJUSTMENTS，並指示寫回三項調整後凍結。本文件已納入調整；凍結的是產品範圍、五條核心 invariant 與階段邊界。技術方案仍是 Proposed，未選工具不因 plan freeze 自動獲批准。後續產品範圍變更須記錄新決策，不靜默修改 R1 的意義。

### Frozen Product Invariants

1. **Career Evidence is canonical truth.** 職涯事實以使用者確認的 Evidence 及其版本為權威；保留自述、文件支持與未知的差別，不宣稱皆經外部驗證。
2. **Generated CV / Story never becomes career truth automatically.** 生成與人工改寫的材料均不能自動回寫成職涯事實。
3. **CV and Interview Story must derive from the same evidence.** 重要事實及責任範圍共用同一組固定 Evidence revisions。
4. **Submitted application materials are immutable historical snapshots.** 已送內容、時間、職缺、來源、附件及當時證據引用一起保留；修正另記，不覆寫歷史。
5. **Opportunity is the center of the user workflow.** 文件、對話、面試與下一步都接在同一個職缺工作區。

五條 invariant 優先於 framework、database、model 選擇；下方細則不得削弱它們。舊履歷或附件可作為「未驗證歷史材料」保存，但不能冒充系統生成且通過同源檢查的材料。

## A. 產品定義

**給正在求職的專業工作者，一個以職缺為單位的私人求職工作區：用真實經歷決定怎麼投、怎麼講、接下來做什麼，並保留每次實際送出與面試的完整脈絡。**

主要問題不是缺少文字，而是材料分散、每份履歷定位不一致、說法超出事實、事後不知道送了哪版，以及每次面試都從頭準備。

主要成果是「一份可用、可追溯、可繼續推進的求職檔案」。不承諾錄取機率，也不把產出字數或履歷數量當成功。

最值得客製的部分是：把同一組事實，轉成這個職缺最有說服力的定位、CV 和面試案例；清楚顯示哪些內容有支持，哪些仍需補證據。

## B. 核心旅程與第一印象

### 第一次使用

1. 貼一份 JD，填公司與職稱；來源 URL 可選，儲存當下文字快照。
2. 立即得到可保存的 Opportunity；可先附上既有 CV、記錄下一步，不要求先填完職涯資料。
3. M1 的 Career 入口即可手動建立、編輯並確認經歷與 Evidence，保留來源及版本；不要求填滿資料庫才能保存職缺或補記歷史投遞。
4. M2 才加入 JD 分析、CV 文字整理成候選證據及與高優先要求有關的 2–3 個澄清問題；重用 M1 已建立的事實。使用者可略過，保留未知。
5. 查看主要任務、優先要求、匹配與缺口，確認主定位。
6. 產出 CV 與 3–5 個主案例；經歷不足就少選並說明，不湊數。
7. 修正無依據或矛盾內容，檢查輸出，下載文件；實際投遞後手動記錄送出版本。
8. 面試前查看該輪重點與「當時送出的版本」；面試後記下實際問題及下一步。
9. 結果與回饋保存到此職缺；需要修改經歷時提出建議，由使用者確認。

### 日常重返

首頁是 Opportunities 工作清單，依下一步日期、即將面試、最近使用排序；保留搜尋、狀態篩選與明確的新增入口。未填日期的職缺仍可找到，不消失在列表外。

進入職缺後，第一屏回答三件事：這份工作在意什麼、我目前最有力的切入點、現在該完成哪一步。下一步是建議或使用者已排定的工作，兩者分開標示；系統不自行寄信或更改投遞狀態。

### 四個讓人眼睛一亮的時刻

| 時刻 | 使用者看見什麼 | 底層成立條件 |
| --- | --- | --- |
| 一眼看懂這個職缺 | 3 個關鍵需求、主要優勢、最需處理的缺口、1 個主要下一步 | 每項可展開 JD 原文或經歷依據；不足時顯示未知 |
| 點一句就知道能不能說 | 點 CV 句子，旁邊看到經歷原句、責任邊界、支援的要求 | 引用固定的證據版本，不只連到會變動的資料 |
| 面試準備自然接續履歷 | 顯示「你送出的 CV 這句話，可能引出這個追問」及可用案例 | 預測問題連到送出版本、要求與 concern，附不確定性 |
| 改一項事實，知道影響在哪 | 修正數字後列出受影響的草稿；已投版本仍保留當時內容 | 顯示需重檢，不悄悄更新所有文件，也不改寫歷史 |

示意案例，非使用者真實經歷：JD 要求獨立部署，但證據只記載維運支援。畫面呈現「獨立部署尚缺證據」，建議澄清本人負責範圍；預測追問是「設計由誰決定、你親自做了什麼」，而不是替使用者寫成主導整體部署。

## C. 最小產品領域

以下是同一產品內的責任邊界，不是微服務或獨立 repo。

| Domain | 責任與使用者價值 | 核心資料 | 依賴 |
| --- | --- | --- | --- |
| Career | 記一次真實經歷，重用到不同職缺 | CareerProfile、Experience、Evidence、Story | 無 |
| Opportunity | 保存職缺、來源與對方要求，維持同一求職脈絡 | Opportunity、JD revision、分析中的 Requirement / Concern | 原始 JD；Company 與互動內容可補充 |
| Strategy | 判斷匹配、選擇定位及最有力的案例 | Analysis revision、EvidenceMatch、Positioning revision | Career、Opportunity |
| Materials | 把確認的策略轉成一致文件，管理草稿與審查 | Material revision、CV、Interview Pack、Finding | Career、Strategy |
| Application | 管理實際投遞、互動、面試與下一步 | Contact、Interaction、Submission、InterviewEvent、ApplicationEvent、NextAction | Opportunity、已送 Material |
| Company Context | 保存研究與來源差異，轉成需要問清楚的問題 | CompanyResearch revision、來源註記、Discrepancy | Opportunity、公開資料、Interaction |

Feedback 是面試或互動紀錄中的明確回饋，Learning 是這些紀錄的衍生視圖。暫不另立 learning service。Quality 是所有產物共用的檢查流程，不是額外主導航。

## D. 完整功能清單

P0 = 完整 MVP 必要；P1 = 下一階段；P2 = 延後。MVP/M1 是投遞基礎版，MVP/M2 是四層策略完成點；Phase 2/M3 是回饋與情境深化。

| Domain | Feature | Priority | MVP / Phase 2 / Later | Dependency | Notes |
| --- | --- | --- | --- | --- | --- |
| Career | Profile：摘要、方向、目標角色、語言、學歷、證照、地點、工作偏好與適用的工作資格 | P0 | MVP/M1 基本身份；M2 完整偏好 | T07,T11 | M1 僅提供支持經歷識別的最小資料；完整 Profile 不前移為 M1 門檻；摘要不是事實來源，敏感偏好可不填 |
| Career | 現職、前職、公司、職稱、日期、專案的 Experience | P0 | MVP/M1 foundation | T07 | 時間與職稱一致性基準 |
| Career | Evidence：情境、問題、責任、行動、成果、數字、技能、技術、對象、複雜度、挑戰、決策、教訓 | P0 | MVP/M1 foundation | T07 | 可建立/編輯/確認；最少先填做了什麼、本人範圍、結果，其他漸進補充 |
| Career | 來源、驗證狀態、支持文件與引用、修訂歷史 | P0 | MVP/M1 foundation | T02,T07 | 使用者自述不等於外部查證；允許無機密附件 |
| Career | 既有 CV 文字整理成候選證據 | P0 | MVP/M2 | T07,T08 | 候選必須確認；複雜 PDF/OCR 匯入延後 |
| Career | Story Bank：情境/任務/行動/結果/反思、證明什麼、可回答問題、彈性 competency tags | P0 | MVP/M2 | T07,T12 | 重用 Evidence，挑戰程度、stakeholders 等不重抄成事實 |
| Opportunity | 貼 JD、招募訊息、轉介或公司頁文字，保存來源及發現日期 | P0 | MVP/M1 | T03 | 不自動抓 URL；單靠 URL 仍可建紀錄，分析須有文字 |
| Opportunity | 一職缺多 URL、公司/職稱/地點、聯絡人 | P0 | MVP/M1 | T03,T05 | URL 是附註，不是主鍵 |
| Opportunity | JD 快照、更新版本與過時提醒 | P0 | MVP/M1–M2 | T03,T09 | 人工貼新版本；不做背景監控 |
| Opportunity | Explicit requirements：必備/加分、年資、技術、商業、語言、學歷、證照、產業 | P0 | MVP/M2 | T09 | 區分 EXPLICIT_FROM_JD 與 INFERRED_FROM_JD |
| Opportunity | Employer priorities、ideal candidate persona、可能疑慮 | P0 | MVP/M2 | T09 | persona 與 concern 是附引用的分析，不假裝招聘內幕 |
| Strategy | Requirement ↔ Evidence、多筆依據、理由與來源 | P0 | MVP/M2 | T10 | 非關鍵字匹配 |
| Strategy | DIRECT、STRONG_ADJACENT、PARTIAL、NO_MATCH、INSUFFICIENT_EVIDENCE | P0 | MVP/M2 | T10 | NO_MATCH 不自動等於能力不足 |
| Strategy | 能力缺口、表達缺口、缺少證據分開 | P0 | MVP/M2 | T10 | 能力缺口須使用者確認或明確反證 |
| Strategy | Fit summary：優勢、高優先要求、弱點、缺證據、疑慮、面試風險 | P0 | MVP/M2 | T10 | 不設任意總分或錄取機率 |
| Strategy | 主定位、理由、支持案例、主題、強調/少強調、異議應對、用語與不可宣稱 | P0 | MVP/M2 | T11 | 一份目前確認定位；修訂不覆蓋歷史 |
| Materials | JD-specific CV：摘要、經歷/句子取捨、排序、重寫、刪減 | P0 | MVP/M2 | T11,T12 | 每職缺一個 CV 工作區，可有多版 |
| Materials | 重要 claim provenance、數字/職稱/日期/公司/技術/ownership 檢查 | P0 | MVP/M2 | T12,T13 | 重要事實都需固定證據引用；缺口不自動補成成就 |
| Materials | 覆蓋率說明、重複/弱句、清晰/影響/相關性/冗長/長度檢查 | P0 | MVP/M2 | T13 | 品質建議與事實錯誤分級 |
| Materials | 當前草稿、修訂歷史、版本比較 | P0 | MVP/M1–M2 | T04,T12 | M1 比對時間/檔案/備註；M2 比對文字與定位變化 |
| Materials | ATS-friendly PDF、可編輯文字輸出 | P0 | MVP/M2 | T14 | 重用既有 renderer/template；不保證所有 ATS |
| Materials | 面試 focus 與預測問題、原因及不確定性 | P0 | MVP/M2 | T09,T11,T12 | 依據可以是 JD、gap、concern、已送 claim |
| Materials | 3–5 主案例、對應要求、備用案例、缺故事/重複使用/過度相似提示 | P0 | MVP/M2 | T07,T12 | 經歷不足時可少於 3 個 |
| Materials | Story Pack：核心訊息、適配原因、STAR+Reflection、數字、強項/弱點/風險/澄清/不可誇大 | P0 | MVP/M2 | T12 | 非所有故事強制同模板 |
| Materials | 自我介紹、回答骨架、追問、弱點應對、反問問題 | P0 | MVP/M2 | T12 | 與同一定位、證據及實際投遞 CV 一致 |
| Materials | CV ↔ Story ↔ Evidence 矛盾檢查及受影響草稿提醒 | P0 | MVP/M2 | T13 | 不自動修改已送出版本 |
| Materials | Generate / Validate / Review / Finding / Repair / Recheck | P0 | MVP/M2 | T08,T13 | 基本循環即納 MVP；人工確認與有限重試 |
| Materials | 更強獨立語意 review 與評測樣本 | P1 | Phase 2/M3 | T13,T15 | 不重建舊審核框架 |
| Company | 人工保存研究筆記、來源、日期、待確認問題 | P0 | MVP/M1 | T05 | 先放 Overview / Interactions，不為此增加 M1 Company 頁籤 |
| Company | 公司簡介、產業、產品、規模、總部、市場、持有/上市資訊 | P1 | Phase 2/M3 | F01 | 每項有來源與有效日期；未知不填 |
| Company | 近期新聞、併購/重組/擴張/裁員/產品與招募變化 | P1 | Phase 2/M3 | F01 | 使用既有搜尋能力，不自建爬蟲 |
| Company | 員工/社群觀感、讚揚/抱怨、管理/WLB/remote/升遷/薪酬/穩定性 | P1 | Phase 2/M3 | F01 | FACT、PUBLIC_SENTIMENT、INFERENCE；日期、樣本限制、相反說法 |
| Company | 候選人回報的面試輪次、形式、技術/行為比重、題目主題、難度 | P1 | Phase 2/M3 | F01 | 社群回報不能當此職缺的已確認流程 |
| Company | 研究風險轉為 recruiter 反問 | P1 | Phase 2/M3 | F01,F02 | 問題能追到來源 |
| Application | Contact：姓名與可選公司/agency、角色、聯絡方式、備註 | P0 | MVP/M1 | T05 | 僅辨識 who，可關聯多職缺；不設獨立 contact pipeline 或 organization CRM |
| Application | Interaction：who、when、channel、summary、recruiter feedback、important facts、concern、next step、follow-up | P0 | MVP/M1 | T05 | 保留發言者與來源；沒有 lead scoring、outreach campaign 或 automation |
| Application | 互動中的職責/團隊/主管、WFH、地點、薪酬/bonus/福利、流程、簽證/搬遷、雙方顧慮 | P0 | MVP/M1 | T05 | 寫在 important facts / concern 筆記，不新增 CRM 結構化子系統 |
| Application | Recruiter 情報補充策略、公開資料衝突/VERIFY_LATER | P1 | Phase 2/M3 | F02 | 不靜默改成公司事實 |
| Application | 狀態、歷史、投遞日期/管道/轉介/URL/聯絡人、下一步/跟進日 | P0 | MVP/M1 | T03,T04 | 不綁死線性順序 |
| Application | 已送 CV/材料/附件/定位快照及當時 Evidence references，不覆寫送出版本 | P0 | MVP/M1 | T04,T07 | 封存 content、submitted_at、opportunity、source；缺失歷史附件或當時引用明示未知 |
| Application | 面試：輪次/時間/對象/角色、準備重點、實際題目、回答筆記、下一步 | P0 | MVP/M1 | T05 | 時區保存；預測與實際題目分開 |
| Application | 每輪已選案例/實際用案例、有效/薄弱回答、新資訊、unexpected topics、debrief | P1 | Phase 2/M3 | F03 | M2 已可選案例；M3 增強回顧與跨轮接續 |
| Application | 拒絕/下一輪/offer/撤回、明確回饋來源 | P0 | MVP/M1 | T04,T05 | 無回饋則原因未知 |
| Learning | 回饋提出經歷/故事修正建議、使用者確認 | P1 | Phase 2/M3 | F03 | 不從结果推斷事實 |
| Learning | 跨職缺觀察定位/案例/能力缺口/問題模式 | P2 | Later | L01 | 顯示分母、期間、缺資料、樣本限制；無因果宣稱 |
| Materials | Cover letter、30/60 秒 recruiter pitch、LinkedIn/outreach、申請問答 | P2 | Later | L02 | 同一定位/證據；M2 自我介紹已涵蓋基本口述準備 |
| Decision | fit、興趣、薪酬/福利、工時/地點、成長、團隊信號、風險及進度比較 | P2 | Later | L03 | APPLY/CONTINUE/PRIORITIZE/HOLD/WITHDRAW 由人決定 |
| Discovery | source quality、remote/hybrid/onsite、Taiwan/APAC eligibility、時區/區域限制 | P2 | Later | L04 | 本期地點/來源仍能手動記錄；進階來源管理延後 |
| Discovery | 多來源去重偵測、來源管理、JustRemote/Remotive/Dynamite Jobs/CareerVault/LinkedIn/公司頁 | P2 | Later | L04 | 只是未來參考來源，現在不建 crawler/scraper/aggregator/integration |

## E. 簡化與差異化

1. CareerProfile 是偏好與基本背景，不能把個人摘要當工作成果的證據。
2. Experience 是工作或專案脈絡，Evidence 是可引用的事實單位；Story 是這些事實的講述方法，不再存一份新的真相。
3. Requirements、Employer priorities、persona、concerns 合併在 Job Analysis 版本內；無須為每個分析段落建獨立 subsystem。
4. Fit Summary 是匹配結果的衍生摘要，不另存可分歧的「fit truth」。Concern 不一定是技能 gap，例如職稱落差可能只是溝通疑慮。
5. 每職缺共用一份確認定位；CV、口述與面試內容不得各自創造新身份。
6. Application 是同一個 Opportunity 的歷程，不再另建 Jobs/Applications 兩套職缺資料。
7. 先用「待評估、準備中、已投遞、面試中、Offer、已結束」六個狀態；暫停作獨立標記，結束結果區分 rejected/withdrawn/closed/accepted。Recruiter screen 與 final interview 用事件/輪次表達。允許被動邀約直接進面試，也允許重開並保留事件。
8. Ready to apply 是文件檢查與人的決定，不是另一個必經流程關卡。

**真正值得做的 4 個差異化能力：**可重用的可信經歷；有理由的要求匹配與定位；履歷和面試共用案例且一致；以實際送出版本為基準的準備與追溯。單純儲存 Evidence 或產生 STAR，單獨都不足以構成差異化。

## F. OSS 與商品化能力

候選、分類、來源及驗證條件見 [OSS_REUSE.md](OSS_REUSE.md)。本次只做公開文件調查，沒有安裝、試跑或承諾可直接整合。

原則：通用的儲存、編輯、輸出、檔案與 AI 呼叫能力優先使用現成工具。僅客製求職資料之間的產品規則、可追溯關聯及工作區體驗。不藉 replaceability 名義建立 provider adapters 或自製 routing framework。

## G. MVP 與階段定義

### M1 Foundation：Career Evidence + Opportunity

T07 與 T03 共同建立最小 foundation：可手動建立/編輯/確認的 Career Evidence、固定事實版本，以及可保存 JD 與來源的 Opportunity。T04 的送出快照和 T06 的 M1 驗收都依賴 T07。此層不依賴 AI、Match、Positioning 或 Story 生成。

### M1 Workspace：可先使用的投遞管理

在上述 foundation 上，提供 JD 快照、多 URL、搜尋/篩選、Documents 附件與工作版本、已送版本鎖定、當時定位及證據引用、輕量互動、面試基本紀錄、下一步、狀態/結果、備份還原。可完全不使用 AI。驗收除了「投給誰、投了什麼、接下來做什麼」，也必須包含 Evidence 建立/編輯與歷史引用保留。

### M2：完整差異化 MVP

重用 M1 Career Evidence，加入四層策略、版本化定位、CV、Story Bank/主案例與 Interview Pack、引用/矛盾檢查、基本 review/repair/recheck、ATS-friendly PDF 與文字輸出。包含可回復的 AI 失敗處理。以一份真實 JD 驗收，再用第二份 JD 檢查經歷重用。

MVP 不需要自動公司研究、外部訊息同步、通知服務、多使用者、付費帳務、跨裝置同步、向量資料庫或背景批次 agent。下一步提醒先在 app 內顯示，關閉 app 不承諾推播。

## H. 一條完整垂直切片

| 層次 | 具體內容 |
| --- | --- |
| Input | 一份真實 JD、至少 3 筆可用經歷、現有 CV 或空白草稿；真實資料只進私人資料區 |
| Processing | 提取明示與推論要求；對上固定 Evidence revision；區分缺口；使用者確認定位；選案例；生成兩類文件 |
| Persisted state | JD/經歷/定位/文件版本，引用關聯，檢查結果，實際送出快照，下一步 |
| UI | Overview 看重點；Match & Gaps 看依據；Positioning 選方向；CV/Interview 編修；Application 鎖定與回顧 |
| Validation | 所有重要事實有引用；數字/職稱/日期/技術/責任一致；不足不補寫；失敗保留前版 |
| Output | 1 份可下載 CV、3–5 主案例或明示不足、面試準備包、投遞紀錄與下一步 |

切片必須從畫面輸入到重啟後查回成立，不能只以 prompt 範例或單段 API 回傳當完成。

## I. Phase 2 / M3

公司研究及 attributed sources；互動情報 refinement 與衝突確認；結構化 debrief；經歷更新建議；更強的語意 review。每項都回到「下次談話要驗證什麼、哪個材料需要修」，不堆出百科頁。

## J. Later

跨職缺回饋分析、額外投遞材料、機會比較、Job Discovery / Source Management。先累積可用資料再評估必要性；不因有結果就宣稱某個案例導致 offer。多人、教練協作、cloud sync 均需另立產品決策，未預先設計平台化架構。

## K. 概念資料模型

這是名詞與關係規劃，不是已建立的 database schema。版本是需要保存的產品語意，實體如何落表留待批准後選型。

| 概念 | 必要關係與界線 |
| --- | --- |
| CareerProfile | 一個使用者的偏好/背景；專業摘要可衍生，但具體成就須引用 Evidence |
| Experience / Evidence | 一段工作或專案含多筆事實；每筆事實保存來源、本人責任、數字定義、確認狀態與 revision |
| Story | 引用一或多個 Evidence revision；保存敘事、用途、彈性 tags；編修敘事不改事實 |
| Opportunity | 公司/角色/地點、來源 URL 集、JD revisions、狀態與歷程的共同主體 |
| Analysis revision | 屬於 Opportunity；Requirements 有穩定引用、明示/推論標籤；內含 priorities/persona/concerns、matches；摘要衍生 |
| EvidenceMatch | requirement 與 evidence revisions 的多對多關聯；有分類、理由、未解釋部分 |
| Positioning revision | 指向分析與經歷版本；保存主張、主題、取捨與使用者確認狀態 |
| Material revision | 區分 CV 與 Interview Pack；保存內容、語言、依據版本、claim 引用、產生與確認狀態 |
| Submission / Submitted Material | 某次送出的 content snapshot、submitted_at、opportunity、source、evidence references at that time；連同收件對象、material revision、定位與附件副本封存；多次送出各自獨立 |
| Contact / Interaction | Contact 只辨識 who，可連多職缺；Interaction 固定九項輕量資訊，不包含 contact pipeline、lead scoring、organization CRM、campaign 或 automation |
| InterviewEvent | 屬於職缺；輪次/時間/對象、準備材料、實際題目、回答與來源明確的回饋 |
| ApplicationEvent / NextAction | 事件保留狀態變更和結果；下一步為具體行動，可完成/改期/取消 |
| CompanyResearch revision | Phase 2；每項陳述引用來源/日期/類型；Discrepancy 是未解差異，不是一個合併事實 |
| Finding | 指向特定產物 revision 和片段、類型/嚴重度/依據/狀態；repair 後須重檢新版本 |

不另建 CvTarget（Opportunity 已承接）、CandidatePersona database、EmployerPriority service、InterviewStorySelection service 或 Feedback warehouse。

## L. Canonical state 與硬性不變條件

第 0 節的五條 Frozen Product Invariants 為本節上位規則。

**Working 與 Submitted 分開：**Working CV 可繼續編輯；Submitted CV v3 是那次送出的內容及來源快照。面試事件應能指定實際送出紀錄，顯示例如「Microsoft recruiter 看到的是 CV v3」；有多次送出而未選定時，標示待確認，不自動改指向最新 CV。

封存 Evidence references 時，保留當時的引用清單、固定 revision 及可還原的引用內容，不只保存會改變的 latest 指標。缺乏當時引用的舊材料保留 missing / unknown；事後查到的證據只能以另筆補充註記關聯，不能改寫送出快照或假裝當時已驗證。

| 資料 | Canonical / Generated / Derived | 可編修與確認規則 |
| --- | --- | --- |
| CareerProfile | 使用者確認的基本資料/偏好；摘要可 generated | 本人可改；具體職涯 claim 不因此自動獲證明 |
| Experience / Evidence | 使用者確認的經歷紀錄；自述/有文件支持/有爭議分開 | AI 提議不直接入 canonical；修正建立新 revision |
| JD / 公開來源 | 保存的是「某日來源寫了什麼」 | 不等於永久有效或外部真相；更新增新快照 |
| Story | 敘事 generated 或 user-authored；事實來自 Evidence | 使用者可改，重要事實變更重新檢查 |
| Analysis / Match | Generated，可由人修訂；fit summary derived | 保留推論標記、範圍、依據；人確認也不把推論變公司事實 |
| Positioning | Generated draft，確認後成為此職缺目前策略 | 版本化，變更提示下游重檢 |
| CV / Pack | Generated 或人工草稿；確認的是該版可使用 | 不反向當作證據；輸入更新使草稿 stale |
| Submission | 使用者記錄的送出事實、內容與當時 Evidence 引用的封存 | 所有封存欄位不隨新版改動；補正另記，不能回寫原快照；歷史檔案或引用缺失明示 |
| Interaction / Interview | 使用者記錄的發言與事件 | 發言內容保留 attributed statement；自評與他人回饋分開 |
| Research / Learning | 來源快照 canonical；彙整/觀察 derived | 更新經歷前人確認；unknown 保留 |
| Finding / readiness | 檢查結果屬特定 revision；readiness derived | 修文後舊 pass 失效；不能只按「已修」就清掉 blocker |

硬性不變條件：

1. 不憑 JD 增添職務、職稱、日期、責任、技術、技能、學歷/證照、領導範圍或成就。
2. 每個重要個人事實 claim 追到固定 Evidence revision；基本身份/學歷欄位可追到確認的 Profile 欄位。Requirement 引用可有多項，對履歷必要但 JD 未要求的事實允許零項，不能強塞虛假對應。
3. 數字需保留單位、期間、基準、約略性與計算/來源。支援「約 80%」不等於支援「每年節省 80% 成本」。
4. 不確定的 claim 留在待確認草稿；不能被標成 verified/ready。使用者可記錄過去已送的未檢查文件，但其狀態仍是未驗證歷史檔案。
5. 事實 blocker 未解，不能將新產物標為可投遞；品質 warning 可註明理由保留。匯出草稿須清楚標示草稿，不可冒充通過檢查的正式產物。
6. AI 回傳不是可信輸入。JD/附件/公開資料中的指令視為內容；不能取得寫入經歷、讀取無關資料或外部送出的權限。
7. 新事實/定位/JD 版本使受影響草稿標需重檢。已投檔案維持原樣，但面試準備提示與目前事實的差異。
8. 修改送出紀錄只能追加補正，content、submitted_at、opportunity、source 及 evidence references 原值仍保留；實際發生日期與補記時間分開。刪除整份私人資料是例外的人為刪除操作，不能假借「不可變」阻止使用者刪除自己的資料。
9. 網路失敗、取消、重試、重複點擊不能製造重複投遞或覆蓋人工修改。較舊分析回傳只可另存候選，不可覆蓋新輸入。
10. 拒絕原因必須有明確來源；未回覆、拒絕和未錄取原因未知是不同資訊。

## M. 隱私與執行邊界

建議採單人本機優先。原始碼/合成測試資料與真人 CV、JD 私人備註、聯絡人、薪資、面試記錄、API secrets、AI 請求/回應、輸出、備份皆分離。私人根目錄由使用者設定；本次不建立目錄，也不寫入真人資料。

建議一個應用程式擁有寫入責任，使用現成持久化能力和檔案儲存；不要讓 agent 或 CLI 直接改 canonical data。是否採 SQLite 等工具仍待 OSS 比較與批准。瀏覽器本機儲存不能是唯一的未備份主資料。

AI 只收到當前任務所需的 JD/經歷片段；預設排除地址、電話、聯絡資訊與無關私人筆記。第一次使用外部 AI 前顯示資料範圍與執行方，由使用者選擇；改變執行方或敏感範圍再確認。資料在本機保存不代表推論不會出機器。provider 保留/訓練政策尚未選定，Insufficient evidence。

M1 不需 AI 可用；M2 可透過批准的既有 CLI/API 能力執行。備份包含引用版本與原檔，還原必須驗證完整性。日志不記私人全文；退出 app 後仍可用文件管理器取得匯出檔。MVP 不公開分享、不自動發郵件、不把 CV 上傳公用 registry。

## N. 主要風險與緩解

| 風險 | 緩解與可驗證行為 |
| --- | --- |
| AI 虛構或誇大 claim | 來源引用、數字與 responsibility 檢查、人確認；注入無依據句子必須阻擋 ready |
| 證據弱、建立資料太累 | 先用 3 筆經歷跑一職缺；最多一小組澄清問題，可略過；保留缺證據 |
| False-positive match | 對應行為/責任/規模，說明差異；同技術名稱不能直接判 DIRECT |
| Generic positioning | 每個主題需支持案例及 JD 理由；第二 JD 必須重評，不能只替換公司名稱 |
| 故事重複或為了湊數 | 顯示案例覆蓋與重用情況；允許少於 3 個並呈現缺口 |
| 公司觀感不準 | 來源類型、日期、樣本限制、相反觀點；用待確認問題表達 |
| JD 過時 | 原文/取得日期及手動新版本；不宣稱職缺仍在招募 |
| Recruiter 說法被當事實 | 保存發言者及 interaction；與公開資料差異並列 |
| 技術過度設計 | 單一應用、現成能力、每個工具需比較與退出方式；不建禁止項目 |
| 工作流程太多 | 不要求走完全部頁籤；按下一步續作、可從已投/面試中開始 |
| 版本漂移 | 固定 Evidence/JD/Positioning 版本，旧 pass 失效，sent snapshot 保留 |
| 手改破壞 provenance | claim 改動後關聯需重檢，不能只保留舊引用冒充通過 |
| AI 失敗/昂貴 | 局部重新產生、取消與預算上限；不自動無限 repair；原稿可用 |
| 小樣本錯誤歸因 | 只記觀察及明確回饋，展示分母與缺失，不宣稱原因或勝率 |
| 私人資料洩漏 | repo 外保存、最小發送、合成 fixtures、備份與匯出可控 |

## O. 工作區體驗規格

主導航只有 Opportunities、Career。Applications 是 Opportunities 的可篩選視圖，不另造一套工作台。全域不以聊天框或 KPI 看板做首頁。

| Opportunity 頁籤 | 主要工作與資訊 |
| --- | --- |
| Overview | 公司/職稱、狀態、下一步、近期面試、已送版本；M2 加需求/定位/缺口摘要 |
| Company | M3 呈現研究摘要、來源與待確認問題；M1 原始筆記先在 Overview / Interactions |
| Match & Gaps | JD 原文/要求與證據對照，明示/推論、缺口類型和理由 |
| Positioning | 一句主定位、支持案例、強調/少強調/不可宣稱、確認目前版本 |
| CV | 可編輯文件、版本選擇、相鄰證據詳情、品質問題與匯出 |
| Interview | 依下一輪顯示準備包、自我介紹、主/備案例、追問、反問 |
| Interactions | 聯絡人、發言者、日期、談話與待確認問題 |
| Application | 送出版本、附件、狀態/時間線、面試與結果、下一步 |

M1 Opportunity 先提供 **Overview、Interactions、Application、Documents** 四個可用頁籤；面試基本紀錄放 Application，Career Evidence 的建立/編輯從全域 Career 入口進入。Documents 放工作版本、已送版本與附件，沒有生成能力也可用。

M2 隨可用能力逐步開啟 Match & Gaps、Positioning、CV、Interview；完整 M2 驗收時四者皆可用。Documents 仍作材料與附件入口，CV 連到同一份材料版本，不另造副本。Company 在 M3 研究能力可用時開啟。Job Analysis 放在 Match & Gaps，不另加 Requirements 頁籤。

M1 Interaction 固定為九項輕量紀錄：who、when、channel、summary、recruiter feedback、important facts、concern、next step、follow-up。明確排除 lead scoring、contact pipeline、organization CRM、outreach campaign 與 automation；一個 recruiter 可關聯多職缺不代表需要 CRM。

視覺方向是平靜、有品質的工作區：中性白/灰、清楚深色文字，少量綠色表示已確認、琥珀色表示待釐清，搭配連結色；不靠滿頁同色漸層。左側窄導航、中間主要文件、需要時才開證據詳情。公司與職位是第一屏清楚的標題，無 marketing hero、裝飾性圖表或卡片套卡片。

CV 內容與真實文件預覽是主要視覺資產，不使用無關 stock photo。狀態不只靠顏色；工具使用熟悉 icon 加 tooltip，版本用選單、內容分頁用 tabs，數值用輸入。桌面保留閱讀寬度，手機把詳情移到獨立面板，不壓縮成無法閱讀的三欄。

狀態必須完整：未儲存/儲存失敗、空資料、缺證據、AI 處理中/取消/失敗、舊分析、附件不存在、草稿與已投版差異、無明確回饋。切換頁籤保留編輯內容、滾動位置及已選職缺；未保存失敗時不能假裝成功離開。

## P. 可用性與產品驗證

以下是待測目標，不是已測成果，也不是 UI KPI：

| 場景 | 初始目標 | 量測 |
| --- | --- | --- |
| 首次建立職缺 | 2 分鐘內保存 JD 與下一步，無需完成 Career Profile | 一次主持測試，記完成時間與卡點 |
| 重返工作 | 30 秒內回答對象、已送版本、下一步 | 跨日開啟真實測試職缺 |
| Claim 查證 | 從 CV 一次操作打開支持來源與責任範圍 | 逐句抽查，記錯鏈/找不到來源 |
| 第二份 JD | 重用已確認經歷，無需再次輸入全部事實 | 比較重複輸入步驟與必要澄清 |
| 面試前 | 找到本輪、當時 CV、3 個主要準備點與待問問題 | 使用者不依賴其他筆記完成定位 |

先以你本人 3–5 次真實工作階段觀察摩擦，不能據此推論市場需求已驗證。未來對外產品化需另訪談目標使用者。

## Q. 規劃交付與下一個決策

階段、完整 MVP task backlog、DAG 與 PASS 標準見 [實施計畫](superpowers/plans/2026-09-11-career-2-product-delivery.md)。現況與五張架構圖見 [CURRENT_ARCHITECTURE.md](architecture/CURRENT_ARCHITECTURE.md)。

產品核心與 M1/M2 邊界已依本輪調整凍結，不再重新研究或 brainstorm 功能。接續順序為：**Plan Freeze → Project Mother bootstrap → Career 2.0 canonical repo → Phase 0 architecture → OSS capability selection → M1 Foundation / Workspace vertical slice → M2 Intelligence**。

本輪只完成 freeze，bootstrap 未執行。下一步應讀取實際 Project Mother 的權威入口及 bootstrap 規則，不自行發明 bootstrap 流程；新案是 Career 2.0。具體能力選型仍需依原定流程記錄採用/替換方式與批准；M2 的 AI/renderer 選型不應阻擋 M1 無 AI 的工作區。Phase 0 架構先定邏輯邊界，選型後才定實作細節。

## 最終狀態

PRODUCT_DIRECTION = APPROVE_WITH_MINOR_ADJUSTMENTS（本輪三項調整已寫回）

PRODUCT_SCOPE = DEFINED

PLAN = APPROVED / FROZEN（R1，2026-09-12）

MVP = M1 Career Evidence + Opportunity foundation 與投遞工作區 + M2 同一份經歷支撐的職位分析、定位、CV、關鍵案例、面試策略與一致性驗證。

PRIMARY_DIFFERENTIATORS =
- 可重用、可追溯且有責任邊界的 Career Evidence。
- 有理由的匹配、缺口區分與真實定位。
- CV 與面試共用案例、事實與定位。
- 基於實際送出版本的準備與歷史追溯。

OSS_REUSE =
- JSON Resume / 現成履歷 renderer 或 Reactive Resume 的模板與輸出候選。
- Career Ops 的評估與故事選擇概念參考。
- 現成儲存、編輯及批准的 CLI/API 能力；選型尚未批准。

DEFERRED =
- 自動公司研究與進階互動/debrief：Phase 2。
- 跨職缺回饋分析、額外材料、機會比較、Job Discovery：Later。
- 多人、同步、教練協作：需另立需求。

REMOVED_FROM_SCOPE =
- Auto Apply
- Mass Application Submission
- Custom Agent Framework
- Custom Model Router
- Custom Browser Runtime
- Custom Resume Layout Engine
- Custom Provider Adapter
- Complex Analytics
- Full CRM

IMPLEMENTATION = NOT_STARTED

USER_APPROVAL_REQUIRED_BEFORE_BUILD = YES

CAPABILITY_SELECTION = PENDING（產品範圍批准不等於工具選型批准）

NEXT = PROJECT MOTHER BOOTSTRAP（Career 2.0；未執行）
