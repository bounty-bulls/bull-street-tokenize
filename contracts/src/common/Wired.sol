// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Directory} from "./Directory.sol";

/// @title Wired
/// @notice Local copy of the Directory's addresses. `refreshWiring` (permissionless) re-reads them, so contracts
///         avoid an external call per lookup. Run it on every contract after `Directory.setAll`.
abstract contract Wired {
    struct W {
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

    Directory public immutable dir;
    W internal _w;

    event WiringRefreshed();

    constructor(Directory dir_) {
        dir = dir_;
    }

    function refreshWiring() public {
        Directory d = dir;
        _w = W({
            usdc: d.usdc(),
            treasury: d.treasury(),
            params: d.params(),
            sessionClock: d.sessionClock(),
            priceOracle: d.priceOracle(),
            compliance: d.compliance(),
            roles: d.roles(),
            assets: d.assets(),
            bondVault: d.bondVault(),
            brokers: d.brokers(),
            levelBook: d.levelBook(),
            pledges: d.pledges(),
            redemption: d.redemption(),
            exchange: d.exchange()
        });
        emit WiringRefreshed();
    }

    function wiring() external view returns (W memory) {
        return _w;
    }
}
