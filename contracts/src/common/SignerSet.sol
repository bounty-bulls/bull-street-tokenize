// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {BadParam} from "./Errors.sol";

/// @title SignerSet
/// @notice An owner-managed set of oracle signers with an m-of-n threshold (2-of-3 by default).
abstract contract SignerSet is Ownable2Step {
    mapping(address => bool) public isSigner;
    address[] internal _signers;
    uint256 public threshold;

    event SignersSet(address[] signers, uint256 threshold);

    function signers() external view returns (address[] memory) {
        return _signers;
    }

    function setSigners(address[] calldata s, uint256 t) external onlyOwner {
        _setSigners(s, t);
    }

    function _setSigners(address[] memory s, uint256 t) internal {
        if (t == 0 || t > s.length) revert BadParam();
        for (uint256 i; i < _signers.length; ++i) {
            isSigner[_signers[i]] = false;
        }
        delete _signers;
        for (uint256 i; i < s.length; ++i) {
            if (s[i] == address(0) || isSigner[s[i]]) revert BadParam();
            isSigner[s[i]] = true;
            _signers.push(s[i]);
        }
        threshold = t;
        emit SignersSet(s, t);
    }
}
