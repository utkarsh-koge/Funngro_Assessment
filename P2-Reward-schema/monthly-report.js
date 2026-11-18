const start = new Date("2026-09-30T18:30:00Z");   // 1 Oct 2026 00:00 IST
const end   = new Date("2026-10-31T18:30:00Z");   // 1 Nov 2026 00:00 IST

db.points_ledger.aggregate([
  // Range scan on {occurredAt, type}
  { $match: {
      occurredAt: { $gte: start, $lt: end },
      type: { $in: ["earn", "convert", "expire", "reversal"] }
  }},

  // Collapse to one row per user BEFORE joining, so $lookup runs once per active user,
  // not once per ledger event
  { $group: {
      _id: "$userId",
      pointsEarned:    { $sum: { $cond: [{ $eq: ["$type", "earn"] },     "$points", 0] } },
      pointsConverted: { $sum: { $cond: [{ $eq: ["$type", "convert"] },  "$points", 0] } },
      pointsExpired:   { $sum: { $cond: [{ $eq: ["$type", "expire"] },   "$points", 0] } },
      pointsReversed:  { $sum: { $cond: [{ $eq: ["$type", "reversal"] }, "$points", 0] } },
      cashPaidPaise:   { $sum: { $cond: [{ $eq: ["$type", "convert"] },  "$cashPaise", 0] } }
  }},

  // Attach cohort
  { $lookup: {
      from: "users", localField: "_id", foreignField: "_id",
      pipeline: [{ $project: { cohort: 1 } }], as: "u"
  }},
  { $set: { cohort: { $ifNull: [{ $first: "$u.cohort" }, "unknown"] } } },
  { $project: { u: 0 } },
  { $sort: { cohort: 1, _id: 1 } }
], { allowDiskUse: true })