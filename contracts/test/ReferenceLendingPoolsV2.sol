// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ReferenceLendingPools} from "../core/pool/ReferenceLendingPools.sol";

/// Contract to test the ReferenceLendingPools upgradeability
contract ReferenceLendingPoolsV2 is ReferenceLendingPools {
  uint256 public testVariable;

  function setTestVariable(uint256 _testVariable) external {
    testVariable = _testVariable;
  }

  function getTestVariable() external view returns (uint256) {
    return testVariable;
  }
}

contract ReferenceLendingPoolsNotUpgradable {}
