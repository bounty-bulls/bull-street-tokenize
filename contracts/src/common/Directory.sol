// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title Directory
/// @notice Address book for the protocol. Every contract reads its peers from here, so wiring is one place
///         and deploy order has no circular constructor arguments.
contract Directory is Ownable2Step {
    address public usdc;
    address public treasury;
    address public params;
    address public sessionClock;
    address public priceOracle;
    address public compliance;
    address public roles;
    address public assets;
    address public bondVault;
    address public brokers;
    address public levelBook;
    address public pledges;
    address public redemption;
    address public exchange;

    event Set(bytes32 indexed name, address value);

    constructor(address owner_) Ownable(owner_) {}

    struct Addresses {
        address usdc;
        address treasury;
        address params;
        address sessionClock;
        address priceOracle;
        address compliance;
        address roles;
        address assets;
        address bondVault;
        address brokers;
        address levelBook;
        address pledges;
        address redemption;
        address exchange;
    }

    function setAll(Addresses calldata a) external onlyOwner {
        usdc = a.usdc;
        treasury = a.treasury;
        params = a.params;
        sessionClock = a.sessionClock;
        priceOracle = a.priceOracle;
        compliance = a.compliance;
        roles = a.roles;
        assets = a.assets;
        bondVault = a.bondVault;
        brokers = a.brokers;
        levelBook = a.levelBook;
        pledges = a.pledges;
        redemption = a.redemption;
        exchange = a.exchange;
        emit Set("all", address(0));
    }

    function setTreasury(address t) external onlyOwner {
        treasury = t;
        emit Set("treasury", t);
    }
}
