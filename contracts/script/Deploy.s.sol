// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Directory} from "../src/common/Directory.sol";
import {Params, K} from "../src/common/Params.sol";
import {SessionClock} from "../src/oracle/SessionClock.sol";
import {PriceOracle} from "../src/oracle/PriceOracle.sol";
import {Compliance} from "../src/compliance/Compliance.sol";
import {RoleRegistry} from "../src/identity/RoleRegistry.sol";
import {AssetFactory} from "../src/asset/AssetFactory.sol";
import {BondVault} from "../src/broker/BondVault.sol";
import {BrokerRegistry} from "../src/broker/BrokerRegistry.sol";
import {LevelBook} from "../src/pledge/LevelBook.sol";
import {PledgeRegistry} from "../src/pledge/PledgeRegistry.sol";
import {RedemptionEngine} from "../src/redemption/RedemptionEngine.sol";
import {BullStreetExchange} from "../src/exchange/BullStreetExchange.sol";
import {Wired} from "../src/common/Wired.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// @notice Deploys and wires Bull Street.
/// Env:
///   DEPLOYER_PRIVATE_KEY      owner of every admin contract
///   USDC_ADDRESS              USDC ERC-20 (Arc: 0x3600...0000). Unset on a local chain: a MockUSDC is deployed
///   WORLD_ATTESTOR_ADDRESS    server key that signs World ID role attestations
///   ORACLE_SIGNERS            comma-separated oracle signer addresses (default threshold 2)
///   ORACLE_THRESHOLD          optional, default 2
///   TREASURY                  optional, default the deployer
///   CALENDAR_MODE             "compressed" (short sessions, scaled time parameters) or "nse"
///   DEMO_SCALE                optional divisor for tier caps and minimum bonds (default 1)
contract Deploy is Script {
    struct Out {
        address usdc;
        Directory dir;
        Params params;
        SessionClock clock;
        PriceOracle oracle;
        Compliance compliance;
        RoleRegistry roles;
        AssetFactory factory;
        BondVault vault;
        BrokerRegistry brokers;
        LevelBook book;
        PledgeRegistry pledges;
        RedemptionEngine engine;
        BullStreetExchange exchange;
        uint32[3] assetIds;
        address[3] tokens;
    }

    function run() external returns (Out memory o) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(pk);
        address treasury = vm.envOr("TREASURY", owner);
        address attestor = vm.envAddress("WORLD_ATTESTOR_ADDRESS");
        address[] memory signers = vm.envAddress("ORACLE_SIGNERS", ",");
        uint256 threshold = vm.envOr("ORACLE_THRESHOLD", uint256(2));
        string memory mode = vm.envOr("CALENDAR_MODE", string("nse"));
        uint256 scale = vm.envOr("DEMO_SCALE", uint256(1));

        vm.startBroadcast(pk);
        o.usdc = vm.envOr("USDC_ADDRESS", address(0));
        if (o.usdc == address(0)) o.usdc = address(new MockUSDC());

        o.dir = new Directory(owner);
        o.params = new Params(owner);
        o.clock = new SessionClock(o.dir, owner, signers, threshold);
        o.oracle = new PriceOracle(o.dir, owner, signers, threshold);
        o.compliance = new Compliance(owner);
        o.roles = new RoleRegistry(owner, attestor);
        o.factory = new AssetFactory(o.dir, owner);
        o.vault = new BondVault(o.dir);
        o.brokers = new BrokerRegistry(o.dir);
        o.book = new LevelBook(o.dir);
        o.pledges = new PledgeRegistry(o.dir);
        o.engine = new RedemptionEngine(o.dir);
        o.exchange = new BullStreetExchange(o.dir);

        o.dir.setAll(
            Directory.Addresses({
                usdc: o.usdc,
                treasury: treasury,
                params: address(o.params),
                sessionClock: address(o.clock),
                priceOracle: address(o.oracle),
                compliance: address(o.compliance),
                roles: address(o.roles),
                assets: address(o.factory),
                bondVault: address(o.vault),
                brokers: address(o.brokers),
                levelBook: address(o.book),
                pledges: address(o.pledges),
                redemption: address(o.engine),
                exchange: address(o.exchange)
            })
        );
        Wired[8] memory wired = [
            Wired(address(o.clock)),
            Wired(address(o.oracle)),
            Wired(address(o.vault)),
            Wired(address(o.brokers)),
            Wired(address(o.book)),
            Wired(address(o.pledges)),
            Wired(address(o.engine)),
            Wired(address(o.exchange))
        ];
        for (uint256 i; i < 8; ++i) {
            wired[i].refreshWiring();
        }

        _setParams(o.params, mode, scale);

        string[3] memory isins = ["INE002A01018", "INE467B01029", "INE009A01021"];
        string[3] memory tickers = ["RELIANCE", "TCS", "INFY"];
        string[3] memory names = ["Reliance Industries", "Tata Consultancy Services", "Infosys"];
        for (uint256 i; i < 3; ++i) {
            (o.assetIds[i], o.tokens[i]) = o.factory.createAsset(isins[i], tickers[i], names[i]);
        }
        vm.stopBroadcast();

        _write(o, mode, scale, treasury, attestor, signers, threshold);
    }

    function _setParams(Params p, string memory mode, uint256 scale) internal {
        if (scale > 1) {
            bytes32[6] memory money = [K.TIER_CAP_1, K.TIER_CAP_2, K.TIER_CAP_3, K.MIN_BOND_1, K.MIN_BOND_2, K.MIN_BOND_3];
            for (uint256 i; i < money.length; ++i) {
                p.set(money[i], p.get(money[i]) / scale);
            }
        }
        if (keccak256(bytes(mode)) == keccak256("compressed")) {
            // 10-minute sessions, 20-minute gaps, an 80-minute "weekend" after every fifth session.
            p.set(K.CURE_GRACE, 3 minutes);
            p.set(K.HEALTH_CURE, 20 minutes);
            p.set(K.ATTEST_TTL, 2 hours);
            p.set(K.ATRISK_WINDOW, 30 minutes);
            p.set(K.STALE_GRACE, 30 minutes);
            p.set(K.PENDING_PLEDGE_TTL, 2 hours);
            p.set(K.EXT_CLOSURE, 45 minutes);
            p.set(K.MAX_ORDER_TTL, 1 days);
        }
    }

    function _write(
        Out memory o,
        string memory mode,
        uint256 scale,
        address treasury,
        address attestor,
        address[] memory signers,
        uint256 threshold
    ) internal {
        string memory k = "deploy";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", block.number);
        vm.serializeString(k, "calendarMode", mode);
        vm.serializeUint(k, "demoScale", scale);
        vm.serializeAddress(k, "owner", o.dir.owner());
        vm.serializeAddress(k, "treasury", treasury);
        vm.serializeAddress(k, "worldAttestor", attestor);
        vm.serializeAddress(k, "oracleSigners", signers);
        vm.serializeUint(k, "oracleThreshold", threshold);
        vm.serializeAddress(k, "usdc", o.usdc);
        vm.serializeAddress(k, "directory", address(o.dir));
        vm.serializeAddress(k, "params", address(o.params));
        vm.serializeAddress(k, "sessionClock", address(o.clock));
        vm.serializeAddress(k, "priceOracle", address(o.oracle));
        vm.serializeAddress(k, "compliance", address(o.compliance));
        vm.serializeAddress(k, "roles", address(o.roles));
        vm.serializeAddress(k, "assets", address(o.factory));
        vm.serializeAddress(k, "bondVault", address(o.vault));
        vm.serializeAddress(k, "brokers", address(o.brokers));
        vm.serializeAddress(k, "levelBook", address(o.book));
        vm.serializeAddress(k, "pledges", address(o.pledges));
        vm.serializeAddress(k, "redemption", address(o.engine));
        vm.serializeAddress(k, "exchange", address(o.exchange));
        address[] memory tokens = new address[](3);
        for (uint256 i; i < 3; ++i) {
            tokens[i] = o.tokens[i];
        }
        string memory json = vm.serializeAddress(k, "tokens", tokens);
        string memory dirPath = string.concat(vm.projectRoot(), "/../deploy/", vm.toString(block.chainid));
        vm.createDir(dirPath, true);
        vm.writeJson(json, string.concat(dirPath, "/addresses.json"));
        console2.log("Bull Street deployed. Directory:", address(o.dir));
    }
}
