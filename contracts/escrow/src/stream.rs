/// Payment streaming — issue #405.
///
/// A `PaymentStream` releases tokens continuously from `sender` to
/// `recipient` at `rate_per_second` stroops per second.
///
/// # Rate decrease
/// The sender may call `decrease_rate_per_second` at any time to slow the
/// flow.  Accrued amounts are check-pointed before the new rate takes effect
/// and any surplus deposit (the portion that can no longer be consumed at
/// the lower rate before the stream ends) is refunded to the sender.
///
/// # Accrual model
/// ```text
/// accrued(t) = accrued_at_checkpoint
///            + (t - last_checkpoint_at) * rate_per_second
/// ```
/// where `t` is the current ledger timestamp.

use soroban_sdk::{contracttype, Address, Env};

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// Persistent storage key for a stream entry.
#[contracttype]
#[derive(Clone)]
pub enum StreamKey {
    Stream(u64),
}

/// Core stream record stored on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PaymentStream {
    /// Address that funded the stream and may decrease the rate.
    pub sender: Address,
    /// Address that receives the streamed tokens.
    pub recipient: Address,
    /// Current streaming rate in stroops per second.
    pub rate_per_second: i128,
    /// Total deposit placed into the stream at creation (or top-up).
    pub deposit: i128,
    /// Accrued amount at the last checkpoint (stroops).
    pub accrued_at_checkpoint: i128,
    /// Ledger timestamp at which the last checkpoint was recorded.
    pub last_checkpoint_at: u64,
    /// Ledger timestamp after which no more tokens accrue.
    pub end_time: u64,
    /// Whether the stream has been cancelled.
    pub cancelled: bool,
}

// ---------------------------------------------------------------------------
// Pure helpers — usable off-chain and in unit tests without `Env`
// ---------------------------------------------------------------------------

/// Return the amount accrued by `stream` at ledger timestamp `now`.
///
/// The value is clamped to `[accrued_at_checkpoint, deposit]` so it never
/// exceeds the total deposit or goes backwards.
pub fn get_accrued_amount(stream: &PaymentStream, now: u64) -> i128 {
    if stream.cancelled {
        return stream.accrued_at_checkpoint;
    }
    let effective_now = now.min(stream.end_time);
    let delta = effective_now.saturating_sub(stream.last_checkpoint_at) as i128;
    let accrued = stream.accrued_at_checkpoint + delta * stream.rate_per_second;
    accrued.min(stream.deposit)
}

/// Checkpoint the stream at `now`: advance `accrued_at_checkpoint` and reset
/// `last_checkpoint_at`.  Returns the mutated stream.
pub fn checkpoint(mut stream: PaymentStream, now: u64) -> PaymentStream {
    stream.accrued_at_checkpoint = get_accrued_amount(&stream, now);
    stream.last_checkpoint_at = now.min(stream.end_time);
    stream
}

/// Compute the surplus deposit when the rate is lowered to `new_rate`.
///
/// After the rate change the stream can only consume:
///   `remaining_time * new_rate`
/// If that is less than `remaining_deposit`, the difference is surplus and
/// should be refunded to the sender immediately.
pub fn compute_surplus(stream: &PaymentStream, now: u64, new_rate: i128) -> i128 {
    let accrued = get_accrued_amount(stream, now);
    let remaining_deposit = stream.deposit - accrued;
    let remaining_time = stream.end_time.saturating_sub(now) as i128;
    let consumable = remaining_time * new_rate;
    if consumable < remaining_deposit {
        remaining_deposit - consumable
    } else {
        0
    }
}

// ---------------------------------------------------------------------------
// On-chain entrypoints (require `Env`)
// ---------------------------------------------------------------------------

