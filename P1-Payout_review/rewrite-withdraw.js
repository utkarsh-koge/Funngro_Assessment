// POST /api/wallet/withdraw
// Header: Idempotency-Key
// Body: { amount }

async function withdraw(req, res) {
  const userId = req.user?.id;
  const amount = Number(req.body.amount);
  const idempotencyKey = req.headers["idempotency-key"];

  // 1. Validate request
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  if (!idempotencyKey) {
    return res.status(400).json({
      error: "Idempotency-Key header is required"
    });
  }

  const session = await mongoose.startSession();

  try {
    let withdrawal;
    let newBalance;

    // 2. Check user and deduct balance atomically.
    // Save withdrawal and ledger entry in the same transaction.
    await session.withTransaction(async () => {
      const existing = await Withdrawals.findOne({
        userId,
        idempotencyKey
      }).session(session);

      if (existing) {
        if (existing.amount !== amount) {
          throw new Error("IDEMPOTENCY_KEY_REUSED");
        }

        withdrawal = existing;
        return;
      }

      const user = await Users.findById(userId).session(session);

      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }

      if (!user.bankAccount) {
        throw new Error("BANK_ACCOUNT_NOT_FOUND");
      }

      const wallet = await Wallets.findOneAndUpdate(
        {
          userId,
          balance: { $gte: amount }
        },
        {
          $inc: { balance: -amount }
        },
        {
          new: true,
          session
        }
      );

      if (!wallet) {
        throw new Error("INSUFFICIENT_BALANCE");
      }

      const reference = "WD-" + new mongoose.Types.ObjectId().toString();

      [withdrawal] = await Withdrawals.create([{
        userId,
        amount,
        reference,
        idempotencyKey,
        status: "pending",
        bankAccount: user.bankAccount
      }], { session });

      newBalance = wallet.balance;

      await Ledger.create([{
        userId,
        withdrawalId: withdrawal._id,
        type: "withdrawal",
        amount: -amount,
        balanceAfter: newBalance,
        createdAt: new Date()
      }], { session });
    });

    // 3. A repeated request must not create another payout.
    if (withdrawal.status !== "pending") {
      return res.status(200).json({
        ok: true,
        status: withdrawal.status,
        message: "Withdrawal already exists"
      });
    }

    // 4. Mark as processing before calling the gateway.
    const claimed = await Withdrawals.findOneAndUpdate(
      {
        _id: withdrawal._id,
        status: "pending"
      },
      {
        $set: { status: "processing" }
      },
      { new: true }
    );

    if (!claimed) {
      return res.status(202).json({
        ok: true,
        status: "processing",
        message: "Withdrawal is being processed"
      });
    }

    // 5. Create payout using a stable reference.
    let payout;

    try {
      payout = await gateway.createPayout({
        account: claimed.bankAccount,
        amount: claimed.amount,
        reference: claimed.reference,
        idempotencyKey: claimed.reference
      });
    } catch (error) {
      // A timeout does not prove that the gateway rejected the payout.
      // Check the gateway before deciding whether to refund.
      try {
        payout = await gateway.getPayoutByReference(
          claimed.reference
        );
      } catch (lookupError) {
        console.error("Payout status lookup failed", lookupError);
      }

      if (!payout) {
        return res.status(202).json({
          ok: true,
          status: "processing",
          message: "Payout status is being verified"
        });
      }
    }

    // 6. Handle successful payout.
    if (["paid", "processed"].includes(payout.status)) {
      await Withdrawals.updateOne(
        {
          _id: claimed._id,
          status: "processing"
        },
        {
          $set: {
            status: "paid",
            gatewayPayoutId: payout.id
          }
        }
      );

      return res.status(200).json({
        ok: true,
        status: "paid",
        message: "Withdrawal successful"
      });
    }

    // 7. Refund only when the gateway confirms failure.
    if (["failed", "rejected"].includes(payout.status)) {
      await session.withTransaction(async () => {
        const failed = await Withdrawals.findOneAndUpdate(
          {
            _id: claimed._id,
            status: "processing"
          },
          {
            $set: { status: "failed" }
          },
          {
            new: true,
            session
          }
        );

        // Only the request that changes the status can refund.
        if (failed) {
          const wallet = await Wallets.findOneAndUpdate(
            { userId },
            { $inc: { balance: amount } },
            { new: true, session }
          );

          if (!wallet) {
            throw new Error("WALLET_NOT_FOUND");
          }

          await Ledger.create([{
            userId,
            withdrawalId: claimed._id,
            type: "withdrawal_refund",
            amount,
            balanceAfter: wallet.balance,
            createdAt: new Date()
          }], { session });
        }
      });

      return res.status(400).json({
        ok: false,
        status: "failed",
        message: "Payout failed. Amount refunded."
      });
    }

    // 8. Keep pending/unknown gateway states for reconciliation.
    await Withdrawals.updateOne(
      {
        _id: claimed._id,
        status: "processing"
      },
      {
        $set: {
          status: "submitted",
          gatewayPayoutId: payout.id,
          gatewayStatus: payout.status
        }
      }
    );

    return res.status(202).json({
      ok: true,
      status: "submitted",
      message: "Withdrawal submitted for processing"
    });

  } catch (error) {
    console.error("Withdrawal error:", error);

    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({ error: "User not found" });
    }

    if (error.message === "BANK_ACCOUNT_NOT_FOUND") {
      return res.status(400).json({ error: "Bank account not found" });
    }

    if (error.message === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    if (error.message === "IDEMPOTENCY_KEY_REUSED") {
      return res.status(409).json({
        error: "Idempotency key was already used with a different amount"
      });
    }

    return res.status(500).json({
      error: "Unable to process withdrawal"
    });

  } finally {
    await session.endSession();
  }
}



/*
ADDITIONAL PRODUCTION REQUIREMENTS

1. DATABASE INDEXES
   Create the following indexes:

   - withdrawals: { userId: 1, idempotencyKey: 1 } (unique)
     Prevents duplicate withdrawal requests.

   - withdrawals: { reference: 1 } (unique)
     Ensures every payout has a unique reference.

   - wallets: { userId: 1 } (unique)
     Ensures one wallet per user.

   - ledger: { userId: 1, createdAt: -1, _id: -1 }
     Improves paginated ledger history queries.


2. BACKGROUND RECONCILIATION (PSEUDOCODE)

   A scheduled job should periodically check withdrawals
   that remain in "processing" or "submitted" status.

   Pseudocode:

   Every 5 minutes:
     Find pending/stuck withdrawals.
     For each withdrawal:
       Check payout status with the payment gateway.

       If payout is successful:
         Mark withdrawal as "paid".

       If payout is confirmed failed:
         Start a database transaction.
         Change withdrawal status to "failed" only if it
         has not already been refunded.
         Refund the wallet.
         Insert a refund ledger entry.
         Commit transaction.

       If payout status is unknown:
         Leave it pending and retry reconciliation later.

   Never refund based only on a gateway timeout.


3. PAYMENT GATEWAY REQUIREMENTS

   - The gateway must support idempotency using the same
     withdrawal reference when retrying a payout.

   - Gateway response status must be mapped to the
     application's status, such as "paid", "failed",
     "rejected", and "pending".


4. DATABASE REQUIREMENT

   MongoDB must run as a replica set or sharded cluster
   because wallet and ledger operations use transactions.
   
*/