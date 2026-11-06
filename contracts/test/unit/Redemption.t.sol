// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "../utils/Base.t.sol";
import {
    Tier, BrokerStatus, Level, Pledge, Ticket, Allocation, AllocStatus, TicketStatus, TicketClass
} from "../../src/common/Types.sol";
import {K} from "../../src/common/Params.sol";
import {RedemptionEngine} from "../../src/redemption/RedemptionEngine.sol";
import "../../src/common/Errors.sol";

contract RedemptionTest is Base {
    uint256 internal pa; // alice @ X
    uint256 internal pc; // carol @ Y

    function setUp() public override {
        super.setUp();
        _join(brokerX, Tier.T1, 2_200e6);
        _join(brokerY, Tier.T1, 2_200e6);
        _join(brokerZ, Tier.T1, 2_200e6);
        pa = _openAndAttest(alice, REL, 100, brokerX);
        _mint(alice, pa, 60);
        vm.prank(alice);
        rel.transfer(bob, 60e18);
    }

    function _saturday() internal {
        _warpClose(4, 1 days); // Saturday after Friday's close; the next session is Monday (index 5)
    }

    function _firstAlloc(uint256 tid) internal view returns (uint256) {
        return engine.ticketAllocations(tid)[0];
    }

    // ------------------------------------------------------------------ pricing at the next session

    function test_weekendCrash_brokerLosesNothingHolderGetsMondayValue() public {
        _saturday();
        uint256 tid = _redeem(bob, REL, 20);
        uint256 al = _firstAlloc(tid);
        Allocation memory a = engine.allocationOf(al);
        assertEq(a.refSession, 5, "priced at Monday");
        assertEq(a.pledgeId, pa);

        _warpOpen(5, 2 hours); // after the cure window, before Monday's close is posted
        vm.expectRevert(PriceNotPosted.selector);
        this.settleExt(al, 20, 269e6);

        _warpClose(5, 1);
        _postPrice(REL, 5, 13.5e6); // Monday closes 10% lower
        uint256 b0 = usdc.balanceOf(bob);
        uint256 x0 = usdc.balanceOf(brokerX);
        _settle(al, 20, 269e6); // broker sold at 13.45
        assertEq(usdc.balanceOf(bob) - b0, 268.462e6, "Monday value minus 0.20%");
        // broker paid exactly its sale proceeds and earned half the fee back
        assertEq(int256(usdc.balanceOf(brokerX)) - int256(x0), -269e6 + 0.269e6);
        assertEq(rel.balanceOf(address(engine)), 0);
        Pledge memory p = pledges.pledgeOf(pa);
        assertEq(p.q, 80e18);
        assertEq(p.m, 40e18);
        _assertBacking(REL);
    }

    function test_settleFloorProtectsHolderFromLowReport() public {
        _saturday();
        uint256 al = _firstAlloc(_redeem(bob, REL, 20));
        _warpClose(5, 1);
        _postPrice(REL, 5, 15e6);
        uint256 b0 = usdc.balanceOf(bob);
        _settle(al, 20, 100e6); // reports a sale far below the close
        assertEq(usdc.balanceOf(bob) - b0, 296.406e6); // floor 0.99 x 300 = 297, minus 0.20%
    }

    function test_settleNotDuringCureWindow() public {
        _saturday();
        uint256 al = _firstAlloc(_redeem(bob, REL, 20));
        _warpOpen(5, 10 minutes);
        vm.expectRevert(CureWindowOpen.selector);
        this.settleExt(al, 20, 300e6);
    }

    function test_weekendRally_cureSettlesAtMondayClose() public {
        _saturday();
        uint256 al = _firstAlloc(_redeem(bob, REL, 20));
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        engine.cure(al); // escrows 20 x 15 x 1.2 = 360
        assertEq(a0 - usdc.balanceOf(alice), 360e6);

        _warpClose(5, 1);
        _postPrice(REL, 5, 16.5e6); // Monday closes 10% higher
        uint256 b0 = usdc.balanceOf(bob);
        engine.finalizeCure(al);
        assertEq(usdc.balanceOf(bob) - b0, 329.34e6, "Monday value minus 0.20%, not Friday's");
        assertEq(a0 - usdc.balanceOf(alice), 330e6, "minter paid Monday value; rest refunded");
        Pledge memory p = pledges.pledgeOf(pa);
        assertEq(p.q, 100e18, "shares stay pledged");
        assertEq(p.m, 40e18);
        assertEq(p.cured, 20e18);
        _assertBacking(REL);
    }

    function test_cureClosesAtDeadline() public {
        _saturday();
        uint256 al = _firstAlloc(_redeem(bob, REL, 20));
        _warpOpen(5, 1 hours);
        vm.prank(alice);
        vm.expectRevert(CureWindowClosed.selector);
        engine.cure(al);
    }

    // ------------------------------------------------------------------ defaults

    function test_default_afterHardDeadlinePaysBondWithBonusAndLateFee() public {
        _saturday();
        uint256 al = _firstAlloc(_redeem(bob, REL, 20));
        _warpClose(7, 1);
        vm.expectRevert(NotDue.selector);
        engine.claimDefault(al);
        _warpClose(8, 1); // hard deadline: close of session 5 + 3
        _postPrice(REL, 8, 15e6);
        uint256 b0 = usdc.balanceOf(bob);
        engine.claimDefault(al);
        // 20 x 15 x 1.05 = 315, plus a late fee of 0.10% x 300 for one session past the soft deadline
        assertEq(usdc.balanceOf(bob) - b0, 315.3e6);
        assertEq(uint8(brokers.statusOf(brokerX)), uint8(BrokerStatus.Defaulted));
        assertEq(uint8(engine.ticketOf(1).status), uint8(TicketStatus.Done));
        _assertBacking(REL);
    }

    function test_default_shortBondBurnsOnlyPaidAndRequeues() public {
        // a second, healthy pledge to absorb the requeued part
        pc = _openAndAttest(carol, REL, 100, brokerY);
        _mint(carol, pc, 100);
        vm.prank(carol);
        rel.transfer(bob, 100e18);
        // drain X's bond so the default cannot be fully covered
        _mint(alice, pa, 40);
        vm.prank(alice);
        rel.transfer(bob, 40e18);

        _saturday();
        uint256 tid = _redeem(bob, REL, 100); // best fit: alice's 100 at X
        uint256 al = _firstAlloc(tid);
        assertEq(engine.allocationOf(al).pledgeId, pa);
        _warpClose(8, 1);
        _postPrice(REL, 8, 25e6); // price spiked: due 100 x 25 x 1.05 + late > bond 2,200
        engine.claimDefault(al);
        Allocation memory a = engine.allocationOf(al);
        assertEq(a.paid, 2_200e6);
        Ticket memory t = engine.ticketOf(tid);
        assertGt(t.remaining, 0, "unpaid part re-queued");
        assertEq(vault.bondOf(brokerX), 0);
        assertGt(pledges.unbacked(REL), 0, "insolvent pledge written off");
        _assertBacking(REL);

        engine.continueAllocation(tid, new uint256[](0));
        uint256[] memory allocs = engine.ticketAllocations(tid);
        assertEq(engine.allocationOf(allocs[allocs.length - 1]).pledgeId, pc);
        _assertBacking(REL);
    }

    // ------------------------------------------------------------------ queue levels

    function test_levels_drainThenVolunteerThenNormal() public {
        uint256 pd = _openAndAttest(dev, REL, 100, brokerY); // volunteer
        _mint(dev, pd, 30);
        vm.prank(dev);
        pledges.setVolunteer(pd, true);
        pc = _openAndAttest(carol, REL, 100, brokerZ); // drain
        _mint(carol, pc, 20);
        vm.prank(brokerZ);
        brokers.setDraining();
        book.requeueBroker(brokerZ, 50);
        vm.prank(dev);
        rel.transfer(bob, 30e18);
        vm.prank(carol);
        rel.transfer(bob, 20e18);

        uint256 tid = _redeem(bob, REL, 70);
        uint256[] memory allocs = engine.ticketAllocations(tid);
        assertEq(allocs.length, 3);
        assertEq(engine.allocationOf(allocs[0]).pledgeId, pc, "L1 drain first");
        assertEq(engine.allocationOf(allocs[1]).pledgeId, pd, "L2 volunteer next");
        assertEq(engine.allocationOf(allocs[2]).pledgeId, pa, "L4 normal last");
        assertEq(engine.allocationOf(allocs[2]).units, 20e18);
        assertEq(uint8(engine.ticketOf(tid).cls), uint8(TicketClass.Large));
        _assertLedger(pa);
        _assertLedger(pc);
        _assertLedger(pd);
    }

    function test_hintCannotSkipALevel() public {
        uint256 pd = _openAndAttest(dev, REL, 100, brokerY);
        _mint(dev, pd, 30);
        vm.prank(dev);
        pledges.setVolunteer(pd, true);
        uint256[] memory hint = new uint256[](1);
        hint[0] = pa; // normal level while the volunteer level has free backing
        vm.startPrank(bob);
        rel.approve(address(engine), 20e18);
        vm.expectRevert(LevelOrderViolated.selector);
        engine.requestRedemption(REL, 20e18, hint);
        vm.stopPrank();
    }

    function test_volunteerRebateOnSettle() public {
        vm.prank(alice);
        pledges.setVolunteer(pa, true);
        _saturday();
        uint256 al = _firstAlloc(_redeem(bob, REL, 20));
        _warpClose(5, 1);
        _postPrice(REL, 5, 15e6);
        uint256 a0 = usdc.balanceOf(alice);
        _settle(al, 20, 300e6);
        assertEq(usdc.balanceOf(alice) - a0, 0.15e6, "0.05% of 300");
    }

    function test_partialAllocationContinues() public {
        params.set(K.MAX_ALLOCS, 1);
        pc = _openAndAttest(carol, REL, 100, brokerY);
        _mint(carol, pc, 30);
        vm.prank(carol);
        rel.transfer(bob, 30e18);
        uint256 tid = _redeem(bob, REL, 80);
        assertEq(uint8(engine.ticketOf(tid).status), uint8(TicketStatus.PartiallyAllocated));
        engine.continueAllocation(tid, new uint256[](0));
        assertEq(uint8(engine.ticketOf(tid).status), uint8(TicketStatus.Allocated));
        assertEq(engine.ticketOf(tid).remaining, 0);
    }

    function test_wholeSharesOnly() public {
        vm.startPrank(bob);
        rel.approve(address(engine), 1.5e18);
        vm.expectRevert(WholeSharesOnly.selector);
        engine.requestRedemption(REL, 1.5e18, new uint256[](0));
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ reserve

    function test_reserveServedFirstAndPaysAtRefClose() public {
        // a stale pledge slashed into the reserve
        pc = _openAndAttest(carol, REL, 100, brokerY);
        _mint(carol, pc, 10);
        vm.prank(carol);
        rel.transfer(bob, 10e18);
        vm.warp(block.timestamp + 10 days + 1);
        _postAll(8, 15e6);
        pledges.slashStale(pc);

        uint256 tid = _redeem(bob, REL, 25);
        uint256[] memory allocs = engine.ticketAllocations(tid);
        assertEq(engine.allocationOf(allocs[0]).pledgeId, 0, "reserve first");
        assertEq(engine.allocationOf(allocs[0]).units, 10e18);
        vm.expectRevert(PriceNotPosted.selector);
        engine.claimReserve(allocs[0]);

        Allocation memory a = engine.allocationOf(allocs[0]);
        _warpClose(a.refSession, 1);
        _postPrice(REL, a.refSession, 15e6);
        uint256 b0 = usdc.balanceOf(bob);
        engine.claimReserve(allocs[0]);
        assertEq(usdc.balanceOf(bob) - b0, 149.7e6);
        _assertBacking(REL);
    }

    // ------------------------------------------------------------------ batching

    function test_smallTicketsBatchAndClaimProRata() public {
        vm.prank(bob);
        rel.transfer(eve, 3e18);
        vm.prank(bob);
        rel.transfer(fay, 4e18);
        _saturday();
        uint256 te = _redeem(eve, REL, 3);
        uint256 tf = _redeem(fay, REL, 4);
        assertEq(uint8(engine.ticketOf(te).cls), uint8(TicketClass.Small));
        vm.expectRevert(BatchNotReady.selector);
        engine.processBatch(REL, new uint256[](0));

        _warpOpen(5, 1 minutes); // Monday open: the batch is allocated, priced at Tuesday's close
        uint256 agg = engine.processBatch(REL, new uint256[](0));
        uint256 al = engine.ticketAllocations(agg)[0];
        assertEq(engine.allocationOf(al).refSession, 6);
        _warpClose(6, 1);
        _postPrice(REL, 6, 15e6);
        _settle(al, 7, 105e6);

        uint256 e0 = usdc.balanceOf(eve);
        engine.claimBatch(te);
        uint256 f0 = usdc.balanceOf(fay);
        engine.claimBatch(tf);
        uint256 pot = 105e6 - 0.21e6;
        assertEq(usdc.balanceOf(eve) - e0, pot * 3 / 7);
        assertEq(usdc.balanceOf(fay) - f0, pot - pot * 3 / 7, "last claimer takes the dust");
        _assertBacking(REL);
    }

    // helper so expectRevert targets the settle call itself
    function settleExt(uint256 al, uint256 shares, uint256 gross) external {
        _settle(al, shares, gross);
    }
}
