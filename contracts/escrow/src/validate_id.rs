/// ID format validation helper — issue #404.
///
/// Allowed format: alphanumeric characters plus `-` and `_`.
/// Length: 3–64 characters (inclusive).
///
/// Returns `true` if `id` is valid, `false` otherwise.
/// Apply to `payment_id`, `order_id` (string form), `refund_id`, and
/// `dispute_id` before any state is written.
pub fn is_valid_id(id: &str) -> bool {
    let len = id.len();
    if len < 3 || len > 64 {
        return false;
    }
    id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[cfg(test)]
mod tests {
    use super::is_valid_id;

    // ── acceptance criteria from issue #404 ───────────────────────────────────

    #[test]
    fn empty_id_is_rejected() {
        assert!(!is_valid_id(""));
    }

    #[test]
    fn id_shorter_than_3_chars_is_rejected() {
        assert!(!is_valid_id("ab"));
        assert!(!is_valid_id("a"));
    }

    #[test]
    fn id_longer_than_64_chars_is_rejected() {
        let long = "a".repeat(65);
        assert!(!is_valid_id(&long));
    }

    #[test]
    fn id_with_disallowed_characters_is_rejected() {
        assert!(!is_valid_id("abc\ndef"));   // newline
        assert!(!is_valid_id("abc\0def"));   // null byte
        assert!(!is_valid_id("abc def"));    // space
        assert!(!is_valid_id("abc!def"));    // exclamation mark
        assert!(!is_valid_id("abc/def"));    // forward slash
    }

    #[test]
    fn valid_alphanumeric_dash_underscore_ids_are_accepted() {
        assert!(is_valid_id("abc"));
        assert!(is_valid_id("payment-123"));
        assert!(is_valid_id("order_id_99"));
        assert!(is_valid_id("ABC123"));
        assert!(is_valid_id("a-b_c-1"));
        // Exactly 64 characters — boundary should pass.
        let max = "a".repeat(64);
        assert!(is_valid_id(&max));
        // Exactly 3 characters — boundary should pass.
        assert!(is_valid_id("xyz"));
    }
}
