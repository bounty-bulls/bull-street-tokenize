// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Broker, BrokerStatus, Deadlines, Level, Pledge, Tier} from "../common/Types.sol";

interface IParams {
    function get(bytes32 key) external view returns (uint256);
}

interface ISessionClock {
    function isOpen() external view returns (bool);
    function nextSessionOpen() external view returns (uint64);
    function nextSessionIndex() external view returns (uint32);
    function lastClosedSession() external view returns (bool found, uint32 idx);
    function isClosed(uint32 idx) external view returns (bool);
    function extendedClosure() external view returns (bool);
    function deadlines(uint64 t) external view returns (Deadlines memory);
    function closeAfterSessions(uint256 n) external view returns (uint64);
    function sessionAt(uint256 i) external view returns (uint64 openTime, uint64 closeTime);
}

interface IPriceOracle {
    function closeOf(uint32 assetId) external view returns (uint256 close, uint32 session, uint64 asOf);
    function closeAt(uint32 assetId, uint32 session) external view returns (uint256);
    function isStale(uint32 assetId) external view returns (bool);
    function freshClose(uint32 assetId) external view returns (uint256);
}

interface ICompliance {
    function check(address from, address to, uint32 assetId) external view;
    function isDenied(address a) external view returns (bool);
    function tradingPaused(uint32 assetId) external view returns (bool);
    function frozen(uint32 assetId) external view returns (bool);
}

interface IRoleRegistry {
    function roleOf(address wallet) external view returns (uint8);
    function isMinter(address wallet) external view returns (bool);
    function isBroker(address wallet) external view returns (bool);
}

interface IAssetFactory {
    function tokenOf(uint32 assetId) external view returns (address);
    function isinHashOf(uint32 assetId) external view returns (bytes32);
    function count() external view returns (uint32);
}

interface IStockToken {
    function assetId() external view returns (uint32);
    function mint(address to, uint256 amount) external;
    function burnFrom(address from, uint256 amount) external;
    function toTokens(uint256 shares) external view returns (uint256);
    function toShares(uint256 tokens) external view returns (uint256);
    function isWholeShares(uint256 tokens) external view returns (bool);
    function valueOf(uint256 tokens, uint256 pricePerShare) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function balanceOf(address a) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IBondVault {
    function bondOf(address broker) external view returns (uint256);
    function payFromBond(address broker, address to, uint256 amount, bytes32 reason) external returns (uint256 paid);
}

interface IBrokerRegistry {
    function brokerOf(address b) external view returns (Broker memory);
    function statusOf(address b) external view returns (BrokerStatus);
    function delegateOf(address b) external view returns (address);
    function addExposure(address b, uint32 assetId, uint256 units) external;
    function subExposure(address b, uint32 assetId, uint256 units) external;
    function exposureValue(address b) external view returns (uint256);
    function capacityValue(address b) external view returns (uint256);
    function health(address b) external view returns (uint256);
    function requiredBond(address b) external view returns (uint256);
    function tierFor(uint256 value) external view returns (Tier);
    function markDefaulted(address b) external;
    function markDraining(address b) external;
    function onBondChanged(address b) external;
}

interface ILevelBook {
    function sync(uint256 pledgeId) external;
    function free(uint32 assetId, Level level) external view returns (uint256);
    function memberCount(uint32 assetId, Level level) external view returns (uint256);
    function memberAt(uint32 assetId, Level level, uint256 i) external view returns (uint256);
    function levelOf(uint256 pledgeId) external view returns (Level level, bool member);
}

interface IPledgeRegistry {
    function pledgeOf(uint256 id) external view returns (Pledge memory);
    function levelInfo(uint256 id) external view returns (bool member, uint32 assetId, uint256 f, Level level);
    function freeOf(uint256 id) external view returns (uint256);
    function lastInvokedAt(address minter) external view returns (uint64);
    function onAllocate(uint256 id, uint256 units) external;
    function onDeallocate(uint256 id, uint256 units) external;
    function onCure(uint256 id, uint256 units) external;
    function onSettle(uint256 id, uint256 units) external;
    function onDefault(uint256 id, uint256 paidUnits, uint256 unpaidUnits) external;
    function writeOffInsolvent(uint256 id) external returns (uint256 units);
    function addUnbacked(uint32 assetId, uint256 units) external;
}

interface IRedemptionEngine {
    function addReserve(uint32 assetId, uint256 units, uint256 cash) external;
}
