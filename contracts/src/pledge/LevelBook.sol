// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Directory} from "../common/Directory.sol";
import {Wired} from "../common/Wired.sol";
import {Level} from "../common/Types.sol";
import {IPledgeRegistry} from "../interfaces/IBullStreet.sol";

interface IPledgeIndex {
    function pledgeCountByBroker(address broker) external view returns (uint256);
    function pledgeOfBrokerAt(address broker, uint256 i) external view returns (uint256);
}

/// @title LevelBook
/// @notice Per asset, which pledges the redemption queue may draw from at each level (L1 drain, L2 volunteer,
///         L3 at-risk, L4 normal) and the exact free backing per level. L0 (reserve) lives in the engine.
///         `sync` is permissionless and idempotent: it re-reads a pledge's true level and free backing from the
///         registry and moves it. Time-based changes (an attestation nearing expiry) are picked up by keepers
///         calling `sync`; broker status changes by `requeueBroker`.
contract LevelBook is Wired {
    using EnumerableSet for EnumerableSet.UintSet;

    struct Entry {
        Level level;
        bool member;
        uint256 f;
    }

    mapping(uint32 => mapping(Level => EnumerableSet.UintSet)) private _members;
    mapping(uint32 => mapping(Level => uint256)) private _free;
    mapping(uint256 => Entry) private _entries;
    mapping(uint256 => uint32) private _assetOf;
    mapping(address => uint256) public requeueCursor;

    event LevelChanged(uint256 indexed pledgeId, Level from, Level to, bool member, uint256 f);

    constructor(Directory dir_) Wired(dir_) {
    }

    function sync(uint256 pledgeId) public {
        (bool member, uint32 assetId, uint256 f, Level level) = IPledgeRegistry(_w.pledges).levelInfo(pledgeId);
        Entry memory old = _entries[pledgeId];
        if (old.member == member && old.level == level && old.f == f) return;
        if (old.member) {
            _free[assetId][old.level] -= old.f;
            _members[assetId][old.level].remove(pledgeId);
        }
        if (member) {
            _free[assetId][level] += f;
            _members[assetId][level].add(pledgeId);
        }
        _entries[pledgeId] = Entry(level, member, member ? f : 0);
        _assetOf[pledgeId] = assetId;
        emit LevelChanged(pledgeId, old.level, level, member, f);
    }

    function syncMany(uint256[] calldata ids) external {
        for (uint256 i; i < ids.length; ++i) {
            sync(ids[i]);
        }
    }

    /// @notice After a broker drains or defaults, move its pledges to L1, `maxN` (<= 50) at a time.
    function requeueBroker(address broker, uint256 maxN) external returns (uint256 done, bool finished) {
        if (maxN > 50) maxN = 50;
        IPledgeIndex reg = IPledgeIndex(_w.pledges);
        uint256 n = reg.pledgeCountByBroker(broker);
        uint256 i = requeueCursor[broker];
        if (i >= n) i = 0;
        uint256 end = i + maxN < n ? i + maxN : n;
        for (; i < end; ++i) {
            sync(reg.pledgeOfBrokerAt(broker, i));
            ++done;
        }
        finished = end == n;
        requeueCursor[broker] = finished ? 0 : end;
    }

    function free(uint32 assetId, Level level) external view returns (uint256) {
        return _free[assetId][level];
    }

    function memberCount(uint32 assetId, Level level) external view returns (uint256) {
        return _members[assetId][level].length();
    }

    function memberAt(uint32 assetId, Level level, uint256 i) external view returns (uint256) {
        return _members[assetId][level].at(i);
    }

    function members(uint32 assetId, Level level) external view returns (uint256[] memory) {
        return _members[assetId][level].values();
    }

    function levelOf(uint256 pledgeId) external view returns (Level level, bool member) {
        Entry memory e = _entries[pledgeId];
        return (e.level, e.member);
    }

    function cachedFree(uint256 pledgeId) external view returns (uint256) {
        return _entries[pledgeId].f;
    }
}
