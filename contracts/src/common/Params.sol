// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Parameter keys. Money values are USDC (6 decimals), durations are seconds, ratios are basis points.
library K {
    bytes32 internal constant TIER_CAP_1 = "TIER_CAP_1";
    bytes32 internal constant TIER_CAP_2 = "TIER_CAP_2";
    bytes32 internal constant TIER_CAP_3 = "TIER_CAP_3";
    bytes32 internal constant MIN_BOND_1 = "MIN_BOND_1";
    bytes32 internal constant MIN_BOND_2 = "MIN_BOND_2";
    bytes32 internal constant MIN_BOND_3 = "MIN_BOND_3";
    bytes32 internal constant BOND_BPS = "BOND_BPS";
    bytes32 internal constant BOND_BPS_EXT = "BOND_BPS_EXT";
    bytes32 internal constant ATRISK_HEALTH_BPS = "ATRISK_HEALTH_BPS";
    bytes32 internal constant CURE_HEALTH_BPS = "CURE_HEALTH_BPS";
    bytes32 internal constant HEALTH_CURE = "HEALTH_CURE";
    bytes32 internal constant MINT_FEE_BPS = "MINT_FEE_BPS";
    bytes32 internal constant REDEEM_FEE_BPS = "REDEEM_FEE_BPS";
    bytes32 internal constant VOLUNTEER_REBATE_BPS = "VOLUNTEER_REBATE_BPS";
    bytes32 internal constant BROKER_FEE_SHARE_BPS = "BROKER_FEE_SHARE_BPS";
    bytes32 internal constant FLOOR_BPS = "FLOOR_BPS";
    bytes32 internal constant DEFAULT_BONUS_BPS = "DEFAULT_BONUS_BPS";
    bytes32 internal constant LATE_FEE_BPS = "LATE_FEE_BPS";
    bytes32 internal constant SMALL_MAX = "SMALL_MAX";
    bytes32 internal constant MAX_SCAN = "MAX_SCAN";
    bytes32 internal constant MAX_ALLOCS = "MAX_ALLOCS";
    bytes32 internal constant CURE_GRACE = "CURE_GRACE";
    bytes32 internal constant CURE_ESCROW_BPS = "CURE_ESCROW_BPS";
    bytes32 internal constant SOFT_SESSIONS = "SOFT_SESSIONS";
    bytes32 internal constant HARD_SESSIONS = "HARD_SESSIONS";
    bytes32 internal constant ATTEST_TTL = "ATTEST_TTL";
    bytes32 internal constant ATRISK_WINDOW = "ATRISK_WINDOW";
    bytes32 internal constant STALE_GRACE = "STALE_GRACE";
    bytes32 internal constant RELEASE_SESSIONS = "RELEASE_SESSIONS";
    bytes32 internal constant RELEASE_PENALTY_BPS = "RELEASE_PENALTY_BPS";
    bytes32 internal constant PENDING_PLEDGE_TTL = "PENDING_PLEDGE_TTL";
    bytes32 internal constant EXT_CLOSURE = "EXT_CLOSURE";
    bytes32 internal constant TAKER_FEE_BPS = "TAKER_FEE_BPS";
    bytes32 internal constant MAX_ORDER_TTL = "MAX_ORDER_TTL";
    bytes32 internal constant MIN_ORDER_VALUE = "MIN_ORDER_VALUE";
}

/// @title Params
/// @notice Owner-settable protocol parameters. Defaults match the real NSE calendar; a compressed-calendar
///         deployment overrides the time-based ones at deploy time.
contract Params is Ownable2Step {
    mapping(bytes32 => uint256) private _v;
    mapping(bytes32 => bool) public known;
    bytes32[] public keys;

    event ParamSet(bytes32 indexed key, uint256 value);

    error UnknownParam(bytes32 key);

    constructor(address owner_) Ownable(owner_) {
        _init(K.TIER_CAP_1, 2_000e6);
        _init(K.TIER_CAP_2, 20_000e6);
        _init(K.TIER_CAP_3, 200_000e6);
        _init(K.MIN_BOND_1, 2_200e6);
        _init(K.MIN_BOND_2, 22_000e6);
        _init(K.MIN_BOND_3, 220_000e6);
        _init(K.BOND_BPS, 11_000);
        _init(K.BOND_BPS_EXT, 12_500);
        _init(K.ATRISK_HEALTH_BPS, 12_000);
        _init(K.CURE_HEALTH_BPS, 10_000);
        _init(K.HEALTH_CURE, 24 hours);
        _init(K.MINT_FEE_BPS, 10);
        _init(K.REDEEM_FEE_BPS, 20);
        _init(K.VOLUNTEER_REBATE_BPS, 5);
        _init(K.BROKER_FEE_SHARE_BPS, 5_000);
        _init(K.FLOOR_BPS, 9_900);
        _init(K.DEFAULT_BONUS_BPS, 500);
        _init(K.LATE_FEE_BPS, 10);
        _init(K.SMALL_MAX, 10);
        _init(K.MAX_SCAN, 50);
        _init(K.MAX_ALLOCS, 8);
        _init(K.CURE_GRACE, 1 hours);
        _init(K.CURE_ESCROW_BPS, 12_000);
        _init(K.SOFT_SESSIONS, 2);
        _init(K.HARD_SESSIONS, 3);
        _init(K.ATTEST_TTL, 7 days);
        _init(K.ATRISK_WINDOW, 48 hours);
        _init(K.STALE_GRACE, 3 days);
        _init(K.RELEASE_SESSIONS, 2);
        _init(K.RELEASE_PENALTY_BPS, 50);
        _init(K.PENDING_PLEDGE_TTL, 15 days);
        _init(K.EXT_CLOSURE, 3 days);
        _init(K.TAKER_FEE_BPS, 10);
        _init(K.MAX_ORDER_TTL, 30 days);
        _init(K.MIN_ORDER_VALUE, 1e6);
    }

    function get(bytes32 key) external view returns (uint256) {
        if (!known[key]) revert UnknownParam(key);
        return _v[key];
    }

    function set(bytes32 key, uint256 value) external onlyOwner {
        if (!known[key]) revert UnknownParam(key);
        _v[key] = value;
        emit ParamSet(key, value);
    }

    function setMany(bytes32[] calldata ks, uint256[] calldata vs) external onlyOwner {
        for (uint256 i; i < ks.length; ++i) {
            if (!known[ks[i]]) revert UnknownParam(ks[i]);
            _v[ks[i]] = vs[i];
            emit ParamSet(ks[i], vs[i]);
        }
    }

    function keyCount() external view returns (uint256) {
        return keys.length;
    }

    function all() external view returns (bytes32[] memory ks, uint256[] memory vs) {
        ks = keys;
        vs = new uint256[](ks.length);
        for (uint256 i; i < ks.length; ++i) {
            vs[i] = _v[ks[i]];
        }
    }

    function _init(bytes32 key, uint256 value) private {
        known[key] = true;
        keys.push(key);
        _v[key] = value;
        emit ParamSet(key, value);
    }
}
