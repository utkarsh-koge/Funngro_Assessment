# Payout Incident – My First 30 Minutes

The withdrawal endpoint's p95 latency has increased from 300ms to 11 seconds, and customers are reporting that money has been debited but not received.

I would treat this as a financial incident. My first priority would be to prevent further incorrect or duplicate payouts, check whether the database or payment gateway is under pressure, and identify which withdrawals are affected. I would not wait for the root cause before taking action to protect customers.

## Minutes 0–5: Assess the incident

First, I would check application logs, MongoDB Atlas metrics, and the payment gateway dashboard to understand where the problem might be coming from.

I would check:

- Application: Withdrawal errors, timeouts, connection resets, repeated requests, and application restarts.
- MongoDB Atlas: CPU, disk latency, connections, slow queries, query targeting, WiredTiger cache pressure, and replication lag.
- Payment gateway: Payout success, failure, and pending statuses, API latency, timeouts, and HTTP 429 responses.

I would also check whether a deployment, configuration change, scheduled job, or sudden increase in traffic happened around the time the latency started.

Example log command:

```bash
grep -iE "withdraw|timeout|gateway|error|ETIMEDOUT|ECONNRESET" app.log | tail -200
```

If logs are JSON:

```bash
jq 'select(.endpoint == "/api/wallet/withdraw")' app.log | tail -100
```

This would help me identify whether the requests are failing inside the application, waiting on MongoDB, or waiting for the payment gateway.

## Minutes 5–10: Stop the bleeding

I would not wait until I understand the root cause to protect customers' money.

First, I would check whether the gateway is healthy and whether payout statuses can be verified.

If the gateway is healthy and payouts can be tracked reliably: I would temporarily rate-limit withdrawal requests to reduce repeated requests and monitor the system closely.

If gateway timeouts, failures, 429 responses, or unknown payout statuses are increasing: I would pause new withdrawal requests.

If we cannot reliably determine whether a payout was sent or accepted: I would pause withdrawals until we can track the payout status safely.

If duplicate payouts are confirmed: I would pause withdrawals immediately and contact the gateway to stop or recover duplicate payouts that are still cancellable.

If a kill switch or feature flag is available, I would use it. Otherwise, I would temporarily disable the withdrawal route through the gateway or load balancer rather than rushing a code deployment.

I would inform Support and Finance that withdrawals are temporarily restricted and that we are verifying payout statuses before processing refunds or retrying payments.

## Minutes 10–15: Investigate database pressure

If MongoDB Atlas metrics indicate database pressure, I would investigate the queries causing it.

I would check for long-running operations:

```javascript
db.currentOp({
  active: true,
  secs_running: { $gte: 3 },
  ns: /ledger/i
});
```

I would look for collection scans, queries examining too many documents, high connection usage, or operations waiting on database resources.

If I identify a confirmed non-essential read query causing significant load, I would consider cancelling it if safe. I would not terminate wallet updates or ledger writes without understanding their impact.

I would also check whether the withdrawal endpoint is fetching a user's entire transaction history on every request, as that could increase latency and database load.

## Minutes 15–20: Identify affected withdrawals

Next, I would establish how many withdrawals are affected and how much money is involved.

I would compare our withdrawal records and wallet debits against the gateway's payout records using withdrawal references, amounts, and timestamps.

If the ledger has ObjectId values generated around record creation time, I could use them to narrow down recent records for an initial investigation:

```javascript
const since = ObjectId.createFromTime(
  Math.floor(Date.now() / 1000) - 3 * 3600
);

db.ledger.find({
  _id: { $gte: since },
  type: "withdrawal"
}).limit(100);
```

I would first confirm the actual collection and field names. I would avoid unindexed queries that scan the entire ledger while the database is already under pressure.

I would classify the affected withdrawals:

- Successful: Gateway confirms the payout completed. Verify the reference and update Support.
- Pending: Do not refund or resend. Track the payout until the gateway confirms the outcome.
- Failed: Refund only after the failure is confirmed, using an idempotent refund process and recording it in the ledger.
- Unknown: Do not resend the payout until the original outcome is confirmed.
- Duplicate: Contact the gateway immediately to cancel or recover any duplicate that can still be stopped.

This would give us the number and total value of debited withdrawals that do not yet have a confirmed payout.

## Minutes 20–30: Stabilise and communicate

Based on the findings, I would apply the smallest safe mitigation.

If database load is caused by a specific query, I would consider a targeted, reviewed, and reversible change rather than a large code change during the incident.

If withdrawals are paused, I would keep them paused until database and gateway conditions are stable and payout statuses can be tracked safely.

If the system is safe to reopen, I would gradually restore withdrawal traffic while monitoring:

- Withdrawal p95 latency
- Error and timeout rate
- MongoDB CPU, connections, and query performance
- Gateway payout success, pending, and failure rates
- Duplicate payout reports

I would also provide Support with a clear message:

"Your withdrawal is being checked against the payment provider. We are confirming its status before taking any further action. We will update you once we have verified the outcome."

I would contact Finance and the gateway if there are significant unmatched withdrawals and provide a handoff with the incident timeline, affected amounts, payout statuses, mitigation taken, and outstanding investigations.

## What I would not do

- Blindly retry payouts: The original payout may have succeeded even if our request timed out. Retrying could pay the customer twice.
- Mass-refund customers: Some payouts may still be pending or completed. Refunding without confirmation could cause additional financial loss.
- Restart the application or database without evidence: This may interrupt in-flight requests and create more uncertainty without fixing the issue.
- Kill write operations blindly: Wallet updates and ledger writes may be in progress. Terminating them could create inconsistencies.
- Increase timeouts or retries blindly: This could keep requests open longer, increase load, and create duplicate requests.
- Make large code changes during the incident: I would prefer a small, reversible mitigation over an untested refactor.
- Delete or modify ledger records: Financial corrections should be recorded as new, auditable entries.

## At the 30-minute mark

I would report the current status clearly: whether withdrawals are paused or rate-limited, what we have identified so far, how many withdrawals and what amount are affected, how many are pending or confirmed failed, what mitigation is in place, and who is handling reconciliation.

My immediate goal is to protect customers' money, prevent duplicate payouts, reduce system pressure, and establish a safe recovery path. Once the incident is stable, I would continue investigating the root cause and plan permanent fixes.