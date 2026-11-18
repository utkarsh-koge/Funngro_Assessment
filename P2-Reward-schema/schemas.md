// point_lots: one document per earn event. Consumed FIFO by expiry date.
{
  _id: ObjectId,
  userId: String,
  sourceType: "project" | "promo" | "adjustment",
  sourceId: String,            // projectId / campaignId+eventId: dedupes earns
  points: Long,                // original grant
  remaining: Long,             // >= 0, decremented on convert/expire
  status: "open" | "exhausted" | "expired",
  earnedAt: Date,
  expiresAt: Date,             // snapshot of policy at earn time
  earnLedgerId: ObjectId
}

// points_ledger: append-only, never updated or deleted. Audit + finance source.
{
  _id: ObjectId,
  userId: String,
  type: "earn" | "convert" | "expire" | "reversal",
  points: Long,                // always positive; `type` gives the direction
  lotId: ObjectId | null,      // which lot this row touched
  conversionId: ObjectId | null,
  sourceType: String | null, sourceId: String | null,
  cashPaise: Long | null,      // convert rows only
  occurredAt: Date,            // business time: reports use this
  createdAt: Date
}

// point_balances: derived cache, one per user
{
  _id: String,                 // userId
  available: Long,             // validator: >= 0
  updatedAt: Date
}

// conversion_rates: append-only, effective-dated
{
  _id: ObjectId,
  effectiveFrom: Date,
  paisePerThousandPoints: Int32,   // integer rate, no float math
  rounding: "floor",
  createdBy: String, createdAt: Date
}

// conversions: the audit record of each conversion
{
  _id: ObjectId,
  userId: String,
  idempotencyKey: String,
  points: Long,
  rateId: ObjectId,
  paisePerThousandPoints: Int32,   // snapshot, so the audit survives rate-table changes
  cashPaise: Long,                 // floor(points * rate / 1000)
  lotsConsumed: [{ lotId: ObjectId, points: Long }],
  walletLedgerId: ObjectId,        // link to the wallet-side credit
  status: "completed",             // written in the same txn as the money movement
  requestMeta: { ip: String, deviceId: String },
  createdAt: Date
}

// users (existing): add cohort: String  // e.g. "2026-03", signup month, immutable



Collection - Index	- Serves
point_lots        |	{userId:1, sourceType:1, sourceId:1} | unique	Earn dedupe. A retried or replayed “project completed” event can’t grant points twice.
point_lots        |	{userId:1, expiresAt:1}              | partial status:"open"	FIFO consumption during conversion: “this user’s open lots, soonest-expiring first”.
point_lots        |	{expiresAt:1}                        | partial status:"open"	Expiry sweeper: “all open lots with expiresAt <= now”. Partial keeps it small.
points_ledger     | {userId:1, occurredAt:-1} 	         | User statement / support view, paginated.
points_ledger	    | {occurredAt:1, type:1}	             | Monthly finance report: range scan on the month.
points_ledger	    | {lotId:1, type:1}                    | unique partial type:"expire"	Makes expiry idempotent: a lot can be expired at most once even if the job runs twice.
conversions	      | {userId:1, idempotencyKey:1}         | unique	Retry returns the original result. Concurrent duplicates lose on the index.
conversions	      | {userId:1, createdAt:-1}	           | Conversion history per user.
conversion_rates  |	{effectiveFrom:-1}	                 | “Rate in force now”: find({effectiveFrom:{$lte:now}}).sort(-1).limit(1).
point_balances    | none beyond _id                      | 	_id is the userId, so lookups and atomic updates are _id hits.