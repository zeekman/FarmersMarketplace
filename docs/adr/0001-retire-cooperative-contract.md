# ADR 0001: Retire the standalone `contracts/cooperative` contract

- **Status:** Accepted
- **Date:** 2024-01-01
- **Backlog ID:** 106 (GitHub #1717)
- **Supersedes:** the standalone cooperative multisig contract in `contracts/cooperative`

## Context

The standalone cooperative contract in `contracts/cooperative/src/lib.rs` was intended to
provide multi-signature release of escrowed funds for a cooperative. In practice it has
several blocking defects:

1. **Does not compile.** `CoopConfig.members` is a `Vec<Address>`, but
   `env.crypto().ed25519_verify(&member_key, ...)` requires a `&BytesN<32>`. The member
   type and the verification call are incompatible.
2. **Threshold bypass.** `set_coop` does not reject duplicate members. With
   `members = [A, A, B]` and `threshold = 2`, signer `A` alone can satisfy the threshold
   by signing positions 0 and 1.
3. **No replay protection.** The signed `message: Bytes` is caller-supplied and is not
   bound to an escrow ID, contract address, network, or nonce. A signature collected for
   one release can be replayed against another release, order, or deployment.
4. **No funds movement.** `multisig_release` only flips an instance-storage flag for a
   single global escrow; it never moves funds.

Meanwhile, the escrow contract (`contracts/escrow/src/lib.rs`) already implements
per-cooperative multisig correctly:

- `CoopConfig(Address)` is keyed per cooperative, not a single global config.
- `MAX_COOP_SIGNERS` bounds the signer set.
- Duplicate signers are rejected when the config is written.
- `multisig_release` verifies signatures over a domain-separated payload and moves funds.

Maintaining two implementations of the same concept is a correctness and security risk:
the broken one is a footgun for any integrator that wires it up.

## Decision

**Retire `contracts/cooperative`.** The directory is deleted and no cooperative flow uses
it. All cooperative release flows go through the escrow contract's `multisig_release`.

### Signing payload

Escrow `multisig_release` must sign over a domain-separated payload that binds the
signature to the contract, network, order, and a per-escrow nonce:

```
payload = sha256("FM_COOP_RELEASE" || contract_id || network_id || order_id || nonce)
```

- `contract_id` binds the signature to this escrow deployment.
- `network_id` binds it to the network (testnet/mainnet) so a testnet signature cannot be
  replayed on mainnet.
- `order_id` binds it to a specific order so a signature for one order cannot be replayed
  against another.
- `nonce` is a per-escrow monotonically increasing counter stored in escrow state. It is
  incremented on every successful release, so a captured signature cannot be replayed
  against the same order after a release has already occurred.

### Backend

The backend `cooperatives.js` uses only the escrow ABI. It does not import or call the
retired cooperative contract.

## Consequences

- One implementation of cooperative multisig, in escrow, with duplicate-member rejection,
  domain-separated signing, and per-escrow nonce replay protection.
- Integrators must use the escrow ABI for cooperative releases; the old cooperative
  contract is no longer available.
- Tests cover: duplicate member rejected, replayed signature from another order rejected,
  and signature for another contract rejected.
