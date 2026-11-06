// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "../utils/Base.t.sol";
import {Tier, Pledge, Allocation, AllocStatus} from "../../src/common/Types.sol";
import {BullStreetExchange} from "../../src/exchange/BullStreetExchange.sol";
import {RedemptionEngine} from "../../src/redemption/RedemptionEngine.sol";
import {PledgeRegistry} from "../../src/pledge/PledgeRegistry.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Drives random protocol actions; the invariant test checks backing and escrow after every call.
contract Handler is Base {
    uint256[] public pledgeIds;
    uint256[] public allocIds;
    uint256[] public orderIds;
    uint32 public session = 1;

    function init() external {
        setUp();
        _join(brokerX, Tier.T1, 2_200e6);
        _join(brokerY, Tier.T1, 2_200e6);
        pledgeIds.push(_openAndAttest(alice, REL, 100, brokerX));
        pledgeIds.push(_openAndAttest(carol, REL, 100, brokerY));
        pledgeIds.push(_openAndAttest(dev, REL, 30, brokerY));
        address[3] memory who = [alice, carol, bob];
        for (uint256 i; i < who.length; ++i) {
            vm.prank(who[i]);
            rel.approve(address(exchange), type(uint256).max);
            vm.prank(who[i]);
            rel.approve(address(engine), type(uint256).max);
        }
    }

    function _minterOf(uint256 id) internal view returns (address) {
        return pledges.pledgeOf(id).minter;
    }

    function mint(uint256 i, uint256 shares) external {
        uint256 id = pledgeIds[i % pledgeIds.length];
        shares = bound(shares, 1, 40);
        vm.prank(_minterOf(id));
        try pledges.mint(id, shares) {} catch {}
    }

    function burn(uint256 i, uint256 shares) external {
        uint256 id = pledgeIds[i % pledgeIds.length];
        shares = bound(shares, 1, 40);
        vm.prank(_minterOf(id));
        try pledges.burnAgainst(id, shares * 1e18) {} catch {}
    }

    function sellToBob(uint256 i, uint256 shares) external {
        address m = _minterOf(pledgeIds[i % pledgeIds.length]);
        shares = bound(shares, 1, 20);
        if (rel.balanceOf(m) < shares * 1e18) return;
        vm.prank(m);
        (, uint256 ask) = exchange.trade(
            BullStreetExchange.TradeParams(REL, BullStreetExchange.Side.Sell, 15e6, shares * 1e18, new uint256[](0), true, 0, 0)
        );
        orderIds.push(ask);
        uint256[] memory ids = new uint256[](1);
        ids[0] = ask;
        vm.prank(bob);
        try exchange.trade(
            BullStreetExchange.TradeParams(REL, BullStreetExchange.Side.Buy, 15e6, shares * 1e18, ids, false, 0, 0)
        ) {} catch {}
    }

    function postBid(uint256 shares) external {
        shares = bound(shares, 1, 10);
        vm.prank(bob);
        try exchange.trade(
            BullStreetExchange.TradeParams(REL, BullStreetExchange.Side.Buy, 14e6, shares * 1e18, new uint256[](0), true, 0, 0)
        ) returns (uint256, uint256 id) {
            orderIds.push(id);
        } catch {}
    }

    function cancelOrder(uint256 i) external {
        if (orderIds.length == 0) return;
        uint256 id = orderIds[i % orderIds.length];
        BullStreetExchange.Order memory o = exchange.getOrder(id);
        vm.prank(o.maker);
        try exchange.cancel(id) {} catch {}
    }

    function redeem(uint256 shares) external {
        shares = bound(shares, 1, 30);
        if (rel.balanceOf(bob) < shares * 1e18) return;
        vm.prank(bob);
        try engine.requestRedemption(REL, shares * 1e18, new uint256[](0)) returns (uint256 tid) {
            uint256[] memory a = engine.ticketAllocations(tid);
            for (uint256 k; k < a.length; ++k) {
                allocIds.push(a[k]);
            }
        } catch {}
    }

    function cure(uint256 i) external {
        if (allocIds.length == 0) return;
        uint256 id = allocIds[i % allocIds.length];
        Allocation memory al = engine.allocationOf(id);
        if (al.pledgeId == 0) return;
        vm.prank(_minterOf(al.pledgeId));
        try engine.cure(id) {} catch {}
    }

    function settleOrFinalize(uint256 i, uint256 grossBps) external {
        if (allocIds.length == 0) return;
        uint256 id = allocIds[i % allocIds.length];
        Allocation memory al = engine.allocationOf(id);
        if (al.status == AllocStatus.CurePending) {
            try engine.finalizeCure(id) {} catch {}
            return;
        }
        if (al.pledgeId == 0) {
            try engine.claimReserve(id) {} catch {}
            return;
        }
        grossBps = bound(grossBps, 9_000, 11_000);
        uint256 gross = al.units / 1e18 * 15e6 * grossBps / 10_000;
        try this.settleExt(id, al.units / 1e18, gross) {} catch {}
    }

    function settleExt(uint256 id, uint256 shares, uint256 gross) external {
        _settle(id, shares, gross);
    }

    function claimDefault(uint256 i) external {
        if (allocIds.length == 0) return;
        try engine.claimDefault(allocIds[i % allocIds.length]) {} catch {}
    }

    function nextSession(uint256 priceBps) external {
        if (session >= 50) return;
        priceBps = bound(priceBps, 8_000, 12_000);
        _warpClose(session, 1);
        _postAll(session, 15e6 * priceBps / 10_000);
        ++session;
        // keep pledges attested
        for (uint256 k; k < pledgeIds.length; ++k) {
            uint256 id = pledgeIds[k];
            Pledge memory p = pledges.pledgeOf(id);
            if (p.attestedUntil < block.timestamp + 2 days) {
                uint256 shares = rel.toShares(p.q - p.a);
                try this.reattestExt(id, shares) {} catch {}
            }
        }
    }

    function reattestExt(uint256 id, uint256 shares) external {
        Pledge memory p = pledges.pledgeOf(id);
        PledgeRegistry.PledgeAttestation memory a =
            _pledgeAttestation(id, shares, uint64(block.timestamp + 7 days), p.psnHash);
        pledges.reattest(a, _signPledge(_keyOf(p.broker), a));
    }

    // ------------------------------------------------------------------ views for the invariant test

    function pledgeCount() external view returns (uint256) {
        return pledgeIds.length;
    }

    function orderCount() external view returns (uint256) {
        return orderIds.length;
    }

    function checkBacking() external view {
        _assertBacking(REL);
        for (uint256 k; k < pledgeIds.length; ++k) {
            _assertLedger(pledgeIds[k]);
        }
    }

    function checkExchangeEscrow() external view {
        uint256 tokens;
        uint256 cash;
        for (uint256 k; k < orderIds.length; ++k) {
            BullStreetExchange.Order memory o = exchange.getOrder(orderIds[k]);
            if (o.status != BullStreetExchange.OrderStatus.Open) continue;
            if (o.side == BullStreetExchange.Side.Sell) tokens += o.remaining;
            else cash += o.usdcEscrow;
        }
        assertEq(rel.balanceOf(address(exchange)), tokens, "exchange token escrow");
        assertEq(usdc.balanceOf(address(exchange)), cash, "exchange usdc escrow");
    }
}

contract ProtocolInvariantTest is Test {
    Handler internal h;

    function setUp() public {
        h = new Handler();
        h.init();
        bytes4[] memory sel = new bytes4[](11);
        sel[0] = Handler.mint.selector;
        sel[1] = Handler.burn.selector;
        sel[2] = Handler.sellToBob.selector;
        sel[3] = Handler.postBid.selector;
        sel[4] = Handler.cancelOrder.selector;
        sel[5] = Handler.redeem.selector;
        sel[6] = Handler.cure.selector;
        sel[7] = Handler.settleOrFinalize.selector;
        sel[8] = Handler.claimDefault.selector;
        sel[9] = Handler.nextSession.selector;
        sel[10] = Handler.redeem.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
        targetContract(address(h));
    }

    /// I1 + I2: supply = Σ m + reserve + unbacked, and 0 <= a <= m <= q on every pledge.
    function invariant_backing() public view {
        h.checkBacking();
    }

    /// The exchange holds exactly what open orders escrow.
    function invariant_exchangeEscrow() public view {
        h.checkExchangeEscrow();
    }
}
