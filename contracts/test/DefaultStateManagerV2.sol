// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {DefaultStateManager} from "../core/DefaultStateManager.sol";

/// Contract to test the DefaultStateManager upgradeability
contract DefaultStateManagerV2 is DefaultStateManager {
  function getVersion() external pure returns (string memory) {
    return "v2";
  }
}

contract DefaultStateManagerV2NotUpgradable {}
