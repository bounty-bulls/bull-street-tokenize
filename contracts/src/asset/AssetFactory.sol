// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Directory} from "../common/Directory.sol";
import {StockToken} from "./StockToken.sol";
import {AssetExists, AssetUnknown} from "../common/Errors.sol";

/// @title AssetFactory
/// @notice Creates one StockToken per NSE stock: name "Bull Street <Company>", symbol "b<TICKER>".
contract AssetFactory is Ownable2Step {
    struct Asset {
        address token;
        string isin;
        string ticker;
        string name;
    }

    Directory public immutable dir;
    uint32 public count;
    mapping(uint32 => Asset) private _assets;
    mapping(address => uint32) public assetOfToken;
    mapping(bytes32 => uint32) public assetOfIsin;

    event AssetCreated(uint32 indexed assetId, address token, string isin, string ticker, string name);

    constructor(Directory dir_, address owner_) Ownable(owner_) {
        dir = dir_;
    }

    function createAsset(string calldata isin, string calldata ticker, string calldata name)
        external
        onlyOwner
        returns (uint32 assetId, address token)
    {
        bytes32 h = keccak256(bytes(isin));
        if (assetOfIsin[h] != 0) revert AssetExists();
        assetId = ++count;
        token = address(
            new StockToken(dir, assetId, string.concat("Bull Street ", name), string.concat("b", ticker))
        );
        StockToken(token).refreshWiring();
        _assets[assetId] = Asset(token, isin, ticker, name);
        assetOfToken[token] = assetId;
        assetOfIsin[h] = assetId;
        emit AssetCreated(assetId, token, isin, ticker, name);
    }

    /// @notice Apply a split or bonus while the asset is frozen in Compliance.
    function applyCorporateAction(uint32 assetId, uint128 num, uint128 den) external onlyOwner {
        StockToken(tokenOf(assetId)).applyCorporateAction(num, den);
    }

    function assetOf(uint32 assetId) external view returns (Asset memory) {
        if (assetId == 0 || assetId > count) revert AssetUnknown();
        return _assets[assetId];
    }

    function tokenOf(uint32 assetId) public view returns (address) {
        if (assetId == 0 || assetId > count) revert AssetUnknown();
        return _assets[assetId].token;
    }

    function isinHashOf(uint32 assetId) external view returns (bytes32) {
        if (assetId == 0 || assetId > count) revert AssetUnknown();
        return keccak256(bytes(_assets[assetId].isin));
    }
}
