## 1. MongoDB Collections

### `point_lots`
```javascript
{
  _id: ObjectId,
  userId: String,
  sourceType: String,       // project | promo | adjustment
  sourceId: String,
  points: Long,
  remaining: Long,
  status: String,           // open | exhausted | expired
  earnedAt: Date,
  expiresAt: Date,
  earnLedgerId: ObjectId
}
```

### `points_ledger`
```javascript
{
  _id: ObjectId,
  userId: String,
  type: String,             // earn | convert | expire | reversal
  points: Long,
  lotId: ObjectId | null,
  conversionId: ObjectId | null,
  sourceType: String | null,
  sourceId: String | null,
  cashPaise: Long | null,
  occurredAt: Date,
  createdAt: Date
}
```

### `point_balances`
```javascript
{
  _id: String,              // userId
  available: Long,
  updatedAt: Date
}
```

### `conversion_rates`
```javascript
{
  _id: ObjectId,
  effectiveFrom: Date,
  paisePerThousandPoints: Int32,
  rounding: String,         // floor
  createdBy: String,
  createdAt: Date
}
```

### `conversions`
```javascript
{
  _id: ObjectId,
  userId: String,
  idempotencyKey: String,
  points: Long,
  rateId: ObjectId,
  paisePerThousandPoints: Int32,
  cashPaise: Long,
  lotsConsumed: [
    {
      lotId: ObjectId,
      points: Long
    }
  ],
  walletLedgerId: ObjectId,
  status: String,           // completed
  requestMeta: {
    ip: String,
    deviceId: String
  },
  createdAt: Date
}
```

### `users` (existing collection – additional field)
```javascript
{
  cohort: String            // signup month, e.g. "2026-03"
}
```

---

## 2. Indexes and Their Purpose

| Collection | Index | Query it serves |
|---|---|---|
| `point_lots` | `{ userId: 1, sourceType: 1, sourceId: 1 }` – Unique | Prevents duplicate points from the same earning event. |
| `point_lots` | `{ userId: 1, expiresAt: 1 }` – Partial: `status: "open"` | Finds a user's available lots in expiry order during conversion (FIFO). |
| `point_lots` | `{ expiresAt: 1 }` – Partial: `status: "open"` | Finds expired lots for the expiry job. |
| `points_ledger` | `{ userId: 1, occurredAt: -1 }` | Fetches a user's transaction history with pagination. |
| `points_ledger` | `{ occurredAt: 1, type: 1 }` | Supports monthly reports by date range and transaction type. |
| `points_ledger` | `{ lotId: 1, type: 1 }` – Unique, partial: `type: "expire"` | Prevents the same lot from being expired more than once. |
| `conversions` | `{ userId: 1, idempotencyKey: 1 }` – Unique | Prevents duplicate conversion requests and handles retries. |
| `conversions` | `{ userId: 1, createdAt: -1 }` | Fetches a user's conversion history. |
| `conversion_rates` | `{ effectiveFrom: -1 }` | Finds the latest effective conversion rate. |
| `point_balances` | No additional index | `_id` is `userId`, so balance lookups are already indexed. |