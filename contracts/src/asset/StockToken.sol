// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Directory} from "../common/Directory.sol";
import {ICompliance} from "../interfaces/IBullStreet.sol";
import {BadParam, NotFrozen, NotWired} from "../common/Errors.sol";

/// @title StockToken
/// @notice A pledge-backed token for one NSE stock (e.g. bRELIANCE). Standard ERC-20 with 18 decimals; only the
///         pledge registry and the redemption engine can mint or burn. Every transfer passes compliance.
///         Corporate actions (splits, bonuses) change the shares-per-token multiplier instead of balances, so the
///         token never rebases: after a 1:1 bonus, one token stands for two shares.
contract StockToken is ERC20 {
    Directory public immutable dir;
    address public immutable factory;
    uint32 public immutable assetId;

    /// @dev Shares per token = mulNum / mulDen (starts at 1).
    uint128 public mulNum = 1;
    uint128 public mulDen = 1;

    event CorporateActionApplied(uint128 num, uint128 den, uint128 newNum, uint128 newDen);

    constructor(Directory dir_, uint32 assetId_, string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        dir = dir_;
        factory = msg.sender;
        assetId = assetId_;
    }

    modifier onlyProtocol() {
        if (msg.sender != dir.pledges() && msg.sender != dir.redemption()) revert NotWired();
        _;
    }

    function mint(address to, uint256 amount) external onlyProtocol {
        _mint(to, amount);
    }

    function burnFrom(address from, uint256 amount) external onlyProtocol {
        _burn(from, amount);
    }

    /// @notice Multiply shares-per-token by num/den (e.g. 2/1 for a 1:1 bonus or a 2-for-1 split).
    function applyCorporateAction(uint128 num, uint128 den) external {
        if (msg.sender != factory) revert NotWired();
        if (num == 0 || den == 0) revert BadParam();
        if (!ICompliance(dir.compliance()).frozen(assetId)) revert NotFrozen();
        uint256 n = uint256(mulNum) * num;
        uint256 d = uint256(mulDen) * den;
        uint256 g = _gcd(n, d);
        n /= g;
        d /= g;
        if (n > type(uint128).max || d > type(uint128).max) revert BadParam();
        emit CorporateActionApplied(num, den, uint128(n), uint128(d));
        mulNum = uint128(n);
        mulDen = uint128(d);
    }

    // ------------------------------------------------------------------ conversions

    /// @notice Shares per token, 18-decimal fixed point (1e18 = one share per token).
    function sharesPerToken() external view returns (uint256) {
        return uint256(mulNum) * 1e18 / mulDen;
    }

    function toTokens(uint256 shares) public view returns (uint256) {
        return Math.mulDiv(shares * 1e18, mulDen, mulNum);
    }

    function toShares(uint256 tokens) public view returns (uint256) {
        return Math.mulDiv(tokens, mulNum, uint256(mulDen) * 1e18);
    }

    function isWholeShares(uint256 tokens) external view returns (bool) {
        return mulmod(tokens, mulNum, uint256(mulDen) * 1e18) == 0;
    }

    /// @notice USDC value (6 decimals) of `tokens` at `pricePerShare` (USDC, 6 decimals).
    function valueOf(uint256 tokens, uint256 pricePerShare) external view returns (uint256) {
        return Math.mulDiv(tokens, pricePerShare * mulNum, uint256(mulDen) * 1e18);
    }

    function _update(address from, address to, uint256 value) internal override {
        ICompliance(dir.compliance()).check(from, to, assetId);
        super._update(from, to, value);
    }

    function _gcd(uint256 a, uint256 b) private pure returns (uint256) {
        while (b != 0) (a, b) = (b, a % b);
        return a;
    }
}
