// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "../utils/Base.t.sol";
import {Tier} from "../../src/common/Types.sol";
import {BullStreetExchange} from "../../src/exchange/BullStreetExchange.sol";
import "../../src/common/Errors.sol";

contract ExchangeTest is Base {
    uint256 internal pa;

    function setUp() public override {
        super.setUp();
        _join(brokerX, Tier.T1, 2_200e6);
        pa = _openAndAttest(alice, REL, 100, brokerX);
        _mint(alice, pa, 100);
        vm.prank(alice);
        rel.approve(address(exchange), type(uint256).max);
        vm.prank(bob);
        rel.approve(address(exchange), type(uint256).max);
        vm.prank(eve);
        rel.approve(address(exchange), type(uint256).max);
    }

    function _p(BullStreetExchange.Side side, uint256 price, uint256 amount, uint256[] memory ids, bool rest)
        internal
        pure
        returns (BullStreetExchange.TradeParams memory)
    {
        return BullStreetExchange.TradeParams(1, side, price, amount, ids, rest, 0, 0);
    }

    function _post(address maker, BullStreetExchange.Side side, uint256 price, uint256 amount)
        internal
        returns (uint256 id)
    {
        vm.prank(maker);
        (, id) = exchange.trade(_p(side, price, amount, new uint256[](0), true));
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        (r[0], r[1]) = (a, b);
    }

    function test_postAndCancelRefundsEscrow() public {
        uint256 ask = _post(alice, BullStreetExchange.Side.Sell, 15.4e6, 10e18);
        assertEq(rel.balanceOf(address(exchange)), 10e18);
        uint256 b0 = usdc.balanceOf(bob);
        uint256 bid = _post(bob, BullStreetExchange.Side.Buy, 15.1e6, 5e18);
        assertEq(b0 - usdc.balanceOf(bob), 75.5e6);

        vm.prank(alice);
        exchange.cancel(ask);
        assertEq(rel.balanceOf(alice), 100e18);
        vm.prank(bob);
        exchange.cancel(bid);
        assertEq(usdc.balanceOf(bob), b0);
        vm.prank(bob);
        vm.expectRevert(OrderNotOpen.selector);
        exchange.cancel(bid);
    }

    function test_takerBuysAcrossAsksBestFirstAndRestsRemainder() public {
        uint256 a1 = _post(alice, BullStreetExchange.Side.Sell, 15.2e6, 5e18);
        uint256 a2 = _post(alice, BullStreetExchange.Side.Sell, 15.5e6, 5e18);
        uint256 a0 = usdc.balanceOf(alice);
        uint256 t0 = usdc.balanceOf(treasury);
        vm.prank(bob);
        (uint256 filled, uint256 resting) =
            exchange.trade(_p(BullStreetExchange.Side.Buy, 15.4e6, 8e18, _ids(a1, a2), true));
        assertEq(filled, 5e18, "a2 is above the limit");
        assertEq(rel.balanceOf(bob), 5e18);
        assertEq(usdc.balanceOf(alice) - a0, 76e6);
        assertEq(usdc.balanceOf(treasury) - t0, 0.076e6, "0.10% taker fee");
        assertGt(resting, 0);
        BullStreetExchange.Order memory o = exchange.getOrder(resting);
        assertEq(o.price, 15.4e6);
        assertEq(o.remaining, 3e18);
        assertEq(exchange.lastTradePrice(REL), 15.2e6);
    }

    function test_takerSellsIntoBidsWithFeeDeducted() public {
        vm.prank(alice);
        rel.transfer(eve, 10e18);
        uint256 bid = _post(bob, BullStreetExchange.Side.Buy, 15e6, 10e18);
        uint256 e0 = usdc.balanceOf(eve);
        vm.prank(eve);
        exchange.trade(_p(BullStreetExchange.Side.Sell, 14.9e6, 4e18, _ids(bid), false));
        assertEq(usdc.balanceOf(eve) - e0, 60e6 - 0.06e6);
        assertEq(rel.balanceOf(bob), 4e18);
        assertEq(exchange.getOrder(bid).usdcEscrow, 90e6);
    }

    function test_partialFillsAndRoundingNeverOverpay() public {
        uint256 bid = _post(bob, BullStreetExchange.Side.Buy, 15.333333e6, 3e18);
        uint256 escrow = exchange.getOrder(bid).usdcEscrow; // rounded up
        vm.startPrank(alice);
        exchange.trade(_p(BullStreetExchange.Side.Sell, 1, 1e18 + 1, _ids(bid), false));
        exchange.trade(_p(BullStreetExchange.Side.Sell, 1, 2e18 - 1, _ids(bid), false));
        vm.stopPrank();
        assertEq(exchange.getOrder(bid).remaining, 0);
        assertEq(usdc.balanceOf(address(exchange)), 0, "dust refunded on fill");
        assertLe(escrow, 46e6);
    }

    function test_defaultExpiryIsNextOpenAndExpiredOrdersCannotFill() public {
        _warpClose(4, 1 days); // Saturday
        _postAll(4, 15e6);
        uint256 ask = _post(alice, BullStreetExchange.Side.Sell, 15e6, 5e18);
        (uint64 mondayOpen,) = _sessionTimes(5);
        assertEq(exchange.getOrder(ask).expiry, mondayOpen);

        vm.warp(mondayOpen);
        vm.prank(bob);
        (uint256 filled,) = exchange.trade(_p(BullStreetExchange.Side.Buy, 16e6, 5e18, _ids(ask), false));
        assertEq(filled, 0);
        exchange.reclaim(ask);
        assertEq(rel.balanceOf(alice), 100e18);
    }

    function test_instantTradeRequiresMinFill() public {
        uint256 ask = _post(alice, BullStreetExchange.Side.Sell, 15e6, 2e18);
        BullStreetExchange.TradeParams memory p = _p(BullStreetExchange.Side.Buy, 16e6, 5e18, _ids(ask), false);
        p.minFilled = 5e18;
        vm.prank(bob);
        vm.expectRevert(BelowMinFill.selector);
        exchange.trade(p);
    }

    function test_pausedAssetBlocksTradingButNotCancel() public {
        uint256 ask = _post(alice, BullStreetExchange.Side.Sell, 15e6, 2e18);
        compliance.setAssetPause(REL, true);
        vm.prank(bob);
        vm.expectRevert(Paused.selector);
        exchange.trade(_p(BullStreetExchange.Side.Buy, 16e6, 1e18, _ids(ask), false));
        compliance.setAssetPause(REL, false);
        compliance.setCorporateActionFreeze(REL, true);
        vm.prank(bob);
        vm.expectRevert(Paused.selector);
        exchange.trade(_p(BullStreetExchange.Side.Buy, 16e6, 1e18, _ids(ask), false));
        compliance.setCorporateActionFreeze(REL, false);
        vm.prank(alice);
        exchange.cancel(ask);
    }

    function test_openOrdersSkipsClosed() public {
        uint256 a1 = _post(alice, BullStreetExchange.Side.Sell, 15e6, 1e18);
        _post(alice, BullStreetExchange.Side.Sell, 16e6, 1e18);
        _post(bob, BullStreetExchange.Side.Buy, 14e6, 1e18);
        vm.prank(alice);
        exchange.cancel(a1);
        (uint256[] memory ids,) = exchange.openOrders(REL, BullStreetExchange.Side.Sell, 0, 10);
        assertEq(ids.length, 1);
        (ids,) = exchange.openOrders(REL, BullStreetExchange.Side.Buy, 0, 10);
        assertEq(ids.length, 1);
    }

    function test_tooSmallAndBadExpiry() public {
        vm.prank(bob);
        vm.expectRevert(OrderTooSmall.selector);
        exchange.trade(_p(BullStreetExchange.Side.Buy, 0.5e6, 1e18, new uint256[](0), true));
        BullStreetExchange.TradeParams memory p = _p(BullStreetExchange.Side.Buy, 15e6, 1e18, new uint256[](0), true);
        p.expiry = uint64(block.timestamp + 31 days);
        vm.prank(bob);
        vm.expectRevert(BadExpiry.selector);
        exchange.trade(p);
    }
}
