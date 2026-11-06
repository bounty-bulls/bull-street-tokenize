// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {Directory} from "../../src/common/Directory.sol";
import {Params, K} from "../../src/common/Params.sol";
import {TypeHashes} from "../../src/common/Attestations.sol";
import {Role, Tier, Level, Pledge, Ticket, Allocation} from "../../src/common/Types.sol";
import {SessionClock} from "../../src/oracle/SessionClock.sol";
import {PriceOracle} from "../../src/oracle/PriceOracle.sol";
import {Compliance} from "../../src/compliance/Compliance.sol";
import {RoleRegistry} from "../../src/identity/RoleRegistry.sol";
import {AssetFactory} from "../../src/asset/AssetFactory.sol";
import {StockToken} from "../../src/asset/StockToken.sol";
import {BondVault} from "../../src/broker/BondVault.sol";
import {BrokerRegistry} from "../../src/broker/BrokerRegistry.sol";
import {LevelBook} from "../../src/pledge/LevelBook.sol";
import {PledgeRegistry} from "../../src/pledge/PledgeRegistry.sol";
import {RedemptionEngine} from "../../src/redemption/RedemptionEngine.sol";
import {BullStreetExchange} from "../../src/exchange/BullStreetExchange.sol";

/// @notice Deploys and wires the whole protocol on a Mon-Fri calendar starting Monday 2026-11-02, with three
///         assets, two oracle signers out of three, and persona wallets.
abstract contract Base is Test {
    // Monday 2026-11-02 00:00 UTC. NSE: 09:15-15:30 IST = 03:45-10:00 UTC.
    uint64 internal constant MONDAY = 1_793_577_600;
    uint64 internal constant OPEN_OFF = 3 hours + 45 minutes;
    uint64 internal constant CLOSE_OFF = 10 hours;

    MockUSDC internal usdc;
    Directory internal dir;
    Params internal params;
    SessionClock internal clock;
    PriceOracle internal oracle;
    Compliance internal compliance;
    RoleRegistry internal roles;
    AssetFactory internal factory;
    BondVault internal vault;
    BrokerRegistry internal brokers;
    LevelBook internal book;
    PledgeRegistry internal pledges;
    RedemptionEngine internal engine;
    BullStreetExchange internal exchange;

    uint32 internal REL;
    uint32 internal TCS;
    uint32 internal INFY;
    StockToken internal rel;

    address internal treasury = makeAddr("treasury");
    uint256[3] internal oracleKeys = [uint256(0xA11), 0xA12, 0xA13];
    uint256 internal worldKey = 0xB0B0;

    address internal alice;
    address internal carol;
    address internal dev;
    uint256 internal aliceKey;
    address internal brokerX;
    address internal brokerY;
    address internal brokerZ;
    uint256 internal xKey;
    uint256 internal yKey;
    uint256 internal zKey;
    address internal bob = makeAddr("bob");
    address internal eve = makeAddr("eve");
    address internal fay = makeAddr("fay");

    uint32 internal sessionCount;
    uint256 internal nonceSeq = 1;
    uint256 internal nullSeq = 1;

    function setUp() public virtual {
        vm.warp(MONDAY + 1 hours); // before the first session opens
        usdc = new MockUSDC();
        dir = new Directory(address(this));
        params = new Params(address(this));
        address[] memory signers = new address[](3);
        for (uint256 i; i < 3; ++i) {
            signers[i] = vm.addr(oracleKeys[i]);
        }
        clock = new SessionClock(dir, address(this), signers, 2);
        oracle = new PriceOracle(dir, address(this), signers, 2);
        compliance = new Compliance(address(this));
        roles = new RoleRegistry(address(this), vm.addr(worldKey));
        factory = new AssetFactory(dir, address(this));
        vault = new BondVault(dir);
        brokers = new BrokerRegistry(dir);
        book = new LevelBook(dir);
        pledges = new PledgeRegistry(dir);
        engine = new RedemptionEngine(dir);
        exchange = new BullStreetExchange(dir);

        dir.setAll(
            Directory.Addresses({
                usdc: address(usdc),
                treasury: treasury,
                params: address(params),
                sessionClock: address(clock),
                priceOracle: address(oracle),
                compliance: address(compliance),
                roles: address(roles),
                assets: address(factory),
                bondVault: address(vault),
                brokers: address(brokers),
                levelBook: address(book),
                pledges: address(pledges),
                redemption: address(engine),
                exchange: address(exchange)
            })
        );
        clock.refreshWiring();
        oracle.refreshWiring();
        vault.refreshWiring();
        brokers.refreshWiring();
        book.refreshWiring();
        pledges.refreshWiring();
        engine.refreshWiring();
        exchange.refreshWiring();

        (REL,) = factory.createAsset("INE002A01018", "RELIANCE", "Reliance Industries");
        (TCS,) = factory.createAsset("INE467B01029", "TCS", "Tata Consultancy Services");
        (INFY,) = factory.createAsset("INE009A01021", "INFY", "Infosys");
        rel = StockToken(factory.tokenOf(REL));

        _postSessions(60);

        (alice, aliceKey) = makeAddrAndKey("alice");
        carol = makeAddr("carol");
        dev = makeAddr("dev");
        (brokerX, xKey) = makeAddrAndKey("brokerX");
        (brokerY, yKey) = makeAddrAndKey("brokerY");
        (brokerZ, zKey) = makeAddrAndKey("brokerZ");
        _register(alice, Role.Minter);
        _register(carol, Role.Minter);
        _register(dev, Role.Minter);
        _register(brokerX, Role.Broker);
        _register(brokerY, Role.Broker);
        _register(brokerZ, Role.Broker);

        address[9] memory all = [alice, carol, dev, brokerX, brokerY, brokerZ, bob, eve, fay];
        for (uint256 i; i < all.length; ++i) {
            usdc.mint(all[i], 1_000_000e6);
            vm.startPrank(all[i]);
            usdc.approve(address(vault), type(uint256).max);
            usdc.approve(address(pledges), type(uint256).max);
            usdc.approve(address(engine), type(uint256).max);
            usdc.approve(address(exchange), type(uint256).max);
            vm.stopPrank();
        }

        // Session 0 runs Monday; post its closes so prices are fresh.
        _warpClose(0, 1 minutes);
        _postPrice(REL, 0, 15e6);
        _postPrice(TCS, 0, 40e6);
        _postPrice(INFY, 0, 18e6);
    }

    // ------------------------------------------------------------------ calendar

    function _sessionTimes(uint256 i) internal pure returns (uint64 open, uint64 close) {
        uint256 day = (i / 5) * 7 + (i % 5); // Mon-Fri only
        open = MONDAY + uint64(day) * 1 days + OPEN_OFF;
        close = MONDAY + uint64(day) * 1 days + CLOSE_OFF;
    }

    function _postSessions(uint256 n) internal {
        SessionClock.SessionInfo[] memory s = new SessionClock.SessionInfo[](n);
        bytes32[] memory hashes = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            (uint64 o, uint64 c) = _sessionTimes(sessionCount + i);
            s[i] = SessionClock.SessionInfo(uint32(sessionCount + i), o, c);
            hashes[i] = keccak256(abi.encode(TypeHashes.SESSION_INFO, s[i].sessionIndex, o, c));
        }
        uint256 nonce = nonceSeq++;
        bytes32 structHash = keccak256(abi.encode(TypeHashes.SESSION_BATCH, keccak256(abi.encodePacked(hashes)), nonce));
        clock.postSessions(s, nonce, _oracleSigs(clock.domainSeparator(), structHash));
        sessionCount += uint32(n);
    }

    function _warpOpen(uint256 i, uint256 plus) internal {
        (uint64 o,) = _sessionTimes(i);
        vm.warp(o + plus);
    }

    function _warpClose(uint256 i, uint256 plus) internal {
        (, uint64 c) = _sessionTimes(i);
        vm.warp(c + plus);
    }

    // ------------------------------------------------------------------ oracle

    function _postPrice(uint32 asset, uint32 session, uint256 close) internal {
        uint32[] memory a = new uint32[](1);
        uint256[] memory c = new uint256[](1);
        a[0] = asset;
        c[0] = close;
        _postPrices(session, a, c);
    }

    function _postPrices(uint32 session, uint32[] memory a, uint256[] memory c) internal {
        (uint64 asOf, uint256 nonce, bytes[] memory sigs) = _priceSigs(session, a, c);
        oracle.postBatch(session, a, c, asOf, nonce, sigs);
    }

    function _priceSigs(uint32 session, uint32[] memory a, uint256[] memory c)
        internal
        returns (uint64 asOf, uint256 nonce, bytes[] memory sigs)
    {
        nonce = nonceSeq++;
        asOf = uint64(block.timestamp);
        bytes32 structHash = keccak256(
            abi.encode(
                TypeHashes.PRICE_BATCH,
                session,
                keccak256(abi.encodePacked(a)),
                keccak256(abi.encodePacked(c)),
                asOf,
                nonce
            )
        );
        sigs = _oracleSigs(oracle.domainSeparator(), structHash);
    }

    /// @dev Posts the close of every session that has ended since the last post, at the same price.
    function _postAll(uint32 session, uint256 relClose) internal {
        uint32[] memory a = new uint32[](3);
        uint256[] memory c = new uint256[](3);
        (a[0], a[1], a[2]) = (REL, TCS, INFY);
        (c[0], c[1], c[2]) = (relClose, 40e6, 18e6);
        _postPrices(session, a, c);
    }

    function _oracleSigs(bytes32 domain, bytes32 structHash) internal view returns (bytes[] memory sigs) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        uint256 k0 = oracleKeys[0];
        uint256 k1 = oracleKeys[1];
        if (vm.addr(k0) > vm.addr(k1)) (k0, k1) = (k1, k0);
        sigs = new bytes[](2);
        sigs[0] = _sign(k0, digest);
        sigs[1] = _sign(k1, digest);
    }

    // ------------------------------------------------------------------ signatures

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _digest(bytes32 domain, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _register(address wallet, Role role) internal {
        _registerWith(wallet, role, keccak256(abi.encode("nullifier", nullSeq++)));
    }

    function _registerWith(address wallet, Role role, bytes32 nullifier) internal {
        RoleRegistry.RoleAttestation memory a =
            RoleRegistry.RoleAttestation(wallet, uint8(role), nullifier, uint64(block.timestamp + 15 minutes), nonceSeq++);
        bytes memory sig = _sign(
            worldKey,
            _digest(
                roles.domainSeparator(),
                keccak256(abi.encode(TypeHashes.ROLE_ATTESTATION, a.wallet, a.role, a.nullifierHash, a.expiry, a.nonce))
            )
        );
        vm.prank(wallet);
        roles.register(a, sig);
    }

    function _pledgeAttestation(uint256 id, uint256 shares, uint64 validUntil, bytes32 psn)
        internal
        returns (PledgeRegistry.PledgeAttestation memory a)
    {
        Pledge memory p = pledges.pledgeOf(id);
        a = PledgeRegistry.PledgeAttestation(id, psn, factory.isinHashOf(p.assetId), shares, p.minter, validUntil, nonceSeq++);
    }

    function _signPledge(uint256 key, PledgeRegistry.PledgeAttestation memory a) internal view returns (bytes memory) {
        return _sign(
            key,
            _digest(
                pledges.domainSeparator(),
                keccak256(
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
                )
            )
        );
    }

    function _signRelease(uint256 key, PledgeRegistry.ReleaseConfirmation memory c) internal view returns (bytes memory) {
        return _sign(
            key,
            _digest(
                pledges.domainSeparator(),
                keccak256(abi.encode(TypeHashes.RELEASE_CONFIRMATION, c.pledgeId, c.quantity, c.nonce))
            )
        );
    }

    function _signSale(uint256 key, RedemptionEngine.SaleReport memory r) internal view returns (bytes memory) {
        return _sign(
            key,
            _digest(
                engine.domainSeparator(),
                keccak256(
                    abi.encode(TypeHashes.SALE_REPORT, r.allocationId, r.quantity, r.grossProceeds, r.saleTime, r.nonce)
                )
            )
        );
    }

    // ------------------------------------------------------------------ flows

    function _keyOf(address broker) internal view returns (uint256) {
        if (broker == brokerX) return xKey;
        if (broker == brokerY) return yKey;
        return zKey;
    }

    function _join(address broker, Tier tier, uint256 bond) internal {
        vm.startPrank(broker);
        brokers.join(tier, keccak256(abi.encode("bo", broker)), address(0), "Broker");
        vault.deposit(bond);
        vm.stopPrank();
    }

    function _openAndAttest(address minter, uint32 asset, uint256 shares, address broker) internal returns (uint256 id) {
        vm.prank(minter);
        id = pledges.openPledge(asset, shares, broker, false);
        PledgeRegistry.PledgeAttestation memory a =
            _pledgeAttestation(id, shares, uint64(block.timestamp + 7 days), keccak256(abi.encode("psn", id)));
        pledges.attestPledge(a, _signPledge(_keyOf(broker), a));
    }

    function _mint(address minter, uint256 id, uint256 shares) internal {
        vm.prank(minter);
        pledges.mint(id, shares);
    }

    function _redeem(address holder, uint32 asset, uint256 shares) internal returns (uint256 tid) {
        uint256 units = shares * 1e18;
        vm.startPrank(holder);
        StockToken(factory.tokenOf(asset)).approve(address(engine), units);
        tid = engine.requestRedemption(asset, units, new uint256[](0));
        vm.stopPrank();
    }

    function _settle(uint256 allocId, uint256 shares, uint256 gross) internal {
        Allocation memory al = engine.allocationOf(allocId);
        Pledge memory p = pledges.pledgeOf(al.pledgeId);
        RedemptionEngine.SaleReport memory r =
            RedemptionEngine.SaleReport(allocId, shares, gross, uint64(block.timestamp), nonceSeq++);
        vm.prank(p.broker);
        usdc.approve(address(engine), type(uint256).max);
        engine.settle(r, _signSale(_keyOf(p.broker), r));
    }

    /// @dev I1: token supply = Σ pledge m + reserve units + unbacked.
    function _assertBacking(uint32 asset) internal view {
        (uint256 rUnits,,) = engine.reserveOf(asset);
        assertEq(
            StockToken(factory.tokenOf(asset)).totalSupply(),
            pledges.totalM(asset) + rUnits + pledges.unbacked(asset),
            "I1 backing"
        );
    }

    function _assertLedger(uint256 id) internal view {
        Pledge memory p = pledges.pledgeOf(id);
        assertLe(p.a, p.m, "I2 a<=m");
        assertLe(p.m, p.q, "I2 m<=q");
    }
}
