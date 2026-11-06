// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Directory} from "../common/Directory.sol";
import {Wired} from "../common/Wired.sol";
import {K} from "../common/Params.sol";
import {IAssetFactory, ICompliance, IParams, ISessionClock} from "../interfaces/IBullStreet.sol";
import "../common/Errors.sol";

/// @title BullStreetExchange
/// @notice A peer-to-peer order book. Makers post limit orders and escrow what they offer (tokens for a sell,
///         USDC for a buy); takers fill them at the maker's price, fully or partly, in one atomic transaction.
///         There is no pool and no market maker: prices come only from the orders people post.
///         Orders expire at the next NSE session open by default, so stale prices cannot be picked off after
///         news breaks while the market is closed.
contract BullStreetExchange is Wired, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Side {
        Buy,
        Sell
    }

    enum OrderStatus {
        None,
        Open,
        Filled,
        Cancelled,
        Expired
    }

    struct Order {
        address maker;
        uint32 assetId;
        Side side;
        OrderStatus status;
        uint64 createdAt;
        uint64 expiry;
        uint256 price; // USDC (6 decimals) per whole token (1e18 units)
        uint256 amount; // token units
        uint256 remaining; // token units
        uint256 usdcEscrow; // buy orders: USDC still held for this order
    }

    struct TradeParams {
        uint32 assetId;
        Side side;
        uint256 limitPrice;
        uint256 amount;
        uint256[] fillIds;
        bool rest;
        uint64 expiry;
        uint256 minFilled;
    }

    Order[] private _orders;
    mapping(uint32 => uint256[]) private _byAsset;
    mapping(address => uint256[]) private _byMaker;
    mapping(uint32 => uint256) public lastTradePrice;

    event OrderPlaced(
        uint256 indexed id, address indexed maker, uint32 indexed assetId, Side side, uint256 price, uint256 amount, uint64 expiry
    );
    event OrderFilled(
        uint256 indexed id,
        address indexed maker,
        address indexed taker,
        uint32 assetId,
        Side side,
        uint256 amount,
        uint256 usdc,
        uint256 fee
    );
    event OrderClosed(uint256 indexed id, OrderStatus status);

    constructor(Directory dir_) Wired(dir_) {
        _orders.push();
    }

    // ================================================================== trading

    /// @notice Fill the given resting orders up to `amount` at prices no worse than `limitPrice`, then (if `rest`)
    ///         post whatever is left as a new order at `limitPrice`. `fillIds` should be best price first; ids
    ///         that are closed, expired, on the same side, for another asset or priced worse are skipped.
    function trade(TradeParams calldata p) external nonReentrant returns (uint256 filled, uint256 restingId) {
        if (p.amount == 0 || p.limitPrice == 0) revert ZeroAmount();
        if (ICompliance(_w.compliance).tradingPaused(p.assetId)) revert Paused();
        IERC20 token = IERC20(IAssetFactory(_w.assets).tokenOf(p.assetId));
        IERC20 usdc = IERC20(_w.usdc);
        uint256 feeBps = IParams(_w.params).get(K.TAKER_FEE_BPS);

        for (uint256 i; i < p.fillIds.length && filled < p.amount; ++i) {
            uint256 id = p.fillIds[i];
            if (id == 0 || id >= _orders.length) continue;
            Order storage o = _orders[id];
            if (o.status != OrderStatus.Open || o.assetId != p.assetId || o.side == p.side) continue;
            if (block.timestamp >= o.expiry) continue;
            if (p.side == Side.Buy ? o.price > p.limitPrice : o.price < p.limitPrice) continue;
            uint256 x = Math.min(p.amount - filled, o.remaining);
            _fill(id, o, x, token, usdc, feeBps);
            filled += x;
        }
        if (filled < p.minFilled) revert BelowMinFill();
        if (p.rest && filled < p.amount) {
            restingId = _place(p, p.amount - filled, token, usdc);
        }
    }

    function cancel(uint256 id) external nonReentrant {
        Order storage o = _order(id);
        if (o.maker != msg.sender) revert NotMaker();
        if (o.status != OrderStatus.Open) revert OrderNotOpen();
        _close(id, o, OrderStatus.Cancelled);
    }

    /// @notice Anyone can return an expired order's escrow to its maker.
    function reclaim(uint256 id) external nonReentrant {
        Order storage o = _order(id);
        if (o.status != OrderStatus.Open) revert OrderNotOpen();
        if (block.timestamp < o.expiry) revert NotYetExpired();
        _close(id, o, OrderStatus.Expired);
    }

    // ================================================================== views

    function getOrder(uint256 id) external view returns (Order memory) {
        return _orders[id];
    }

    function orderCount() external view returns (uint256) {
        return _orders.length - 1;
    }

    function ordersOf(address maker) external view returns (uint256[] memory) {
        return _byMaker[maker];
    }

    /// @notice Live (open, unexpired) orders for one side of an asset's book, paged over all orders ever placed.
    function openOrders(uint32 assetId, Side side, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Order[] memory orders)
    {
        uint256[] storage all = _byAsset[assetId];
        uint256 n;
        uint256[] memory tmp = new uint256[](limit);
        for (uint256 i = offset; i < all.length && n < limit; ++i) {
            Order storage o = _orders[all[i]];
            if (o.status == OrderStatus.Open && o.side == side && block.timestamp < o.expiry) tmp[n++] = all[i];
        }
        ids = new uint256[](n);
        orders = new Order[](n);
        for (uint256 i; i < n; ++i) {
            ids[i] = tmp[i];
            orders[i] = _orders[tmp[i]];
        }
    }

    function assetOrderCount(uint32 assetId) external view returns (uint256) {
        return _byAsset[assetId].length;
    }

    function usdcFor(uint256 amount, uint256 price, bool roundUp) public pure returns (uint256) {
        return Math.mulDiv(amount, price, 1e18, roundUp ? Math.Rounding.Ceil : Math.Rounding.Floor);
    }

    // ================================================================== internal

    function _fill(uint256 id, Order storage o, uint256 x, IERC20 token, IERC20 usdc, uint256 feeBps) private {
        uint256 fee;
        uint256 value;
        if (o.side == Side.Sell) {
            // taker buys: pays USDC (rounded up), receives escrowed tokens
            value = usdcFor(x, o.price, true);
            fee = value * feeBps / 10_000;
            usdc.safeTransferFrom(msg.sender, o.maker, value);
            if (fee > 0) usdc.safeTransferFrom(msg.sender, _w.treasury, fee);
            token.safeTransfer(msg.sender, x);
        } else {
            // taker sells: delivers tokens, receives escrowed USDC (rounded down)
            value = usdcFor(x, o.price, false);
            if (value > o.usdcEscrow) value = o.usdcEscrow;
            fee = value * feeBps / 10_000;
            o.usdcEscrow -= value;
            token.safeTransferFrom(msg.sender, o.maker, x);
            usdc.safeTransfer(msg.sender, value - fee);
            if (fee > 0) usdc.safeTransfer(_w.treasury, fee);
        }
        o.remaining -= x;
        lastTradePrice[o.assetId] = o.price;
        emit OrderFilled(id, o.maker, msg.sender, o.assetId, o.side, x, value, fee);
        if (o.remaining == 0) _close(id, o, OrderStatus.Filled);
    }

    function _place(TradeParams calldata p, uint256 amount, IERC20 token, IERC20 usdc) private returns (uint256 id) {
        IParams params = IParams(_w.params);
        uint64 expiry = p.expiry;
        if (expiry == 0) {
            expiry = ISessionClock(_w.sessionClock).nextSessionOpen();
        } else if (expiry <= block.timestamp || expiry > block.timestamp + params.get(K.MAX_ORDER_TTL)) {
            revert BadExpiry();
        }
        uint256 escrowUsdc = usdcFor(amount, p.limitPrice, true);
        if (escrowUsdc < params.get(K.MIN_ORDER_VALUE)) revert OrderTooSmall();

        id = _orders.length;
        _orders.push(
            Order({
                maker: msg.sender,
                assetId: p.assetId,
                side: p.side,
                status: OrderStatus.Open,
                createdAt: uint64(block.timestamp),
                expiry: expiry,
                price: p.limitPrice,
                amount: amount,
                remaining: amount,
                usdcEscrow: p.side == Side.Buy ? escrowUsdc : 0
            })
        );
        _byAsset[p.assetId].push(id);
        _byMaker[msg.sender].push(id);
        if (p.side == Side.Sell) token.safeTransferFrom(msg.sender, address(this), amount);
        else usdc.safeTransferFrom(msg.sender, address(this), escrowUsdc);
        emit OrderPlaced(id, msg.sender, p.assetId, p.side, p.limitPrice, amount, expiry);
    }

    function _close(uint256 id, Order storage o, OrderStatus status) private {
        o.status = status;
        // `remaining` is kept as the unfilled amount for history; only the escrow goes back.
        if (o.side == Side.Sell) {
            if (o.remaining > 0) IERC20(IAssetFactory(_w.assets).tokenOf(o.assetId)).safeTransfer(o.maker, o.remaining);
        } else {
            uint256 left = o.usdcEscrow;
            o.usdcEscrow = 0;
            if (left > 0) IERC20(_w.usdc).safeTransfer(o.maker, left);
        }
        emit OrderClosed(id, status);
    }

    function _order(uint256 id) private view returns (Order storage) {
        if (id == 0 || id >= _orders.length) revert OrderNotOpen();
        return _orders[id];
    }
}