/// Decrease the stream's rate per second.
///
/// # Rules
/// - Only `sender` may call this.
/// - `new_rate` must be > 0 and < current `rate_per_second`.
/// - Accrual is check-pointed before the rate change takes effect.
/// - Any surplus deposit (tokens that can no longer be consumed at the lower
///   rate before `end_time`) is refunded to the sender.
///
/// # Panics
/// - If the stream does not exist.
/// - If `new_rate` is 0 or ≥ the current rate.
/// - If the caller is not the sender.
pub fn decrease_rate_per_second(
    env: &Env,
    stream_id: u64,
    sender: &Address,
    new_rate: i128,
) -> i128 {
    sender.require_auth();

    let key = StreamKey::Stream(stream_id);
    let mut stream: PaymentStream = env
        .storage()
        .persistent()
        .get(&key)
        .expect("stream not found");

    assert!(!stream.cancelled, "stream is cancelled");
    assert_eq!(stream.sender, *sender, "caller is not the stream sender");
    assert!(new_rate > 0, "new_rate must be greater than zero");
    assert!(
        new_rate < stream.rate_per_second,
        "new_rate must be less than the current rate"
    );

    let now = env.ledger().timestamp();

    // 1. Checkpoint accrual before touching the rate.
    stream = checkpoint(stream, now);

    // 2. Compute how much deposit becomes surplus at the new rate.
    let surplus = compute_surplus(&stream, now, new_rate);

    // 3. Apply the new rate.
    stream.rate_per_second = new_rate;
    // Reduce deposit by surplus (caller is responsible for the actual token
    // transfer; here we only track the accounting).
    stream.deposit -= surplus;

    // 4. Persist the updated stream.
    env.storage().persistent().set(&key, &stream);

    // Return surplus so the caller knows how much to transfer back.
    surplus
}

/// Read-only: return the live accrued amount for `stream_id` at the current
/// ledger timestamp.
///
/// Returns 0 if the stream does not exist.
pub fn get_accrued_amount_on_chain(env: &Env, stream_id: u64) -> i128 {
    let key = StreamKey::Stream(stream_id);
    match env
        .storage()
        .persistent()
        .get::<StreamKey, PaymentStream>(&key)
    {
        Some(stream) => get_accrued_amount(&stream, env.ledger().timestamp()),
        None => 0,
    }
}

