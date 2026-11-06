// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Attestations, TypeHashes} from "../common/Attestations.sol";
import {SignerSet} from "../common/SignerSet.sol";
import {Directory} from "../common/Directory.sol";
import {Wired} from "../common/Wired.sol";
import {K} from "../common/Params.sol";
import {IParams} from "../interfaces/IBullStreet.sol";
import {BadSessions, SessionsNotPosted} from "../common/Errors.sol";
import {Deadlines} from "../common/Types.sol";

/// @title SessionClock
/// @notice The NSE trading calendar on-chain. Sessions are posted ahead of time in contiguous batches signed by
///         the oracle signer set. The same contract runs the real NSE calendar or a compressed one; only the
///         posted sessions and the time parameters differ.
contract SessionClock is Wired, Attestations, SignerSet {
    struct SessionInfo {
        uint32 sessionIndex;
        uint64 openTime;
        uint64 closeTime;
    }

    struct Session {
        uint64 openTime;
        uint64 closeTime;
    }

    Session[] private _sessions;

    event SessionsPosted(uint32 fromIndex, uint32 count);

    constructor(Directory dir_, address owner_, address[] memory signers_, uint256 threshold_) Ownable(owner_) Wired(dir_) {
        _setSigners(signers_, threshold_);
    }

    // ------------------------------------------------------------------ posting

    function postSessions(SessionInfo[] calldata s, uint256 nonce, bytes[] calldata sigs) external {
        bytes32[] memory hashes = new bytes32[](s.length);
        for (uint256 i; i < s.length; ++i) {
            hashes[i] = keccak256(abi.encode(TypeHashes.SESSION_INFO, s[i].sessionIndex, s[i].openTime, s[i].closeTime));
        }
        bytes32 structHash = keccak256(abi.encode(TypeHashes.SESSION_BATCH, keccak256(abi.encodePacked(hashes)), nonce));
        _verifyThreshold(structHash, sigs, isSigner, threshold);
        _useNonce(address(this), nonce);

        uint256 n = _sessions.length;
        uint64 lastClose = n == 0 ? 0 : _sessions[n - 1].closeTime;
        for (uint256 i; i < s.length; ++i) {
            if (s[i].sessionIndex != n + i) revert BadSessions();
            if (s[i].openTime >= s[i].closeTime || s[i].openTime < lastClose) revert BadSessions();
            lastClose = s[i].closeTime;
            _sessions.push(Session(s[i].openTime, s[i].closeTime));
        }
        emit SessionsPosted(uint32(n), uint32(s.length));
    }

    // ------------------------------------------------------------------ views

    function count() external view returns (uint256) {
        return _sessions.length;
    }

    function sessionAt(uint256 i) public view returns (uint64 openTime, uint64 closeTime) {
        if (i >= _sessions.length) revert SessionsNotPosted();
        Session memory s = _sessions[i];
        return (s.openTime, s.closeTime);
    }

    /// @notice Number of sessions whose open time is <= t (so the last of them is the latest started session).
    function _startedBy(uint64 t) internal view returns (uint256 lo) {
        uint256 hi = _sessions.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) >> 1;
            if (_sessions[mid].openTime <= t) lo = mid + 1;
            else hi = mid;
        }
    }

    function isOpenAt(uint64 t) public view returns (bool) {
        uint256 n = _startedBy(t);
        return n > 0 && t < _sessions[n - 1].closeTime;
    }

    function isOpen() public view returns (bool) {
        return isOpenAt(uint64(block.timestamp));
    }

    /// @notice Index of the first session that opens strictly after `t`.
    function nextSessionIndexAt(uint64 t) public view returns (uint32) {
        uint256 n = _startedBy(t);
        if (n >= _sessions.length) revert SessionsNotPosted();
        return uint32(n);
    }

    function nextSessionIndex() external view returns (uint32) {
        return nextSessionIndexAt(uint64(block.timestamp));
    }

    function nextSessionOpen() public view returns (uint64) {
        return _sessions[nextSessionIndexAt(uint64(block.timestamp))].openTime;
    }

    /// @notice Latest session whose close is <= now. `found` is false before the first close.
    function lastClosedSession() public view returns (bool found, uint32 idx) {
        uint256 n = _startedBy(uint64(block.timestamp));
        if (n == 0) return (false, 0);
        if (_sessions[n - 1].closeTime <= block.timestamp) return (true, uint32(n - 1));
        if (n >= 2) return (true, uint32(n - 2));
        return (false, 0);
    }

    function isClosed(uint32 idx) public view returns (bool) {
        return idx < _sessions.length && _sessions[idx].closeTime <= block.timestamp;
    }

    /// @notice Market closed now and the next open is more than EXT_CLOSURE away (a long weekend or holidays).
    function extendedClosure() external view returns (bool) {
        if (isOpen()) return false;
        uint256 n = _startedBy(uint64(block.timestamp));
        if (n >= _sessions.length) return true;
        return _sessions[n].openTime - block.timestamp > IParams(_w.params).get(K.EXT_CLOSURE);
    }

    /// @notice Redemption deadlines for a request made at `t`.
    ///         refSession = first session opening after t (so a full notice window always exists);
    ///         cure = refSession open + CURE_GRACE (capped at its close); soft/hard = close of refSession + 2 / + 3.
    function deadlines(uint64 t) public view returns (Deadlines memory d) {
        IParams p = IParams(_w.params);
        uint32 c = nextSessionIndexAt(t);
        uint32 softIdx = c + uint32(p.get(K.SOFT_SESSIONS));
        uint32 hardIdx = c + uint32(p.get(K.HARD_SESSIONS));
        if (hardIdx >= _sessions.length) revert SessionsNotPosted();
        Session memory ref = _sessions[c];
        uint64 cure = ref.openTime + uint64(p.get(K.CURE_GRACE));
        if (cure > ref.closeTime) cure = ref.closeTime;
        d = Deadlines({
            refSession: c,
            softSession: softIdx,
            hardSession: hardIdx,
            cure: cure,
            soft: _sessions[softIdx].closeTime,
            hard: _sessions[hardIdx].closeTime
        });
    }

    /// @notice Close of session (current or next) + n sessions; used for release deadlines.
    function closeAfterSessions(uint256 n) external view returns (uint64) {
        uint256 started = _startedBy(uint64(block.timestamp));
        uint256 base = started == 0 ? 0 : started - 1;
        if (started > 0 && _sessions[base].closeTime <= block.timestamp) base = started; // market closed: next one
        uint256 idx = base + n;
        if (idx >= _sessions.length) revert SessionsNotPosted();
        return _sessions[idx].closeTime;
    }

    /// @notice Sessions in [from, from+n) for the app's calendar strip.
    function sessionsFrom(uint256 from, uint256 n) external view returns (Session[] memory out) {
        uint256 end = from + n;
        if (end > _sessions.length) end = _sessions.length;
        if (from >= end) return out;
        out = new Session[](end - from);
        for (uint256 i = from; i < end; ++i) {
            out[i - from] = _sessions[i];
        }
    }
}
