// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Attestations, TypeHashes} from "../common/Attestations.sol";
import {Directory} from "../common/Directory.sol";
import {Wired} from "../common/Wired.sol";
import {K} from "../common/Params.sol";
import {BrokerStatus, Level, Pledge, PledgeStatus, Tier} from "../common/Types.sol";
import {
    IAssetFactory,
    IBondVault,
    IBrokerRegistry,
    ICompliance,
    ILevelBook,
    IParams,
    IPriceOracle,
    IRedemptionEngine,
    IRoleRegistry,
    ISessionClock,
    IStockToken
} from "../interfaces/IBullStreet.sol";
import "../common/Errors.sol";

/// @title PledgeRegistry
/// @notice The per-pledge ledger. A minter opens a pledge to a broker, pledges the shares in CDSL, and the broker
///         attests to it. Tokens are minted against attested pledged shares at any hour.
///         q = pledged and not invoked, m = tokens outstanding, a = part of m assigned to redemptions,
///         f = m - a (free backing), s = q - m (spare: mintable or releasable). Invariant: 0 <= a <= m <= q.
///         All quantities are token units; StockToken converts to real shares.
contract PledgeRegistry is Wired, Attestations, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct PledgeAttestation {
        uint256 pledgeId;
        bytes32 psnHash;
        bytes32 isinHash;
        uint256 quantity; // real shares
        address minter;
        uint64 validUntil;
        uint256 nonce;
    }

    struct ReleaseConfirmation {
        uint256 pledgeId;
        uint256 quantity; // real shares
        uint256 nonce;
    }


    Pledge[] private _pledges; // id 0 is unused
    mapping(bytes32 => bool) public psnUsed;
    mapping(address => uint256[]) private _byMinter;
    mapping(address => uint256[]) private _byBroker;
    mapping(uint32 => uint256[]) private _byAsset;
    mapping(address => uint64) public lastInvokedAt;
    /// @notice Σ m over all pledges of an asset.
    mapping(uint32 => uint256) public totalM;
    /// @notice Tokens whose backing was lost and could not be covered by a bond (shown in the app).
    mapping(uint32 => uint256) public unbacked;

    event PledgeOpened(
        uint256 indexed pledgeId,
        address indexed minter,
        address indexed broker,
        uint32 assetId,
        uint256 shares,
        Tier tier,
        bool guided
    );
    event PledgeCancelled(uint256 indexed pledgeId, PledgeStatus status);
    event PledgeAttested(uint256 indexed pledgeId, bytes32 psnHash, uint256 quantity, uint64 validUntil);
    event PledgeReattested(uint256 indexed pledgeId, uint256 quantity, uint64 validUntil);
    event Shortfall(uint256 indexed pledgeId, uint256 missingUnits, uint256 lostFreeUnits);
    event Minted(uint256 indexed pledgeId, uint256 shares, uint256 units, uint256 fee);
    event BurnedAgainst(uint256 indexed pledgeId, uint256 units);
    event VolunteerSet(uint256 indexed pledgeId, bool on);
    event StaleSlashed(uint256 indexed pledgeId, uint256 units, uint256 paid);
    event BondSettled(uint256 indexed pledgeId, uint256 units, uint256 paidUnits, uint256 paid, bytes32 reason);
    event ReleaseRequested(uint256 indexed pledgeId, uint256 units, uint64 deadline);
    event ReleaseConfirmed(uint256 indexed pledgeId, uint256 units);
    event ReleasePenaltyPaid(uint256 indexed pledgeId, uint256 amount);
    event Migrated(uint256 indexed fromPledge, uint256 indexed toPledge, uint256 units);
    event LedgerChanged(uint256 indexed pledgeId, uint256 q, uint256 m, uint256 a);
    event WrittenOff(uint256 indexed pledgeId, uint256 units);

    constructor(Directory dir_) Wired(dir_) {
        _pledges.push(); // reserve id 0
    }

    modifier onlyRedemption() {
        if (msg.sender != _w.redemption) revert NotWired();
        _;
    }

    // ================================================================== minter: open, cancel

    function openPledge(uint32 assetId, uint256 shares, address broker, bool guided)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (!IRoleRegistry(_w.roles).isMinter(msg.sender)) revert WrongRole();
        if (shares == 0) revert ZeroAmount();
        if (ICompliance(_w.compliance).frozen(assetId)) revert Frozen();
        IBrokerRegistry brokers = IBrokerRegistry(_w.brokers);
        if (brokers.statusOf(broker) != BrokerStatus.Active) revert BrokerNotActive();

        IStockToken token = _token(assetId);
        uint256 units = token.toTokens(shares);
        uint256 value = token.valueOf(units, IPriceOracle(_w.priceOracle).freshClose(assetId));
        Tier tier = brokers.tierFor(value);
        if (brokers.brokerOf(broker).tier != tier) revert TierMismatch();
        if (brokers.exposureValue(broker) + value > brokers.capacityValue(broker)) revert CapacityExceeded();

        id = _pledges.length;
        Pledge storage p = _pledges.push();
        p.minter = msg.sender;
        p.broker = broker;
        p.assetId = assetId;
        p.tier = tier;
        p.status = PledgeStatus.Pending;
        p.guided = guided;
        p.openedAt = uint64(block.timestamp);
        p.q = units;
        _byMinter[msg.sender].push(id);
        _byBroker[broker].push(id);
        _byAsset[assetId].push(id);
        brokers.addExposure(broker, assetId, units);
        emit PledgeOpened(id, msg.sender, broker, assetId, shares, tier, guided);
        _changed(id);
    }

    function cancelPending(uint256 id) external {
        Pledge storage p = _pledge(id);
        if (msg.sender != p.minter) revert NotPledgeMinter();
        _closePending(id, p);
    }

    /// @notice Mirrors CDSL: a pledge request nobody accepted is rejected after PENDING_PLEDGE_TTL.
    function rejectExpired(uint256 id) external {
        Pledge storage p = _pledge(id);
        if (block.timestamp <= p.openedAt + _param(K.PENDING_PLEDGE_TTL)) revert NotYetExpired();
        _closePending(id, p);
    }

    // ================================================================== broker: attest

    function attestPledge(PledgeAttestation calldata a, bytes calldata sig) external {
        Pledge storage p = _pledge(a.pledgeId);
        if (p.status != PledgeStatus.Pending) revert PledgeNotPending();
        _checkAttestation(p, a, sig);
        if (a.psnHash == bytes32(0) || psnUsed[a.psnHash]) revert PsnUsed();
        if (_token(p.assetId).toTokens(a.quantity) != p.q) revert QuantityMismatch();
        psnUsed[a.psnHash] = true;
        p.psnHash = a.psnHash;
        p.status = PledgeStatus.Active;
        p.attestedUntil = a.validUntil;
        emit PledgeAttested(a.pledgeId, a.psnHash, a.quantity, a.validUntil);
        _changed(a.pledgeId);
    }

    /// @notice Weekly re-attestation by the broker. Shares already assigned to redemptions may have been invoked,
    ///         so the check is against q - a. Anything missing beyond that is an unauthorised invocation: it comes
    ///         out of spare first, then out of free backing (bond-settled into the reserve), and the broker defaults.
    function reattest(PledgeAttestation calldata a, bytes calldata sig) external nonReentrant {
        Pledge storage p = _pledge(a.pledgeId);
        if (p.status != PledgeStatus.Active) revert PledgeNotActive();
        if (a.psnHash != p.psnHash) revert QuantityMismatch();
        _checkAttestation(p, a, sig);
        uint256 attested = _token(p.assetId).toTokens(a.quantity);
        uint256 need = p.q - p.a;
        p.attestedUntil = a.validUntil;
        if (attested >= need) {
            emit PledgeReattested(a.pledgeId, a.quantity, a.validUntil);
        } else {
            uint256 d = need - attested;
            uint256 spare = p.q - p.m;
            uint256 lostFree = d > spare ? d - spare : 0;
            if (lostFree > 0) _bondSettle(a.pledgeId, p, lostFree, false, "SHORTFALL");
            p.q -= d;
            IBrokerRegistry(_w.brokers).subExposure(p.broker, p.assetId, d);
            IBrokerRegistry(_w.brokers).markDefaulted(p.broker);
            emit Shortfall(a.pledgeId, d, lostFree);
        }
        _changed(a.pledgeId);
    }

    // ================================================================== minter: mint, burn, flags

    function mint(uint256 id, uint256 shares) external nonReentrant {
        Pledge storage p = _pledge(id);
        if (msg.sender != p.minter) revert NotPledgeMinter();
        if (p.status != PledgeStatus.Active) revert PledgeNotActive();
        if (block.timestamp > p.attestedUntil) revert AttestationExpired();
        if (IBrokerRegistry(_w.brokers).statusOf(p.broker) != BrokerStatus.Active) revert BrokerNotActive();
        if (ICompliance(_w.compliance).tradingPaused(p.assetId)) revert Paused();
        IStockToken token = _token(p.assetId);
        uint256 units = token.toTokens(shares);
        if (units == 0) revert ZeroAmount();
        if (units + p.pendingRelease > p.q - p.m) revert ExceedsSpare();

        uint256 close = IPriceOracle(_w.priceOracle).freshClose(p.assetId);
        uint256 fee = token.valueOf(units, close) * _param(K.MINT_FEE_BPS) / 10_000;
        if (fee > 0) _collectFee(msg.sender, p.broker, fee);

        p.m += units;
        totalM[p.assetId] += units;
        token.mint(msg.sender, units);
        emit Minted(id, shares, units, fee);
        _changed(id);
    }

    function burnAgainst(uint256 id, uint256 units) external nonReentrant {
        Pledge storage p = _pledge(id);
        if (msg.sender != p.minter) revert NotPledgeMinter();
        if (units == 0) revert ZeroAmount();
        if (units > p.m - p.a) revert ExceedsFree();
        _token(p.assetId).burnFrom(msg.sender, units);
        p.m -= units;
        totalM[p.assetId] -= units;
        emit BurnedAgainst(id, units);
        _changed(id);
    }

    /// @notice Volunteer pledges are served by redemptions before normal ones, for a fee rebate.
    function setVolunteer(uint256 id, bool on) external {
        Pledge storage p = _pledge(id);
        if (msg.sender != p.minter) revert NotPledgeMinter();
        p.volunteer = on;
        emit VolunteerSet(id, on);
        _changed(id);
    }

    // ================================================================== stale pledges

    /// @notice If a broker stops re-attesting, anyone can move the pledge's free backing into the reserve,
    ///         funded from the bond at close x (1 + DEFAULT_BONUS), and the broker starts draining.
    function slashStale(uint256 id) external nonReentrant {
        Pledge storage p = _pledge(id);
        if (p.status != PledgeStatus.Active) revert PledgeNotActive();
        if (block.timestamp <= uint256(p.attestedUntil) + _param(K.STALE_GRACE)) revert NotStale();
        uint256 f = p.m - p.a;
        if (f == 0) revert NotStale();
        uint256 paid = _bondSettle(id, p, f, true, "STALE");
        IBrokerRegistry(_w.brokers).markDraining(p.broker);
        emit StaleSlashed(id, f, paid);
        _changed(id);
    }

    // ================================================================== release and migration

    function requestRelease(uint256 id, uint256 shares) external {
        Pledge storage p = _pledge(id);
        if (msg.sender != p.minter) revert NotPledgeMinter();
        if (p.status != PledgeStatus.Active) revert PledgeNotActive();
        uint256 units = _token(p.assetId).toTokens(shares);
        if (units == 0) revert ZeroAmount();
        if (units + p.pendingRelease > p.q - p.m) revert ExceedsSpare();
        p.pendingRelease += units;
        p.releaseDeadline = ISessionClock(_w.sessionClock).closeAfterSessions(_param(K.RELEASE_SESSIONS));
        p.releasePenaltyPaid = false;
        emit ReleaseRequested(id, units, p.releaseDeadline);
        _changed(id);
    }

    function confirmRelease(ReleaseConfirmation calldata c, bytes calldata sig) external {
        Pledge storage p = _pledge(c.pledgeId);
        IBrokerRegistry brokers = IBrokerRegistry(_w.brokers);
        bytes32 structHash =
            keccak256(abi.encode(TypeHashes.RELEASE_CONFIRMATION, c.pledgeId, c.quantity, c.nonce));
        address signer = _verifyEither(p.broker, brokers.delegateOf(p.broker), structHash, sig);
        _useNonce(signer, c.nonce);
        uint256 units = _token(p.assetId).toTokens(c.quantity);
        if (units == 0 || units > p.pendingRelease) revert NothingPending();
        p.pendingRelease -= units;
        p.q -= units;
        p.released += units;
        brokers.subExposure(p.broker, p.assetId, units);
        if (p.q == 0 && p.m == 0) p.status = PledgeStatus.Closed;
        emit ReleaseConfirmed(c.pledgeId, units);
        _changed(c.pledgeId);
    }

    /// @notice Paid once per request when the broker misses the release deadline; the pledge turns at-risk.
    function claimReleasePenalty(uint256 id) external nonReentrant {
        Pledge storage p = _pledge(id);
        if (msg.sender != p.minter) revert NotPledgeMinter();
        if (p.pendingRelease == 0) revert NothingPending();
        if (block.timestamp <= p.releaseDeadline) revert DeadlineNotReached();
        if (p.releasePenaltyPaid) revert PenaltyPaid();
        p.releasePenaltyPaid = true;
        (uint256 close,,) = IPriceOracle(_w.priceOracle).closeOf(p.assetId);
        uint256 due = _token(p.assetId).valueOf(p.pendingRelease, close) * _param(K.RELEASE_PENALTY_BPS) / 10_000;
        uint256 paid = IBondVault(_w.bondVault).payFromBond(p.broker, p.minter, due, "RELEASE_PENALTY");
        emit ReleasePenaltyPaid(id, paid);
        _changed(id);
    }

    /// @notice Make-before-break: move minted backing from one pledge to another already-attested pledge of the
    ///         same minter and asset, so the old one's spare grows and it can be released.
    function migrate(uint256 fromId, uint256 toId, uint256 units) external {
        Pledge storage o = _pledge(fromId);
        Pledge storage n = _pledge(toId);
        if (msg.sender != o.minter || msg.sender != n.minter) revert NotPledgeMinter();
        if (fromId == toId || o.assetId != n.assetId) revert MigrationMismatch();
        if (n.status != PledgeStatus.Active || block.timestamp > n.attestedUntil) revert PledgeNotActive();
        if (IBrokerRegistry(_w.brokers).statusOf(n.broker) != BrokerStatus.Active) revert BrokerNotActive();
        if (units == 0) revert ZeroAmount();
        if (units > o.m - o.a) revert ExceedsFree();
        if (units + n.pendingRelease > n.q - n.m) revert ExceedsSpare();
        o.m -= units;
        n.m += units;
        emit Migrated(fromId, toId, units);
        _changed(fromId);
        _changed(toId);
    }

    // ================================================================== redemption hooks

    function onAllocate(uint256 id, uint256 units) external onlyRedemption {
        Pledge storage p = _pledges[id];
        if (units > p.m - p.a) revert ExceedsFree();
        p.a += units;
        _changed(id);
    }

    function onDeallocate(uint256 id, uint256 units) external onlyRedemption {
        _pledges[id].a -= units;
        _changed(id);
    }

    /// @notice The minter paid the holder: tokens burn, the shares stay pledged and become spare.
    function onCure(uint256 id, uint256 units) external onlyRedemption {
        Pledge storage p = _pledges[id];
        p.a -= units;
        p.m -= units;
        p.cured += units;
        totalM[p.assetId] -= units;
        _changed(id);
    }

    /// @notice The broker invoked and sold the shares and paid the holder.
    function onSettle(uint256 id, uint256 units) external onlyRedemption {
        Pledge storage p = _pledges[id];
        p.a -= units;
        p.m -= units;
        p.q -= units;
        p.invoked += units;
        totalM[p.assetId] -= units;
        lastInvokedAt[p.minter] = uint64(block.timestamp);
        IBrokerRegistry(_w.brokers).subExposure(p.broker, p.assetId, units);
        if (p.q == 0 && p.m == 0) p.status = PledgeStatus.Closed;
        _changed(id);
    }

    /// @notice The bond paid for `paidUnits`; the shares stay with the broker. `unpaidUnits` go back to free.
    function onDefault(uint256 id, uint256 paidUnits, uint256 unpaidUnits) external onlyRedemption {
        Pledge storage p = _pledges[id];
        p.a -= paidUnits + unpaidUnits;
        p.m -= paidUnits;
        p.q -= paidUnits;
        p.bondSettled += paidUnits;
        totalM[p.assetId] -= paidUnits;
        if (paidUnits > 0) IBrokerRegistry(_w.brokers).subExposure(p.broker, p.assetId, paidUnits);
        if (p.q == 0 && p.m == 0) p.status = PledgeStatus.Closed;
        _changed(id);
    }

    /// @notice A defaulted broker with an empty bond cannot pay anyone: its pledge's free backing is written off
    ///         as unbacked so the queue stops routing redemptions to it.
    function writeOffInsolvent(uint256 id) external onlyRedemption returns (uint256 units) {
        Pledge storage p = _pledges[id];
        units = p.m - p.a;
        if (units == 0) return 0;
        p.m -= units;
        p.q -= units;
        totalM[p.assetId] -= units;
        unbacked[p.assetId] += units;
        IBrokerRegistry(_w.brokers).subExposure(p.broker, p.assetId, units);
        emit WrittenOff(id, units);
        _changed(id);
    }

    function addUnbacked(uint32 assetId, uint256 units) external onlyRedemption {
        unbacked[assetId] += units;
    }

    // ================================================================== views

    function count() external view returns (uint256) {
        return _pledges.length - 1;
    }

    function pledgeOf(uint256 id) external view returns (Pledge memory) {
        return _pledges[id];
    }

    function ledger(uint256 id) external view returns (uint256 q, uint256 m, uint256 a, uint256 f, uint256 s) {
        Pledge storage p = _pledges[id];
        return (p.q, p.m, p.a, p.m - p.a, p.q - p.m);
    }

    function freeOf(uint256 id) external view returns (uint256) {
        Pledge storage p = _pledges[id];
        return p.m - p.a;
    }

    /// @notice What the redemption dispatcher needs to rank a pledge.
    function routeInfo(uint256 id) external view returns (address broker, address minter, uint256 f, uint32 assetId) {
        Pledge storage p = _pledges[id];
        return (p.broker, p.minter, p.m - p.a, p.assetId);
    }

    function pledgesOf(address minter) external view returns (uint256[] memory) {
        return _byMinter[minter];
    }

    function pledgesByBroker(address broker) external view returns (uint256[] memory) {
        return _byBroker[broker];
    }

    function pledgeCountByBroker(address broker) external view returns (uint256) {
        return _byBroker[broker].length;
    }

    function pledgeOfBrokerAt(address broker, uint256 i) external view returns (uint256) {
        return _byBroker[broker][i];
    }

    function pledgesByAsset(uint32 assetId) external view returns (uint256[] memory) {
        return _byAsset[assetId];
    }

    /// @notice Where the queue serves this pledge from, and whether it belongs in the queue at all.
    function levelInfo(uint256 id) public view returns (bool member, uint32 assetId, uint256 f, Level level) {
        Pledge storage p = _pledges[id];
        assetId = p.assetId;
        f = p.m - p.a;
        member = p.status == PledgeStatus.Active && f > 0;
        level = _levelOf(p);
    }

    function isAtRisk(uint256 id) external view returns (bool) {
        return _atRisk(_pledges[id]);
    }

    // ================================================================== internal

    function _levelOf(Pledge storage p) private view returns (Level) {
        BrokerStatus s = IBrokerRegistry(_w.brokers).statusOf(p.broker);
        if (s == BrokerStatus.Draining || s == BrokerStatus.Defaulted || s == BrokerStatus.Exited) return Level.Drain;
        if (p.volunteer) return Level.Volunteer;
        if (_atRisk(p)) return Level.AtRisk;
        return Level.Normal;
    }

    function _atRisk(Pledge storage p) private view returns (bool) {
        if (p.status != PledgeStatus.Active) return false;
        if (p.attestedUntil < block.timestamp + _param(K.ATRISK_WINDOW)) return true;
        if (p.pendingRelease > 0 && block.timestamp > p.releaseDeadline) return true;
        return IBrokerRegistry(_w.brokers).health(p.broker) < _param(K.ATRISK_HEALTH_BPS);
    }

    function _checkAttestation(Pledge storage p, PledgeAttestation calldata a, bytes calldata sig)
        private
        returns (address signer)
    {
        if (a.minter != p.minter) revert NotPledgeMinter();
        if (a.isinHash != IAssetFactory(_w.assets).isinHashOf(p.assetId)) revert QuantityMismatch();
        if (a.validUntil <= block.timestamp) revert AttestationExpired();
        if (a.validUntil > block.timestamp + _param(K.ATTEST_TTL)) revert AttestationTooLong();
        bytes32 structHash = keccak256(
            abi.encode(
                TypeHashes.PLEDGE_ATTESTATION,
                a.pledgeId,
                a.psnHash,
                a.isinHash,
                a.quantity,
                a.minter,
                a.validUntil,
                a.nonce
            )
        );
        signer = _verifyEither(p.broker, IBrokerRegistry(_w.brokers).delegateOf(p.broker), structHash, sig);
        _useNonce(signer, a.nonce);
    }

    /// @dev Moves `units` of free backing into the reserve, paid from the bond at close x (1 + bonus). Whatever
    ///      the bond cannot cover becomes unbacked. `reduceQ` also removes the shares from the pledge.
    function _bondSettle(uint256 id, Pledge storage p, uint256 units, bool reduceQ, bytes32 reason)
        private
        returns (uint256 paid)
    {
        (uint256 close,,) = IPriceOracle(_w.priceOracle).closeOf(p.assetId);
        uint256 due = _token(p.assetId).valueOf(units, close) * (10_000 + _param(K.DEFAULT_BONUS_BPS)) / 10_000;
        address engine = _w.redemption;
        paid = IBondVault(_w.bondVault).payFromBond(p.broker, engine, due, reason);
        uint256 paidUnits = due == 0 ? units : units * paid / due;
        p.m -= units;
        p.bondSettled += units;
        totalM[p.assetId] -= units;
        if (reduceQ) {
            p.q -= units;
            IBrokerRegistry(_w.brokers).subExposure(p.broker, p.assetId, units);
        }
        if (units > paidUnits) unbacked[p.assetId] += units - paidUnits;
        IRedemptionEngine(engine).addReserve(p.assetId, paidUnits, paid);
        emit BondSettled(id, units, paidUnits, paid, reason);
    }

    function _collectFee(address payer, address broker, uint256 fee) private {
        IERC20 usdc = IERC20(_w.usdc);
        uint256 brokerShare = fee * _param(K.BROKER_FEE_SHARE_BPS) / 10_000;
        if (brokerShare > 0) usdc.safeTransferFrom(payer, broker, brokerShare);
        if (fee > brokerShare) usdc.safeTransferFrom(payer, _w.treasury, fee - brokerShare);
    }

    function _closePending(uint256 id, Pledge storage p) private {
        if (p.status != PledgeStatus.Pending) revert PledgeNotPending();
        p.status = PledgeStatus.Rejected;
        IBrokerRegistry(_w.brokers).subExposure(p.broker, p.assetId, p.q);
        emit PledgeCancelled(id, PledgeStatus.Rejected);
        _changed(id);
    }

    function _changed(uint256 id) private {
        Pledge storage p = _pledges[id];
        emit LedgerChanged(id, p.q, p.m, p.a);
        ILevelBook(_w.levelBook).sync(id);
    }

    function _pledge(uint256 id) private view returns (Pledge storage p) {
        if (id == 0 || id >= _pledges.length) revert PledgeNotActive();
        p = _pledges[id];
    }

    function _token(uint32 assetId) private view returns (IStockToken) {
        return IStockToken(IAssetFactory(_w.assets).tokenOf(assetId));
    }

    function _param(bytes32 key) private view returns (uint256) {
        return IParams(_w.params).get(key);
    }
}
