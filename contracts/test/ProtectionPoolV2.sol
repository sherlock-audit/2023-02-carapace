// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ProtectionPool} from "../core/pool/ProtectionPool.sol";

/// Contract to test the ProtectionPool upgradeability
contract ProtectionPoolV2 is ProtectionPool {
  mapping(address => uint256) public testMapping;

  function addToTestMapping(address _address, uint256 _testVariable) external {
    testMapping[_address] = _testVariable;
  }
}

contract ProtectionPoolV2NotUpgradable {}
