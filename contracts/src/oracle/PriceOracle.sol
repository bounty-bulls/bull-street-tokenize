// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Attestations, TypeHashes} from "../common/Attestations.sol";
import {SignerSet} from "../common/SignerSet.sol";
import {Directory} from "../common/Directory.sol";
import {ISessionClock} from "../interfaces/IBullStreet.sol";
import {BadParam, OldPrice, PriceNotPosted, PriceStale, SessionNotClosed} from "../common/Errors.sol";

/// @title PriceOracle
/// @notice NSE closing prices in USDC per share (6 decimals), one per asset per closed session, signed by the
///         oracle signer set (m-of-n). Every past close is kept: redemptions are priced at the close of a specific
///         session.
contract PriceOracle is Attestations, SignerSet {
    struct Latest {
        uint256 close;
        uint32 session;
        uint64 asOf;
        bool set;
    }

    Directory public immutable dir;
    mapping(uint32 => Latest) private _latest;
    mapping(uint32 => mapping(uint32 => uint256)) private _closeAt;

    event PriceUpdated(uint32 indexed assetId, uint256 close, uint32 indexed sessionIndex, uint64 asOf);

    constructor(Directory dir_, address owner_, address[] memory signers_, uint256 threshold_) Ownable(owner_) {
        dir = dir_;
        _setSigners(signers_, threshold_);
    }

    function postBatch(
        uint32 sessionIndex,
        uint32[] calldata assetIds,
        uint256[] calldata closes,
        uint64 asOf,
        uint256 nonce,
        bytes[] calldata sigs
    ) external {
        if (assetIds.length != closes.length || assetIds.length == 0) revert BadParam();
        bytes32 structHash = keccak256(
            abi.encode(
                TypeHashes.PRICE_BATCH,
                sessionIndex,
                keccak256(abi.encodePacked(assetIds)),
                keccak256(abi.encodePacked(closes)),
                asOf,
                nonce
            )
        );
        _verifyThreshold(structHash, sigs, isSigner, threshold);
        _useNonce(address(this), nonce);
        if (!ISessionClock(dir.sessionClock()).isClosed(sessionIndex)) revert SessionNotClosed();

        for (uint256 i; i < assetIds.length; ++i) {
            uint32 a = assetIds[i];
            if (closes[i] == 0) revert BadParam();
            Latest storage l = _latest[a];
            if (l.set && sessionIndex <= l.session) revert OldPrice();
            _latest[a] = Latest(closes[i], sessionIndex, asOf, true);
            _closeAt[a][sessionIndex] = closes[i];
            emit PriceUpdated(a, closes[i], sessionIndex, asOf);
        }
    }

    function closeOf(uint32 assetId) external view returns (uint256 close, uint32 session, uint64 asOf) {
        Latest memory l = _latest[assetId];
        if (!l.set) revert PriceNotPosted();
        return (l.close, l.session, l.asOf);
    }

    /// @notice Close of a specific session, or 0 if it was not posted.
    function closeAt(uint32 assetId, uint32 session) external view returns (uint256) {
        return _closeAt[assetId][session];
    }

    function hasPrice(uint32 assetId) external view returns (bool) {
        return _latest[assetId].set;
    }

    /// @notice Stale when the latest posted close is older than the last closed session.
    function isStale(uint32 assetId) public view returns (bool) {
        Latest memory l = _latest[assetId];
        if (!l.set) return true;
        (bool found, uint32 last) = ISessionClock(dir.sessionClock()).lastClosedSession();
        return found && l.session < last;
    }

    function freshClose(uint32 assetId) external view returns (uint256) {
        if (isStale(assetId)) revert PriceStale();
        return _latest[assetId].close;
    }
}
