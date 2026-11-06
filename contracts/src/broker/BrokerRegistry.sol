// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Directory} from "../common/Directory.sol";
import {Wired} from "../common/Wired.sol";
import {K} from "../common/Params.sol";
import {Broker, BrokerStatus, Tier} from "../common/Types.sol";
import {
    IBondVault,
    IParams,
    IPriceOracle,
    IRoleRegistry,
    ISessionClock,
    IStockToken,
    IAssetFactory
} from "../interfaces/IBullStreet.sol";
import {
    BoIdTaken,
    BrokerExists,
    BrokerNotFound,
    ExposureOpen,
    NotWired,
    PledgeTooLarge,
    WrongRole,
    WrongStatus,
    ZeroAddress
} from "../common/Errors.sol";

/// @title BrokerRegistry
/// @notice Brokers are the pledgees: they hold pledged shares in their own CDSL account, attest to them, sell
///         them on NSE to settle redemptions and post a USDC bond. Tiers cap a single pledge's value; the bond
///         caps total exposure. Health below 1.0 for HEALTH_CURE moves a broker to Draining.
contract BrokerRegistry is Wired {

    mapping(address => Broker) private _brokers;
    mapping(address => string) public nameOf;
    mapping(bytes32 => address) public brokerOfBoId;
    address[] private _list;

    /// @dev Pledged units (Σ q of the broker's live pledges) per asset; value is computed with current closes.
    mapping(address => mapping(uint32 => uint256)) public exposureUnits;
    mapping(address => uint32[]) private _assetsOf;
    mapping(address => mapping(uint32 => bool)) private _hasAsset;

    event BrokerJoined(address indexed broker, Tier tier, bytes32 boIdHash, address delegate, string name);
    event BrokerStatusChanged(address indexed broker, BrokerStatus from, BrokerStatus to);
    event DelegateSet(address indexed broker, address delegate);
    event ExposureChanged(address indexed broker, uint32 indexed assetId, uint256 units);
    event HealthLow(address indexed broker, uint64 since);

    constructor(Directory dir_) Wired(dir_) {
    }

    modifier onlyPledges() {
        if (msg.sender != _w.pledges) revert NotWired();
        _;
    }

    // ------------------------------------------------------------------ broker actions

    function join(Tier tier, bytes32 boIdHash, address delegate, string calldata name) external {
        if (!IRoleRegistry(_w.roles).isBroker(msg.sender)) revert WrongRole();
        if (_brokers[msg.sender].status != BrokerStatus.None) revert BrokerExists();
        if (boIdHash == bytes32(0)) revert ZeroAddress();
        if (brokerOfBoId[boIdHash] != address(0)) revert BoIdTaken();
        brokerOfBoId[boIdHash] = msg.sender;
        _brokers[msg.sender] = Broker({
            tier: tier,
            status: BrokerStatus.Pending,
            boIdHash: boIdHash,
            delegate: delegate,
            joinedAt: uint64(block.timestamp),
            healthLowSince: 0
        });
        nameOf[msg.sender] = name;
        _list.push(msg.sender);
        emit BrokerJoined(msg.sender, tier, boIdHash, delegate, name);
        _syncBondStatus(msg.sender);
    }

    function setDelegate(address delegate) external {
        if (_brokers[msg.sender].status == BrokerStatus.None) revert BrokerNotFound();
        _brokers[msg.sender].delegate = delegate;
        emit DelegateSet(msg.sender, delegate);
    }

    /// @notice Stop taking new pledges and mints; existing pledges are served first by redemptions.
    function setDraining() external {
        BrokerStatus s = _brokers[msg.sender].status;
        if (s != BrokerStatus.Active && s != BrokerStatus.Pending) revert WrongStatus();
        _setStatus(msg.sender, BrokerStatus.Draining);
    }

    /// @notice Leave once fully drained; the whole bond becomes withdrawable.
    function exit() external {
        if (_brokers[msg.sender].status != BrokerStatus.Draining) revert WrongStatus();
        if (totalExposureUnits(msg.sender) != 0) revert ExposureOpen();
        _setStatus(msg.sender, BrokerStatus.Exited);
    }

    /// @notice Permissionless health check. Below 1.0 starts a cure clock; after HEALTH_CURE the broker drains.
    function poke(address b) public {
        Broker storage br = _brokers[b];
        if (br.status != BrokerStatus.Active && br.status != BrokerStatus.Pending) return;
        IParams p = IParams(_w.params);
        if (health(b) < p.get(K.CURE_HEALTH_BPS)) {
            if (br.healthLowSince == 0) {
                br.healthLowSince = uint64(block.timestamp);
                emit HealthLow(b, br.healthLowSince);
            } else if (block.timestamp - br.healthLowSince >= p.get(K.HEALTH_CURE)) {
                _setStatus(b, BrokerStatus.Draining);
            }
        } else if (br.healthLowSince != 0) {
            br.healthLowSince = 0;
            emit HealthLow(b, 0);
        }
    }

    // ------------------------------------------------------------------ protocol hooks

    function onBondChanged(address b) external {
        if (msg.sender != _w.bondVault) revert NotWired();
        _syncBondStatus(b);
        poke(b);
    }

    function addExposure(address b, uint32 assetId, uint256 units) external onlyPledges {
        if (!_hasAsset[b][assetId]) {
            _hasAsset[b][assetId] = true;
            _assetsOf[b].push(assetId);
        }
        exposureUnits[b][assetId] += units;
        emit ExposureChanged(b, assetId, exposureUnits[b][assetId]);
    }

    function subExposure(address b, uint32 assetId, uint256 units) external onlyPledges {
        exposureUnits[b][assetId] -= units;
        emit ExposureChanged(b, assetId, exposureUnits[b][assetId]);
    }

    function markDefaulted(address b) external {
        if (msg.sender != _w.pledges && msg.sender != _w.redemption) revert NotWired();
        BrokerStatus s = _brokers[b].status;
        if (s == BrokerStatus.None || s == BrokerStatus.Defaulted) return;
        _setStatus(b, BrokerStatus.Defaulted);
    }

    function markDraining(address b) external onlyPledges {
        BrokerStatus s = _brokers[b].status;
        if (s == BrokerStatus.Active || s == BrokerStatus.Pending) _setStatus(b, BrokerStatus.Draining);
    }

    // ------------------------------------------------------------------ views

    function brokerOf(address b) external view returns (Broker memory) {
        return _brokers[b];
    }

    function statusOf(address b) external view returns (BrokerStatus) {
        return _brokers[b].status;
    }

    function delegateOf(address b) external view returns (address) {
        return _brokers[b].delegate;
    }

    function brokers() external view returns (address[] memory) {
        return _list;
    }

    function brokerCount() external view returns (uint256) {
        return _list.length;
    }

    function assetsOf(address b) external view returns (uint32[] memory) {
        return _assetsOf[b];
    }

    function totalExposureUnits(address b) public view returns (uint256 total) {
        uint32[] memory a = _assetsOf[b];
        for (uint256 i; i < a.length; ++i) {
            total += exposureUnits[b][a[i]];
        }
    }

    /// @notice Value of everything pledged to the broker, at the latest closes. Spare shares count because they
    ///         can be minted at any time.
    function exposureValue(address b) public view returns (uint256 value) {
        uint32[] memory a = _assetsOf[b];
        IPriceOracle o = IPriceOracle(_w.priceOracle);
        IAssetFactory f = IAssetFactory(_w.assets);
        for (uint256 i; i < a.length; ++i) {
            uint256 units = exposureUnits[b][a[i]];
            if (units == 0) continue;
            (uint256 close,,) = o.closeOf(a[i]);
            value += IStockToken(f.tokenOf(a[i])).valueOf(units, close);
        }
    }

    function bondBps() public view returns (uint256) {
        IParams p = IParams(_w.params);
        return ISessionClock(_w.sessionClock).extendedClosure() ? p.get(K.BOND_BPS_EXT) : p.get(K.BOND_BPS);
    }

    function requiredBond(address b) public view returns (uint256) {
        return exposureValue(b) * bondBps() / 10_000;
    }

    function capacityValue(address b) public view returns (uint256) {
        return IBondVault(_w.bondVault).bondOf(b) * 10_000 / bondBps();
    }

    /// @notice bond / (bondRatio × exposure) in basis points; 10_000 = exactly at the requirement.
    function health(address b) public view returns (uint256) {
        uint256 exp = exposureValue(b);
        if (exp == 0) return type(uint256).max;
        return IBondVault(_w.bondVault).bondOf(b) * 1e8 / (bondBps() * exp);
    }

    function tierCap(Tier t) public view returns (uint256) {
        IParams p = IParams(_w.params);
        return t == Tier.T1 ? p.get(K.TIER_CAP_1) : t == Tier.T2 ? p.get(K.TIER_CAP_2) : p.get(K.TIER_CAP_3);
    }

    function minBond(Tier t) public view returns (uint256) {
        IParams p = IParams(_w.params);
        return t == Tier.T1 ? p.get(K.MIN_BOND_1) : t == Tier.T2 ? p.get(K.MIN_BOND_2) : p.get(K.MIN_BOND_3);
    }

    /// @notice Smallest tier whose single-pledge cap covers `value`.
    function tierFor(uint256 value) external view returns (Tier) {
        if (value <= tierCap(Tier.T1)) return Tier.T1;
        if (value <= tierCap(Tier.T2)) return Tier.T2;
        if (value <= tierCap(Tier.T3)) return Tier.T3;
        revert PledgeTooLarge();
    }

    // ------------------------------------------------------------------ internal

    function _syncBondStatus(address b) private {
        Broker storage br = _brokers[b];
        uint256 bond = IBondVault(_w.bondVault).bondOf(b);
        if (br.status == BrokerStatus.Pending && bond >= minBond(br.tier)) {
            _setStatus(b, BrokerStatus.Active);
        } else if (br.status == BrokerStatus.Active && bond < minBond(br.tier)) {
            _setStatus(b, BrokerStatus.Pending);
        }
    }

    function _setStatus(address b, BrokerStatus to) private {
        BrokerStatus from = _brokers[b].status;
        _brokers[b].status = to;
        if (to != BrokerStatus.Active && to != BrokerStatus.Pending) _brokers[b].healthLowSince = 0;
        emit BrokerStatusChanged(b, from, to);
    }
}
