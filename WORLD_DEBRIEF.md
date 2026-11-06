# World ID integration debrief

## The trust moment
Taking a **minter** or **broker** role. A pledge only means something if the person who minted against it and the broker holding the shares are different people. Holders who only trade or redeem need no verification.

## Credential choice: Proof of Human
| Option | Why not / why |
|---|---|
| No check | One person could hold both roles and fake a pledge |
| Selfie Check | Probabilistic; too weak where other people's money depends on independence |
| Passport (NFC) | Collects name and nationality we do not need |
| **Proof of Human** | A unique, anonymous per-app identifier and nothing else: the minimum that makes "one person, one role" enforceable |

## Integration
- IDKit 4 (`@worldcoin/idkit` 4.6) in the browser, `proofOfHuman({ signal: encodePacked(uint8 role, address wallet) })`.
- The API signs the RP request (`signRequest`, action `bullstreet-role-v1`), verifies the result with `developer.world.org/api/v4/verify/<rp_id>`, checks environment, protocol version, action, credential type and that the signal hash matches the wallet and role, and refuses a person who already holds a role.
- It returns an EIP-712 `RoleAttestation` signed by a server key; `RoleRegistry.register` checks the signature, expiry and `msg.sender`, records the role and burns the nullifier, so uniqueness holds on-chain too.

## Paths demonstrated
- **Success:** verify → attestation → on-chain registration → the workspace opens.
- **Rejection:** the same person verifying for the second role gets "You already hold a Bull Street role" (API `409 ROLE_TAKEN`; the contract would also revert `RoleTaken`).
- **Cancel:** closing the World ID dialog shares nothing and offers to start again.
- **Wrong wallet:** a wallet registered for the other role is told to switch wallets.

## Debrief
_To be completed from the team's own testing:_
- **Time to first success:**
- **Friction:** IDKit 4 needs a server-signed `rp_context`, and the Developer Portal does not bind the signal or reject reused nullifiers for us, so both checks live in our API.
- **Missing capability or docs:**
- **The one improvement with the greatest impact:**
