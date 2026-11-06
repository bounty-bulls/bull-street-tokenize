// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "../utils/Base.t.sol";
import {Tier, Pledge, Allocation, TicketStatus, BrokerStatus} from "../../src/common/Types.sol";
import {PledgeRegistry} from "../../src/pledge/PledgeRegistry.sol";
import {BullStreetExchange} from "../../src/exchange/BullStreetExchange.sol";

contract ScenariosTest is Base {
    function setUp() public override {
        super.setUp();
        _join(brokerX, Tier.T1, 2_200e6);
        _join(brokerY, Tier.T1, 2_200e6);
    }

    function _ledger(uint256 id, uint256 q, uint256 m, uint256 a) internal view {
        Pledge memory p = pledges.pledgeOf(id);
        assertEq(p.q, q * 1e18, "q");
        assertEq(p.m, m * 1e18, "m");
        assertEq(p.a, a * 1e18, "a");
        _assertBacking(REL);
    }

    /// @notice CONTEXT.md §6.1 worked ledger: Alice, 100 RELIANCE, close 15.
    function test_workedLedger() public {
        uint256 id = _openAndAttest(alice, REL, 100, brokerX); // 1. attest
        _ledger(id, 100, 0, 0);
        _mint(alice, id, 60); // 2. mint 60
        _ledger(id, 100, 60, 0);
        vm.prank(alice);
        rel.transfer(bob, 25e18);
        _warpClose(4, 1 days);
        uint256 t10 = _redeem(bob, REL, 10); // 3. allocate 25 (10 + 15)
        uint256 t15 = _redeem(bob, REL, 15);
        _ledger(id, 100, 60, 25);
        uint256 a10 = engine.ticketAllocations(t10)[0];
        uint256 a15 = engine.ticketAllocations(t15)[0];

        vm.prank(alice);
        engine.cure(a10); // 4. cure 10
        _warpClose(5, 1);
        _postPrice(REL, 5, 15e6);
        engine.finalizeCure(a10);
        _ledger(id, 100, 50, 15);

        _settle(a15, 15, 225e6); // 5. settle 15
        _ledger(id, 85, 35, 0);

        vm.prank(alice);
        pledges.requestRelease(id, 30); // 6. release 30
        PledgeRegistry.ReleaseConfirmation memory c = PledgeRegistry.ReleaseConfirmation(id, 30, nonceSeq++);
        pledges.confirmRelease(c, _signRelease(xKey, c));
        _ledger(id, 55, 35, 0);

        vm.prank(alice);
        pledges.burnAgainst(id, 35e18); // 7. burn 35
        _ledger(id, 55, 0, 0);

        vm.prank(alice);
        pledges.requestRelease(id, 55); // 8. release 55
        c = PledgeRegistry.ReleaseConfirmation(id, 55, nonceSeq++);
        pledges.confirmRelease(c, _signRelease(xKey, c));
        _ledger(id, 0, 0, 0);
        assertEq(brokers.exposureUnits(brokerX, REL), 0);
    }

    /// @notice A week: Monday pledge, Saturday mint and sell peer to peer, Sunday redemptions,
    ///         Monday cure and settle, Thursday a default.
    function test_weekInTheLife() public {
        // Monday: pledges attested
        uint256 pa = _openAndAttest(alice, REL, 100, brokerX);
        uint256 pc = _openAndAttest(carol, REL, 100, brokerY);
        for (uint32 s = 1; s <= 4; ++s) {
            _warpClose(s, 1);
            _postAll(s, 15e6);
        }

        // Saturday: NSE closed, Alice mints 100 and lists 60; Bob buys them on the order book
        _warpClose(4, 1 days);
        _mint(alice, pa, 100);
        _mint(carol, pc, 20);
        vm.startPrank(alice);
        rel.approve(address(exchange), type(uint256).max);
        (, uint256 ask) = exchange.trade(
            BullStreetExchange.TradeParams(REL, BullStreetExchange.Side.Sell, 15.3e6, 60e18, new uint256[](0), true, 0, 0)
        );
        vm.stopPrank();
        uint256[] memory ids = new uint256[](1);
        ids[0] = ask;
        vm.prank(bob);
        exchange.trade(
            BullStreetExchange.TradeParams(REL, BullStreetExchange.Side.Buy, 15.3e6, 60e18, ids, false, 0, 60e18)
        );
        assertEq(rel.balanceOf(bob), 60e18);
        _assertBacking(REL);

        // Sunday: three redemptions (one per minter path)
        vm.prank(carol);
        rel.transfer(eve, 20e18);
        uint256 t1 = _redeem(bob, REL, 30);
        uint256 t2 = _redeem(bob, REL, 20);
        uint256 t3 = _redeem(eve, REL, 20);
        uint256 a1 = engine.ticketAllocations(t1)[0];
        uint256 a2 = engine.ticketAllocations(t2)[0];
        uint256 a3 = engine.ticketAllocations(t3)[0];
        _assertBacking(REL);

        // Monday: one cure, one settle
        vm.prank(engine.allocationOf(a1).pledgeId == pa ? alice : carol);
        engine.cure(a1);
        _warpClose(5, 1);
        _postAll(5, 14.5e6);
        engine.finalizeCure(a1);
        _settle(a2, 20, 290e6);
        _assertBacking(REL);

        // Thursday: the third allocation was never served, so the bond pays
        _warpClose(8, 1);
        for (uint32 s = 6; s <= 8; ++s) {
            _postAll(s, 14.5e6);
        }
        engine.claimDefault(a3);
        assertEq(uint8(engine.ticketOf(t1).status), uint8(TicketStatus.Done));
        assertEq(uint8(engine.ticketOf(t2).status), uint8(TicketStatus.Done));
        assertEq(uint8(engine.ticketOf(t3).status), uint8(TicketStatus.Done));
        Allocation memory d = engine.allocationOf(a3);
        address defaulted = pledges.pledgeOf(d.pledgeId).broker;
        assertEq(uint8(brokers.statusOf(defaulted)), uint8(BrokerStatus.Defaulted));
        _assertBacking(REL);
        _assertLedger(pa);
        _assertLedger(pc);
    }
}