// ---------------------------------------------------------------------------
// Unit tests — issue #405 acceptance criteria
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    fn make_stream(env: &Env, rate: i128, deposit: i128, start: u64, end: u64) -> PaymentStream {
        PaymentStream {
            sender: Address::generate(env),
            recipient: Address::generate(env),
            rate_per_second: rate,
            deposit,
            accrued_at_checkpoint: 0,
            last_checkpoint_at: start,
            end_time: end,
            cancelled: false,
        }
    }

    // ── get_accrued_amount ────────────────────────────────────────────────────

    #[test]
    fn accrual_before_stream_starts() {
        let env = Env::default();
        let stream = make_stream(&env, 10, 1000, 100, 200);
        // At t=50 (before stream starts) — delta is 0 because last_checkpoint_at=100
        // and effective_now = 50.min(200) = 50, but 50 < 100 so saturating_sub=0.
        assert_eq!(get_accrued_amount(&stream, 50), 0);
    }

    #[test]
    fn accrual_mid_stream() {
        let env = Env::default();
        let stream = make_stream(&env, 10, 1000, 0, 200);
        // At t=50: 50 * 10 = 500
        assert_eq!(get_accrued_amount(&stream, 50), 500);
    }

    #[test]
    fn accrual_clamped_to_deposit() {
        let env = Env::default();
        let stream = make_stream(&env, 10, 300, 0, 200);
        // At t=100: 100 * 10 = 1000 > deposit(300), clamped to 300
        assert_eq!(get_accrued_amount(&stream, 100), 300);
    }

    #[test]
    fn accrual_after_end_time_clamped() {
        let env = Env::default();
        let stream = make_stream(&env, 10, 1000, 0, 50);
        // At t=200: effective_now = 200.min(50) = 50, accrued = 50*10 = 500
        assert_eq!(get_accrued_amount(&stream, 200), 500);
    }

    // ── checkpoint ───────────────────────────────────────────────────────────

    #[test]
    fn checkpoint_advances_accrual() {
        let env = Env::default();
        let stream = make_stream(&env, 10, 1000, 0, 200);
        let s = checkpoint(stream, 30);
        assert_eq!(s.accrued_at_checkpoint, 300); // 30*10
        assert_eq!(s.last_checkpoint_at, 30);
    }

    // ── decrease_rate_per_second (pure logic via compute_surplus) ─────────────

    #[test]
    fn rate_decrease_mid_stream_checkpoints_correctly() {
        let env = Env::default();
        // Stream: rate=10, deposit=1000, t=0..100
        let stream = make_stream(&env, 10, 1000, 0, 100);

        // At t=30: accrued=300, remaining_deposit=700, remaining_time=70
        // new_rate=5 → consumable = 70*5=350 < 700 → surplus=350
        let surplus = compute_surplus(&stream, 30, 5);
        assert_eq!(surplus, 350);

        let s = checkpoint(stream, 30);
        assert_eq!(s.accrued_at_checkpoint, 300);
        assert_eq!(s.last_checkpoint_at, 30);
    }

    #[test]
    fn surplus_is_zero_when_new_rate_can_consume_all() {
        let env = Env::default();
        // Stream: rate=10, deposit=1000, t=0..100
        let stream = make_stream(&env, 10, 1000, 0, 100);
        // At t=50: accrued=500, remaining=500, remaining_time=50
        // new_rate=10 → consumable=500 = remaining → surplus=0
        let surplus = compute_surplus(&stream, 50, 10);
        assert_eq!(surplus, 0);
    }

    #[test]
    fn withdrawal_after_rate_decrease_uses_new_checkpoint() {
        let env = Env::default();
        let stream = make_stream(&env, 20, 2000, 0, 100);

        // Checkpoint at t=40: accrued=40*20=800
        let s = checkpoint(stream, 40);
        // Apply new_rate=10
        let mut s2 = s;
        s2.rate_per_second = 10;

        // At t=60 (20 seconds after checkpoint): delta=20, accrued=800+20*10=1000
        assert_eq!(get_accrued_amount(&s2, 60), 1000);
    }

    #[test]
    fn cancellation_after_rate_decrease_freezes_accrual() {
        let env = Env::default();
        let mut stream = make_stream(&env, 10, 1000, 0, 100);

        // Checkpoint at t=30
        stream = checkpoint(stream, 30);
        assert_eq!(stream.accrued_at_checkpoint, 300);

        // Cancel stream
        stream.cancelled = true;

        // Accrual should be frozen at checkpoint value regardless of time.
        assert_eq!(get_accrued_amount(&stream, 80), 300);
        assert_eq!(get_accrued_amount(&stream, 100), 300);
    }

    // ── on-chain decrease_rate_per_second via Env ─────────────────────────────

    #[test]
    fn on_chain_decrease_rate_returns_correct_surplus() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(30);

        let sender = Address::generate(&env);
        let stream = PaymentStream {
            sender: sender.clone(),
            recipient: Address::generate(&env),
            rate_per_second: 10,
            deposit: 1000,
            accrued_at_checkpoint: 0,
            last_checkpoint_at: 0,
            end_time: 100,
            cancelled: false,
        };
        let key = StreamKey::Stream(1);
        env.storage().persistent().set(&key, &stream);

        // At t=30: accrued=300, remaining=700, remaining_time=70, new_rate=5
        // consumable=350, surplus=350
        let surplus = decrease_rate_per_second(&env, 1, &sender, 5);
        assert_eq!(surplus, 350);

        let updated: PaymentStream = env.storage().persistent().get(&key).unwrap();
        assert_eq!(updated.rate_per_second, 5);
        assert_eq!(updated.accrued_at_checkpoint, 300);
        assert_eq!(updated.deposit, 650); // 1000 - 350
    }

    #[test]
    fn on_chain_get_accrued_returns_live_value_before_and_after_rate_change() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(20);

        let sender = Address::generate(&env);
        let stream = PaymentStream {
            sender: sender.clone(),
            recipient: Address::generate(&env),
            rate_per_second: 10,
            deposit: 1000,
            accrued_at_checkpoint: 0,
            last_checkpoint_at: 0,
            end_time: 100,
            cancelled: false,
        };
        env.storage().persistent().set(&StreamKey::Stream(2), &stream);

        // Before rate change: t=20 → accrued = 20*10 = 200
        assert_eq!(get_accrued_amount_on_chain(&env, 2), 200);

        // Decrease rate
        decrease_rate_per_second(&env, 2, &sender, 5);

        // After checkpoint at t=20 with new rate=5, get_accrued at t=20 = 200
        assert_eq!(get_accrued_amount_on_chain(&env, 2), 200);
    }
}
