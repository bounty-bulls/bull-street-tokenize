// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {BadSignature, NonceUsed, NotEnoughSigners} from "./Errors.sol";

/// @notice EIP-712 typehashes. Mirrored in services/shared/src/eip712.ts.
library TypeHashes {
    bytes32 internal constant ROLE_ATTESTATION =
        keccak256("RoleAttestation(address wallet,uint8 role,bytes32 nullifierHash,uint64 expiry,uint256 nonce)");
    bytes32 internal constant PLEDGE_ATTESTATION = keccak256(
        "PledgeAttestation(uint256 pledgeId,bytes32 psnHash,bytes32 isinHash,uint256 quantity,address minter,uint64 validUntil,uint256 nonce)"
    );
    bytes32 internal constant RELEASE_CONFIRMATION =
        keccak256("ReleaseConfirmation(uint256 pledgeId,uint256 quantity,uint256 nonce)");
    bytes32 internal constant SALE_REPORT = keccak256(
        "SaleReport(uint256 allocationId,uint256 quantity,uint256 grossProceeds,uint64 saleTime,uint256 nonce)"
    );
    bytes32 internal constant PRICE_BATCH = keccak256(
        "PriceBatch(uint32 sessionIndex,uint32[] assetIds,uint256[] closes,uint64 asOf,uint256 nonce)"
    );
    bytes32 internal constant SESSION_INFO =
        keccak256("SessionInfo(uint32 sessionIndex,uint64 openTime,uint64 closeTime)");
    bytes32 internal constant SESSION_BATCH = keccak256(
        "SessionBatch(SessionInfo[] sessions,uint256 nonce)SessionInfo(uint32 sessionIndex,uint64 openTime,uint64 closeTime)"
    );
}

/// @title Attestations
/// @notice EIP-712 domain "Bull Street" v1, per-signer nonce bitmaps (replay protection) and signature checks
///         that accept EOAs or ERC-1271 contracts.
abstract contract Attestations is EIP712 {
    mapping(address => mapping(uint256 => uint256)) private _nonceBits;

    event NonceUsedBy(address indexed signer, uint256 nonce);

    constructor() EIP712("Bull Street", "1") {}

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function nonceUsed(address signer, uint256 nonce) public view returns (bool) {
        return _nonceBits[signer][nonce >> 8] & (1 << (nonce & 0xff)) != 0;
    }

    function _useNonce(address signer, uint256 nonce) internal {
        uint256 word = nonce >> 8;
        uint256 bit = 1 << (nonce & 0xff);
        uint256 bits = _nonceBits[signer][word];
        if (bits & bit != 0) revert NonceUsed();
        _nonceBits[signer][word] = bits | bit;
        emit NonceUsedBy(signer, nonce);
    }

    /// @dev Returns the party (primary or delegate) whose signature is valid; reverts otherwise.
    function _verifyEither(address primary, address delegate, bytes32 structHash, bytes calldata sig)
        internal
        view
        returns (address)
    {
        bytes32 digest = _hashTypedDataV4(structHash);
        if (primary != address(0) && SignatureChecker.isValidSignatureNow(primary, digest, sig)) return primary;
        if (delegate != address(0) && SignatureChecker.isValidSignatureNow(delegate, digest, sig)) return delegate;
        revert BadSignature();
    }

    /// @dev Threshold check: `sigs` must come from distinct members of `isSigner`, ordered by ascending signer
    ///      address. Plain ECDSA (oracle signers are EOAs).
    function _verifyThreshold(
        bytes32 structHash,
        bytes[] calldata sigs,
        mapping(address => bool) storage isSigner,
        uint256 threshold
    ) internal view {
        bytes32 digest = _hashTypedDataV4(structHash);
        address last;
        uint256 valid;
        for (uint256 i; i < sigs.length; ++i) {
            (address s, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sigs[i]);
            if (err != ECDSA.RecoverError.NoError || !isSigner[s] || s <= last) revert BadSignature();
            last = s;
            ++valid;
        }
        if (valid < threshold) revert NotEnoughSigners();
    }
}
