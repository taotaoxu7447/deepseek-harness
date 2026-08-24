# Design Specification: DeepSeek Balance Peak/Valley Indicator and Consumption Charts

- **Status**: Approved
- **Date**: 2026-08-24
- **Target Repository**: `/home/taotao-xu/deepseek_harness`
- **Affected Packages**:
  - `packages/remote/deepseek-balance`
  - `packages/host/apiproxy`
  - `packages/client/ui-deepseek-balance`

---

## 1. Overview & Goals

Transform the official DeepSeek API account balance capsule in `deepseek_harness` into a dynamic peak/valley indicator with historical consumption visualization:

1. **Dynamic Peak/Valley Indicator**:
   - In **Peak hours (峰时)**, display the prefix **`梁文峰`** (e.g. `梁文峰 ¥88.50`) with a distinct **Red theme**.
   - In **Off-peak/Valley hours (谷时)**, display the prefix **`梁文谷`** (e.g. `梁文谷 ¥88.50`) with a distinct **Blue theme**.
2. **Official Schedule Alignment**:
   - Strictly follow DeepSeek official peak/valley schedule based on Beijing Time (UTC+8):
     - **Valley (谷时 / 优惠时段)**: 00:30 - 08:30.
     - **Peak (峰时 / 正常时段)**: 08:30 - 00:30 (next day).
3. **Interactive Consumption Popover**:
   - Clicking the capsule opens an anchored Popover card above the capsule.
   - The Popover contains clean, native SVG bar charts for:
     - **Daily Consumption (每日消费)**: Past 14/30 days.
     - **Monthly Consumption (每月消费)**: Past 12 months.
   - Interactive hover tooltips displaying the exact date/month and consumption amount.
   - Seamless light/dark theme support using `--dsw-*` tokens without external heavy chart libraries.

---

## 2. Architecture & Data Flow

```
+-------------------------------------------------------------+
| DeepSeek API (https://api.deepseek.com/user/balance)       |
+-------------------------------------------------------------+
                              | (Poll on interval / manual)
                              v
+-------------------------------------------------------------+
| Host: DeepSeekBalanceService                                |
| - Resolves API Key via credentials service                 |
| - Computes Period: Peak ('梁文峰') vs Valley ('梁文谷')    |
| - Records Balance Snapshot { timestamp, total, currency }   |
| - Aggregates Deltas (prev - curr > 0) -> Daily & Monthly    |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Host: Apiproxy (balance.get RPC)                            |
| Returns: {                                                  |
|   balance: {                                                |
|     currency, total, available,                             |
|     period: 'peak' | 'valley',                              |
|     periodLabel: '梁文峰' | '梁文谷',                       |
|     consumption: { daily: [...], monthly: [...] }           |
|   }                                                         |
| }                                                           |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Client: ui-deepseek-balance                                 |
| - BalanceCapsule: Red theme for Peak, Blue for Valley       |
| - BalanceController: Polling & state synchronization        |
| - ConsumptionPopover: Native SVG Bar Chart (Daily/Monthly)  |
+-------------------------------------------------------------+
```

---

## 3. Detailed Specifications

### 3.1 Peak/Valley Engine (`packages/remote/deepseek-balance`)

#### Rule Definition
- Timezone: `Asia/Shanghai` (UTC+8).
- Valley (谷时): `00:30:00 <= time < 08:30:00`
  - `period`: `'valley'`
  - `periodLabel`: `'梁文谷'`
- Peak (峰时): `08:30:00 <= time < 24:00:00` OR `00:00:00 <= time < 00:30:00`
  - `period`: `'peak'`
  - `periodLabel`: `'梁文峰'`

#### Official Reference Pricing
- **Valley (谷时 - 优惠时段 50% 折扣)**:
  - DeepSeek-V3: Cache Hit ¥0.10/M, Miss ¥0.50/M, Output ¥1.00/M
  - DeepSeek-R1: Cache Hit ¥0.50/M, Miss ¥2.00/M, Output ¥4.00/M
- **Peak (峰时 - 正常时段)**:
  - DeepSeek-V3: Cache Hit ¥0.10/M, Miss ¥1.00/M, Output ¥2.00/M
  - DeepSeek-R1: Cache Hit ¥0.50/M, Miss ¥4.00/M, Output ¥8.00/M

### 3.2 Balance Snapshot & Delta Aggregation

#### Storage File
- Path: `~/.deepseek_harness/balance_history.json` (created automatically).
- Schema:
  ```ts
  interface BalanceRecord {
    timestamp: number
    currency: string
    total: number
  }

  interface BalanceHistoryStore {
    records: BalanceRecord[]
  }
  ```

