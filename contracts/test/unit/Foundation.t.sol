// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "../utils/Base.t.sol";
import {Role, Deadlines, Tier} from "../../src/common/Types.sol";
import {TypeHashes} from "../../src/common/Attestations.sol";
import {RoleRegistry} from "../../src/identity/RoleRegistry.sol";
import {SessionClock} from "../../src/oracle/SessionClock.sol";
import {StockToken} from "../../src/asset/StockToken.sol";
import "../../src/common/Errors.sol";

contract FoundationTest is Base {
    // ------------------------------------------------------------------ roles

    function test_role_registered() public view {
        assertTrue(roles.isMinter(alice));
        assertTrue(roles.isBroker(brokerX));
        assertEq(roles.roleOf(bob), 0);
    }

    function test_role_sameHumanCannotTakeSecondRole() public {
        bytes32 n = keccak256("same-person");
        address w1 = makeAddr("w1");
        address w2 = makeAddr("w2");
        _registerWith(w1, Role.Minter, n);
        RoleRegistry.RoleAttestation memory a =
            RoleRegistry.RoleAttestation(w2, uint8(Role.Broker), n, uint64(block.timestamp + 1 hours), 999);
        bytes memory sig = _sign(
            worldKey,
            _digest(
                roles.domainSeparator(),
                keccak256(abi.encode(TypeHashes.ROLE_ATTESTATION, a.wallet, a.role, a.nullifierHash, a.expiry, a.nonce))
            )
        );
        vm.prank(w2);
        vm.expectRevert(RoleTaken.selector);
        roles.register(a, sig);
    }

    function test_role_rejectsExpiredWrongSignerAndWrongSender() public {
        address w = makeAddr("w");
        RoleRegistry.RoleAttestation memory a =
            RoleRegistry.RoleAttestation(w, uint8(Role.Minter), keccak256("n1"), uint64(block.timestamp - 1), 1000);
        bytes32 sh = keccak256(abi.encode(TypeHashes.ROLE_ATTESTATION, a.wallet, a.role, a.nullifierHash, a.expiry, a.nonce));
        bytes memory good = _sign(worldKey, _digest(roles.domainSeparator(), sh));
        vm.prank(w);
        vm.expectRevert(Expired.selector);
        roles.register(a, good);

        a.expiry = uint64(block.timestamp + 1 hours);
        sh = keccak256(abi.encode(TypeHashes.ROLE_ATTESTATION, a.wallet, a.role, a.nullifierHash, a.expiry, a.nonce));
        bytes memory bad = _sign(0xBAD, _digest(roles.domainSeparator(), sh));
        vm.prank(w);
        vm.expectRevert(BadSignature.selector);
        roles.register(a, bad);

        good = _sign(worldKey, _digest(roles.domainSeparator(), sh));
        vm.prank(bob);
        vm.expectRevert(NotSender.selector);
        roles.register(a, good);

        vm.prank(w);
        roles.register(a, good);
        assertTrue(roles.isMinter(w));
    }

    // ------------------------------------------------------------------ session clock

    function test_clock_openClosedAndWeekend() public {
        _warpOpen(1, 1 hours); // Tuesday session
        assertTrue(clock.isOpen());
        _warpClose(1, 1 hours);
        assertFalse(clock.isOpen());
        assertFalse(clock.extendedClosure());
        (bool found, uint32 last) = clock.lastClosedSession();
        assertTrue(found);
        assertEq(last, 1);
        assertEq(clock.nextSessionIndex(), 2);

        _warpClose(4, 1 hours); // Friday evening: next open is Monday, 3 days minus a bit away
        assertEq(clock.nextSessionIndex(), 5);
        params.set("EXT_CLOSURE", 2 days);
        assertTrue(clock.extendedClosure());
    }

    function test_clock_deadlinesUseNextSession() public {
        _warpOpen(2, 1 hours); // during Wednesday's session
        Deadlines memory d = clock.deadlines(uint64(block.timestamp));
        assertEq(d.refSession, 3, "next session, not the open one");
        (uint64 o3,) = _sessionTimes(3);
        (, uint64 c5) = _sessionTimes(5);
        (, uint64 c6) = _sessionTimes(6);
        assertEq(d.cure, o3 + 1 hours);
        assertEq(d.soft, c5);
        assertEq(d.hard, c6);
    }

    function test_clock_rejectsNonContiguousAndSingleSigner() public {
        SessionClock.SessionInfo[] memory s = new SessionClock.SessionInfo[](1);
        s[0] = SessionClock.SessionInfo(sessionCount + 1, 1, 2); // skips an index
        bytes32[] memory h = new bytes32[](1);
        h[0] = keccak256(abi.encode(TypeHashes.SESSION_INFO, s[0].sessionIndex, s[0].openTime, s[0].closeTime));
        bytes32 sh = keccak256(abi.encode(TypeHashes.SESSION_BATCH, keccak256(abi.encodePacked(h)), uint256(777)));
        bytes[] memory sigs = _oracleSigs(clock.domainSeparator(), sh);
        vm.expectRevert(BadSessions.selector);
        clock.postSessions(s, 777, sigs);

        bytes[] memory one = new bytes[](1);
        one[0] = sigs[0];
        vm.expectRevert(NotEnoughSigners.selector);
        clock.postSessions(s, 777, one);

        bytes[] memory unsorted = new bytes[](2);
        (unsorted[0], unsorted[1]) = (sigs[1], sigs[0]);
        vm.expectRevert(BadSignature.selector);
        clock.postSessions(s, 777, unsorted);
    }

    // ------------------------------------------------------------------ oracle

    function test_oracle_requiresClosedSessionAndMonotonic() public {
        _warpOpen(1, 1 hours);
        uint32[] memory a = new uint32[](1);
        uint256[] memory c = new uint256[](1);
        (a[0], c[0]) = (REL, 16e6);
        (uint64 asOf, uint256 nonce, bytes[] memory sigs) = _priceSigs(1, a, c);
        vm.expectRevert(SessionNotClosed.selector);
        oracle.postBatch(1, a, c, asOf, nonce, sigs);
        _warpClose(1, 1);
        _postPrice(REL, 1, 16e6);
        assertEq(oracle.closeAt(REL, 1), 16e6);
        c[0] = 17e6;
        (asOf, nonce, sigs) = _priceSigs(1, a, c);
        vm.expectRevert(OldPrice.selector);
        oracle.postBatch(1, a, c, asOf, nonce, sigs);
    }

    function test_oracle_staleAfterNextClose() public {
        _warpClose(0, 2 hours);
        assertFalse(oracle.isStale(REL));
        _warpClose(1, 1);
        assertTrue(oracle.isStale(REL));
        vm.expectRevert(PriceStale.selector);
        oracle.freshClose(REL);
    }

    // ------------------------------------------------------------------ compliance and token

    function test_token_onlyProtocolMints() public {
        vm.expectRevert(NotWired.selector);
        rel.mint(bob, 1);
    }

    function test_token_compliancePauseAndDenylist() public {
        _join(brokerX, Tier.T1, 2_200e6);
        uint256 id = _openAndAttest(alice, REL, 10, brokerX);
        _mint(alice, id, 10);
        compliance.setDenied(bob, true);
        vm.prank(alice);
        vm.expectRevert(Denied.selector);
        rel.transfer(bob, 1e18);
        compliance.setAssetPause(REL, true);
        vm.prank(alice);
        vm.expectRevert(Paused.selector);
        rel.transfer(carol, 1e18);
    }

    function test_token_corporateActionBonus() public {
        assertEq(rel.toTokens(10), 10e18);
        vm.expectRevert(NotFrozen.selector);
        factory.applyCorporateAction(REL, 2, 1);
        compliance.setCorporateActionFreeze(REL, true);
        factory.applyCorporateAction(REL, 2, 1); // 1:1 bonus: each token now stands for two shares
        assertEq(rel.toShares(1e18), 2);
        assertEq(rel.toTokens(10), 5e18);
        assertTrue(rel.isWholeShares(0.5e18));
        assertEq(rel.valueOf(1e18, 7.5e6), 15e6, "value unchanged when the price halves");
        factory.applyCorporateAction(REL, 3, 2); // then a 1:2 bonus
        assertEq(rel.sharesPerToken(), 3e18);
    }
}
