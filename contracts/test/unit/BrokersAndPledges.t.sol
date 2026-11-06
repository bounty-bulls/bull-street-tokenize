// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "../utils/Base.t.sol";
import {Tier, BrokerStatus, PledgeStatus, Level, Pledge} from "../../src/common/Types.sol";
import {PledgeRegistry} from "../../src/pledge/PledgeRegistry.sol";
import "../../src/common/Errors.sol";

contract BrokersAndPledgesTest is Base {
    function setUp() public override {
        super.setUp();
        _join(brokerX, Tier.T1, 2_200e6);
        _join(brokerY, Tier.T1, 2_200e6);
    }

    // ------------------------------------------------------------------ brokers

    function test_broker_joinRules() public {
        vm.prank(alice);
        vm.expectRevert(WrongRole.selector);
        brokers.join(Tier.T1, keccak256("bo-a"), address(0), "A");

        vm.prank(brokerZ);
        vm.expectRevert(BoIdTaken.selector);
        brokers.join(Tier.T1, keccak256(abi.encode("bo", brokerX)), address(0), "Z");

        vm.prank(brokerZ);
        brokers.join(Tier.T2, keccak256("bo-z"), address(0), "Z");
        assertEq(uint8(brokers.statusOf(brokerZ)), uint8(BrokerStatus.Pending));
        vm.prank(brokerZ);
        vault.deposit(21_999e6);
        assertEq(uint8(brokers.statusOf(brokerZ)), uint8(BrokerStatus.Pending));
        vm.prank(brokerZ);
        vault.deposit(1e6);
        assertEq(uint8(brokers.statusOf(brokerZ)), uint8(BrokerStatus.Active));
    }

    function test_broker_withdrawKeepsRequirement() public {
        uint256 id = _openAndAttest(alice, REL, 100, brokerX); // 1,500 USDC exposure, 1,650 required
        id;
        assertEq(brokers.requiredBond(brokerX), 1_650e6);
        vm.prank(brokerX);
        vm.expectRevert(BondBelowRequirement.selector);
        vault.withdraw(600e6);
        vm.prank(brokerX);
        vault.withdraw(550e6);
        assertEq(vault.bondOf(brokerX), 1_650e6);
        // fell below the tier minimum: no longer takes new pledges
        assertEq(uint8(brokers.statusOf(brokerX)), uint8(BrokerStatus.Pending));
    }

    function test_broker_healthCureThenDraining() public {
        _openAndAttest(alice, REL, 100, brokerX);
        assertEq(brokers.health(brokerX), 13_333);
        _warpClose(1, 1);
        _postPrice(REL, 1, 21e6); // exposure 2,100 -> required 2,310 > bond 2,200
        brokers.poke(brokerX);
        assertGt(brokers.brokerOf(brokerX).healthLowSince, 0);
        vm.warp(block.timestamp + 24 hours);
        brokers.poke(brokerX);
        assertEq(uint8(brokers.statusOf(brokerX)), uint8(BrokerStatus.Draining));
    }

    function test_broker_exitWhenDrained() public {
        vm.prank(brokerY);
        brokers.setDraining();
        vm.prank(brokerY);
        brokers.exit();
        vm.prank(brokerY);
        vault.withdraw(2_200e6);
        assertEq(vault.bondOf(brokerY), 0);
    }

    // ------------------------------------------------------------------ pledges: open and attest

    function test_pledge_tierAndCapacity() public {
        vm.prank(alice);
        vm.expectRevert(TierMismatch.selector);
        pledges.openPledge(REL, 200, brokerX, false); // 3,000 USDC is tier 2

        _openAndAttest(alice, REL, 100, brokerX); // 1,500 of 2,000 capacity
        vm.prank(carol);
        vm.expectRevert(CapacityExceeded.selector);
        pledges.openPledge(REL, 40, brokerX, false); // +600 > capacity
    }

    function test_pledge_attestByDelegateOnlyWithExactQuantity() public {
        (address del, uint256 delKey) = makeAddrAndKey("delegateX");
        vm.prank(brokerX);
        brokers.setDelegate(del);
        vm.prank(alice);
        uint256 id = pledges.openPledge(REL, 100, brokerX, false);

        PledgeRegistry.PledgeAttestation memory a = _pledgeAttestation(id, 99, uint64(block.timestamp + 1 days), "psn-1");
        bytes memory sig = _signPledge(delKey, a);
        vm.expectRevert(QuantityMismatch.selector);
        pledges.attestPledge(a, sig);

        a = _pledgeAttestation(id, 100, uint64(block.timestamp + 1 days), "psn-1");
        bytes memory wrong = _signPledge(aliceKey, a);
        vm.expectRevert(BadSignature.selector);
        pledges.attestPledge(a, wrong);

        pledges.attestPledge(a, _signPledge(delKey, a));
        assertEq(uint8(pledges.pledgeOf(id).status), uint8(PledgeStatus.Active));
    }

    function test_pledge_pendingExpiresAndCanBeCancelled() public {
        vm.prank(alice);
        uint256 id = pledges.openPledge(REL, 50, brokerX, false);
        vm.expectRevert(NotYetExpired.selector);
        pledges.rejectExpired(id);
        vm.warp(block.timestamp + 15 days + 1);
        pledges.rejectExpired(id);
        assertEq(uint8(pledges.pledgeOf(id).status), uint8(PledgeStatus.Rejected));
        assertEq(brokers.exposureUnits(brokerX, REL), 0);
    }

    // ------------------------------------------------------------------ mint and burn

    function test_mint_feeSplitAndSpare() public {
        uint256 id = _openAndAttest(alice, REL, 100, brokerX);
        uint256 x0 = usdc.balanceOf(brokerX);
        uint256 t0 = usdc.balanceOf(treasury);
        _mint(alice, id, 60); // value 900, fee 0.90
        assertEq(rel.balanceOf(alice), 60e18);
        assertEq(usdc.balanceOf(brokerX) - x0, 0.45e6);
        assertEq(usdc.balanceOf(treasury) - t0, 0.45e6);

        vm.prank(alice);
        vm.expectRevert(ExceedsSpare.selector);
        pledges.mint(id, 41);
        _assertLedger(id);
        _assertBacking(REL);
    }

    function test_mint_worksWhileMarketClosedButNotOnExpiredAttestationOrStalePrice() public {
        uint256 id = _openAndAttest(alice, REL, 100, brokerX);
        _warpClose(4, 2 hours); // Friday night: weekend minting works with Friday's close posted
        _postAll(4, 15e6);
        _mint(alice, id, 10);

        _warpClose(5, 1); // Monday's close passed but not posted yet
        vm.prank(alice);
        vm.expectRevert(PriceStale.selector);
        pledges.mint(id, 10);
        _postAll(5, 15e6);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        vm.expectRevert(AttestationExpired.selector);
        pledges.mint(id, 10);
    }

    function test_burnAgainstFreesSpare() public {
        uint256 id = _openAndAttest(alice, REL, 100, brokerX);
        _mint(alice, id, 60);
        vm.prank(alice);
        pledges.burnAgainst(id, 20e18);
        Pledge memory p = pledges.pledgeOf(id);
        assertEq(p.m, 40e18);
        _assertBacking(REL);
    }

    // ------------------------------------------------------------------ release, penalty, migration

    function test_release_confirmAndPenalty() public {
        uint256 id = _openAndAttest(alice, REL, 100, brokerX);
        _mint(alice, id, 60);
        vm.prank(alice);
        vm.expectRevert(ExceedsSpare.selector);
        pledges.requestRelease(id, 41);
        vm.prank(alice);
        pledges.requestRelease(id, 30);

        PledgeRegistry.ReleaseConfirmation memory c = PledgeRegistry.ReleaseConfirmation(id, 10, nonceSeq++);
        pledges.confirmRelease(c, _signRelease(xKey, c));
        assertEq(pledges.pledgeOf(id).q, 90e18);

        vm.prank(alice);
        vm.expectRevert(DeadlineNotReached.selector);
        pledges.claimReleasePenalty(id);
        _warpClose(3, 1);
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        pledges.claimReleasePenalty(id); // 0.5% of 20 shares x 15 = 1.50
        assertEq(usdc.balanceOf(alice) - a0, 1.5e6);
        vm.prank(alice);
        vm.expectRevert(PenaltyPaid.selector);
        pledges.claimReleasePenalty(id);
        assertTrue(pledges.isAtRisk(id));
    }

    function test_migrate_makeBeforeBreak() public {
        uint256 a = _openAndAttest(alice, REL, 100, brokerX);
        uint256 b = _openAndAttest(alice, REL, 100, brokerY);
        _mint(alice, a, 60);
        vm.prank(alice);
        pledges.migrate(a, b, 60e18);
        assertEq(pledges.pledgeOf(a).m, 0);
        assertEq(pledges.pledgeOf(b).m, 60e18);
        vm.prank(alice);
        pledges.requestRelease(a, 100);
        _assertBacking(REL);
    }

    // ------------------------------------------------------------------ re-attestation and staleness

    function test_reattest_shortfallDefaultsBrokerAndFundsReserve() public {
        uint256 id = _openAndAttest(alice, REL, 100, brokerX);
        _mint(alice, id, 80);
        // broker now reports only 70 pledged: 30 missing = 20 spare + 10 of free backing
        PledgeRegistry.PledgeAttestation memory a =
            _pledgeAttestation(id, 70, uint64(block.timestamp + 7 days), keccak256(abi.encode("psn", id)));
        pledges.reattest(a, _signPledge(xKey, a));
        Pledge memory p = pledges.pledgeOf(id);
        assertEq(p.q, 70e18);
        assertEq(p.m, 70e18);
        assertEq(uint8(brokers.statusOf(brokerX)), uint8(BrokerStatus.Defaulted));
        (uint256 units,, uint256 cash) = engine.reserveOf(REL);
        assertEq(units, 10e18);
        assertEq(cash, 157.5e6); // 10 x 15 x 1.05
        _assertBacking(REL);
        _assertLedger(id);
    }

    function test_reattest_fullQuantityExtends() public {
        uint256 id = _openAndAttest(alice, REL, 100, brokerX);
        PledgeRegistry.PledgeAttestation memory a =
            _pledgeAttestation(id, 100, uint64(block.timestamp + 7 days), keccak256(abi.encode("psn", id)));
        vm.warp(block.timestamp + 3 days);
        a.validUntil = uint64(block.timestamp + 7 days);
        pledges.reattest(a, _signPledge(xKey, a));
        assertEq(pledges.pledgeOf(id).attestedUntil, block.timestamp + 7 days);
    }

    function test_slashStale_movesFreeBackingToReserve() public {
        uint256 id = _openAndAttest(alice, REL, 100, brokerX);
        _mint(alice, id, 50);
        vm.expectRevert(NotStale.selector);
        pledges.slashStale(id);
        vm.warp(block.timestamp + 10 days + 1);
        pledges.slashStale(id);
        (uint256 units,, uint256 cash) = engine.reserveOf(REL);
        assertEq(units, 50e18);
        assertEq(cash, 787.5e6);
        assertEq(uint8(brokers.statusOf(brokerX)), uint8(BrokerStatus.Draining));
        _assertBacking(REL);
    }

    // ------------------------------------------------------------------ levels

    function test_levels_followFlagsAndBrokerStatus() public {
        uint256 a = _openAndAttest(alice, REL, 100, brokerX);
        uint256 b = _openAndAttest(carol, REL, 100, brokerY);
        _mint(alice, a, 50);
        _mint(carol, b, 40);
        assertEq(book.free(REL, Level.Normal), 90e18);

        vm.prank(alice);
        pledges.setVolunteer(a, true);
        assertEq(book.free(REL, Level.Volunteer), 50e18);
        assertEq(book.free(REL, Level.Normal), 40e18);

        vm.prank(brokerY);
        brokers.setDraining();
        book.requeueBroker(brokerY, 50);
        assertEq(book.free(REL, Level.Drain), 40e18);
        assertEq(book.free(REL, Level.Normal), 0);

        // attestation close to expiry turns at-risk once a keeper syncs it
        vm.prank(alice);
        pledges.setVolunteer(a, false);
        vm.warp(block.timestamp + 6 days);
        book.sync(a);
        assertEq(book.free(REL, Level.AtRisk), 50e18);
    }
}