#### Aggregation Algorithm
1. On each successful balance fetch:
   - Load existing history records.
   - If previous record exists:
     - Delta = `prev.total - curr.total`.
     - If `delta > 0` (balance decreased), record consumption into the corresponding day (`YYYY-MM-DD`) and month (`YYYY-MM`).
     - If `delta <= 0` (top-up or unchanged), ignore delta (do not record negative consumption).
   - Append current record and prune records older than 365 days.
2. Group aggregated consumption:
   - `daily`: Ordered list of `{ date: 'YYYY-MM-DD', amount: number }` for the last 14 (or up to 30) days.
   - `monthly`: Ordered list of `{ month: 'YYYY-MM', amount: number }` for the last 12 months.

### 3.3 Apiproxy Domain Contract (`packages/host/apiproxy`)

Extend `BalanceView` in `balance.ts` and `balance.schema.ts`:
```ts
export type BalancePeriod = 'peak' | 'valley'

export interface ConsumptionItem {
  key: string     // '2026-08-24' or '2026-08'
  label: string   // '8/24' or '8月'
  amount: number  // e.g. 3.45
}

export interface ConsumptionData {
  daily: ConsumptionItem[]
  monthly: ConsumptionItem[]
}

export interface BalanceView {
  currency: string
  total: string
  available: boolean
  period: BalancePeriod
  periodLabel: string // '梁文峰' | '梁文谷'
  consumption: ConsumptionData
}
```

### 3.4 Client UI Components (`packages/client/ui-deepseek-balance`)

#### 1. `BalanceCapsule.tsx`
- Renders:
  - Period prefix badge: `梁文峰` or `梁文谷`
  - Formatted amount: `¥88.50` or `$12.30`
- Dynamic Themes:
  - **Peak (`梁文峰`)**:
    - Border: `rgba(239, 68, 68, 0.35)`
    - Background: `rgba(239, 68, 68, 0.08)`
    - Text/Amount: `var(--dsw-alias-error)` or `#ef4444` accent
  - **Valley (`梁文谷`)**:
    - Border: `rgba(59, 130, 246, 0.35)`
    - Background: `rgba(59, 130, 246, 0.08)`
    - Text/Amount: `var(--dsw-alias-brand)` or `#3b82f6` accent
- Interactive Behavior:
  - `cursor: pointer`
  - `onClick`: Toggle Popover visibility.

#### 2. `ConsumptionPopover.tsx`
- Layout:
  - Anchored floating card (positioned above the capsule with smooth fade-in/scale transition).
  - Dismissible on click outside or `Escape` key.
- Content:
  - Header: Tab switcher: `[ 每日消费 ]` vs `[ 每月消费 ]`.
  - Chart Container:
    - Native SVG bar chart with responsive grid lines and bar heights scaled to max consumption value.
    - Bars: Rounded top corners (`rx="3"`), subtle hover highlight.
    - Interactive Tooltip: Absolute-positioned floating label showing `{date}: ¥{amount}` when hovering on a bar.
    - X-Axis: Short date/month labels below bars.
    - Empty State: When no consumption data exists, displays a graceful "暂无近期消费记录" placeholder.

---

## 4. Edge Cases & Error Handling

1. **No API Key configured**:
   - Capsule remains hidden (`data === null`).
2. **First-time launch (no prior snapshots)**:
   - Initial balance is stored; `consumption.daily` and `consumption.monthly` show zero consumption / graceful empty chart until usage occurs.
3. **Account Top-up (Recharge)**:
   - When `curr.total > prev.total`, delta is negative. Top-up is saved as new baseline without generating negative consumption.
4. **Timezone consistency**:
   - Peak/valley calculations strictly use UTC+8 (Beijing Time), independent of the local browser machine timezone.
5. **Network timeout / offline**:
   - Serves cached balance and consumption history gracefully.

---

## 5. Testing & Verification Plan

1. **Unit Tests**:
   - `packages/remote/deepseek-balance/tests/deepseek-balance.spec.ts`:
     - Test peak period determination (e.g. 10:00 UTC+8 -> `peak`, `梁文峰`).
     - Test valley period determination (e.g. 03:00 UTC+8 -> `valley`, `梁文谷`).
     - Test boundary condition: 00:30 UTC+8 -> `valley`, 08:30 UTC+8 -> `peak`.
     - Test delta calculation across multiple balance queries and top-up handling.
   - `packages/client/ui-deepseek-balance/tests/balance.client.spec.tsx`:
     - Test capsule rendering with `梁文峰` (red class) and `梁文谷` (blue class).
     - Test clicking capsule to open/close consumption popover.
     - Test switching between Daily and Monthly tabs.
2. **Typecheck & Regression Testing**:
   - Run `pnpm -r --filter @deepseek-ai/dsh-deepseek-balance test`
   - Run `pnpm -r --filter @deepseek-ai/dsh-client-ui-deepseek-balance test`
   - Run workspace typecheck.
