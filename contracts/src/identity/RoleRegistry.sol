// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Attestations, TypeHashes} from "../common/Attestations.sol";
import {Role} from "../common/Types.sol";
import {BadParam, Expired, NotSender, RoleTaken, ZeroAddress} from "../common/Errors.sol";

/// @title RoleRegistry
/// @notice One human, one role. The backend verifies a World ID Proof of Human (action `bullstreet-role-v1`) and
///         signs a RoleAttestation; this contract records the wallet's role and burns the person's nullifier, so
///         the same person can never also take the other role. Holders need no role.
contract RoleRegistry is Attestations, Ownable2Step {
    struct RoleAttestation {
        address wallet;
        uint8 role;
        bytes32 nullifierHash;
        uint64 expiry;
        uint256 nonce;
    }

    address public worldAttestor;
    mapping(address => Role) private _roleOf;
    mapping(bytes32 => Role) public roleOfNullifier;
    mapping(address => bytes32) public nullifierOf;

    event RoleRegistered(address indexed wallet, Role role, bytes32 indexed nullifierHash);
    event WorldAttestorSet(address attestor);

    constructor(address owner_, address attestor) Ownable(owner_) {
        if (attestor == address(0)) revert ZeroAddress();
        worldAttestor = attestor;
        emit WorldAttestorSet(attestor);
    }

    function setWorldAttestor(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
        worldAttestor = a;
        emit WorldAttestorSet(a);
    }

    function register(RoleAttestation calldata a, bytes calldata sig) external {
        if (msg.sender != a.wallet) revert NotSender();
        if (block.timestamp > a.expiry) revert Expired();
        if (a.role != uint8(Role.Minter) && a.role != uint8(Role.Broker)) revert BadParam();
        if (_roleOf[a.wallet] != Role.None || roleOfNullifier[a.nullifierHash] != Role.None) revert RoleTaken();
        bytes32 structHash =
            keccak256(abi.encode(TypeHashes.ROLE_ATTESTATION, a.wallet, a.role, a.nullifierHash, a.expiry, a.nonce));
        _verifyEither(worldAttestor, address(0), structHash, sig);
        _useNonce(worldAttestor, a.nonce);

        _roleOf[a.wallet] = Role(a.role);
        roleOfNullifier[a.nullifierHash] = Role(a.role);
        nullifierOf[a.wallet] = a.nullifierHash;
        emit RoleRegistered(a.wallet, Role(a.role), a.nullifierHash);
    }

    function roleOf(address wallet) external view returns (uint8) {
        return uint8(_roleOf[wallet]);
    }

    function isMinter(address wallet) external view returns (bool) {
        return _roleOf[wallet] == Role.Minter;
    }

    function isBroker(address wallet) external view returns (bool) {
        return _roleOf[wallet] == Role.Broker;
    }
}
