// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Denied, Paused} from "../common/Errors.sol";

/// @title Compliance
/// @notice Denylist, global and per-asset pauses, and the corporate-action freeze. Every token transfer, mint
///         and burn passes through `check`.
contract Compliance is Ownable2Step {
    mapping(address => bool) public isDenied;
    bool public globalPause;
    mapping(uint32 => bool) public assetPause;
    mapping(uint32 => bool) public frozen;

    event DeniedSet(address indexed account, bool denied);
    event GlobalPauseSet(bool paused);
    event AssetPauseSet(uint32 indexed assetId, bool paused);
    event CorporateActionFreezeSet(uint32 indexed assetId, bool frozen);

    constructor(address owner_) Ownable(owner_) {}

    function setDenied(address account, bool denied) external onlyOwner {
        isDenied[account] = denied;
        emit DeniedSet(account, denied);
    }

    function setGlobalPause(bool p) external onlyOwner {
        globalPause = p;
        emit GlobalPauseSet(p);
    }

    function setAssetPause(uint32 assetId, bool p) external onlyOwner {
        assetPause[assetId] = p;
        emit AssetPauseSet(assetId, p);
    }

    function setCorporateActionFreeze(uint32 assetId, bool f) external onlyOwner {
        frozen[assetId] = f;
        emit CorporateActionFreezeSet(assetId, f);
    }

    function tradingPaused(uint32 assetId) public view returns (bool) {
        return globalPause || assetPause[assetId] || frozen[assetId];
    }

    /// @dev Mint (from = 0) and burn (to = 0) respect pauses but skip the denylist for the zero address.
    function check(address from, address to, uint32 assetId) external view {
        if (tradingPaused(assetId)) revert Paused();
        if ((from != address(0) && isDenied[from]) || (to != address(0) && isDenied[to])) revert Denied();
    }
}
