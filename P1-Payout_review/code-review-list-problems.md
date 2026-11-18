1. Race Condition in Balance Deduction

Problem: The balance is checked and updated in separate operations, so two withdrawal requests can use the same balance at the same time.

Scenario: A user has ₹1,000 and sends two withdrawal requests of ₹1,000 simultaneously. Both requests may pass the balance check and initiate payouts, potentially sending ₹2,000 while the wallet only deducts ₹1,000.

Fix: Use an atomic balance update with a condition that the balance must be greater than or equal to the withdrawal amount. This ensures that concurrent requests cannot spend the same funds.

2. Missing Amount Validation

Problem: The withdrawal amount is not properly validated, so negative values, invalid types, or unexpected amounts may be accepted.

Scenario: A user sends a negative withdrawal amount, which could increase their wallet balance instead of deducting money.

Fix: Validate that the amount is a positive integer in paise and enforce minimum and maximum withdrawal limits.

3. No Authentication or User Ownership Check

Problem: The endpoint trusts the `userId` received in the request body instead of verifying the authenticated user.

Scenario: Someone changes the `userId` in the API request and attempts to withdraw money from another user's wallet.

Fix: Get the user ID from the authenticated session or token instead of trusting the request body. This ensures users can only withdraw from their own wallets.

4. Gateway Failure Is Not Properly Handled

Problem: The gateway call is not awaited, so the payout result may not be properly handled. The wallet is already debited even if the payout fails.

Scenario: The gateway rejects the payout or times out, but the user has already lost the deducted balance without receiving the money.

Fix: Await the gateway response and maintain withdrawal statuses such as `pending`, `success`, and `failed`. Refund the balance only after confirming that the payout has failed. A timeout should not automatically be treated as a failure because the payout may have been processed.

5. Duplicate Withdrawals and Inconsistent Records

Problem: The same withdrawal request can be processed more than once, and the wallet balance and transaction records may not stay in sync.

Scenario: A user retries the withdrawal request after a timeout, resulting in another payout. Alternatively, the server crashes after deducting the balance but before creating the ledger entry, leaving inconsistent records.

Fix: Use an idempotency key to prevent duplicate withdrawal requests and database transactions to keep wallet deductions, withdrawal records, and ledger entries consistent. Also, avoid fetching the entire ledger history on every withdrawal request. Return the withdrawal result and use a separate paginated endpoint for transaction history.