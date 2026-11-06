// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Directory} from "../common/Directory.sol";
import {Wired} from "../common/Wired.sol";
import {BrokerStatus} from "../common/Types.sol";
import {IBrokerRegistry, IRoleRegistry} from "../interfaces/IBullStreet.sol";
import {BondBelowRequirement, NotWired, WrongRole, ZeroAmount} from "../common/Errors.sol";

/// @title BondVault
/// @notice Holds each broker's USDC bond. The bond guarantees holder payouts: default claims, stale-pledge
///         slashing, late fees and release penalties are paid from it by the protocol contracts.
contract BondVault is Wired, ReentrancyGuard {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public bondOf;

    event BondDeposited(address indexed broker, uint256 amount);
    event BondWithdrawn(address indexed broker, uint256 amount);
    event BondPaid(address indexed broker, address indexed to, uint256 amount, bytes32 reason);

    constructor(Directory dir_) Wired(dir_) {
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!IRoleRegistry(_w.roles).isBroker(msg.sender)) revert WrongRole();
        IERC20(_w.usdc).safeTransferFrom(msg.sender, address(this), amount);
        bondOf[msg.sender] += amount;
        emit BondDeposited(msg.sender, amount);
        IBrokerRegistry(_w.brokers).onBondChanged(msg.sender);
    }

    /// @notice Withdraw down to the bond requirement. A Defaulted broker's bond stays for its claims;
    ///         an Exited broker (no exposure) can withdraw everything.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IBrokerRegistry reg = IBrokerRegistry(_w.brokers);
        BrokerStatus s = reg.statusOf(msg.sender);
        uint256 bond = bondOf[msg.sender];
        if (s == BrokerStatus.Defaulted || amount > bond) revert BondBelowRequirement();
        if (s != BrokerStatus.Exited && bond - amount < reg.requiredBond(msg.sender)) revert BondBelowRequirement();
        bondOf[msg.sender] = bond - amount;
        IERC20(_w.usdc).safeTransfer(msg.sender, amount);
        emit BondWithdrawn(msg.sender, amount);
        reg.onBondChanged(msg.sender);
    }

    /// @notice Pays up to `amount` from a broker's bond. Returns what was actually paid (the bond may be short).
    function payFromBond(address broker, address to, uint256 amount, bytes32 reason)
        external
        nonReentrant
        returns (uint256 paid)
    {
        if (msg.sender != _w.pledges && msg.sender != _w.redemption) revert NotWired();
        uint256 bond = bondOf[broker];
        paid = amount < bond ? amount : bond;
        if (paid == 0) return 0;
        bondOf[broker] = bond - paid;
        IERC20(_w.usdc).safeTransfer(to, paid);
        emit BondPaid(broker, to, paid, reason);
    }
}
