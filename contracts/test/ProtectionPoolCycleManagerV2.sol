// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ProtectionPoolCycleManager} from "../core/ProtectionPoolCycleManager.sol";

/// Contract to test the ProtectionPoolCycleManager upgradeability
contract ProtectionPoolCycleManagerV2 is ProtectionPoolCycleManager {
  function getVersion() external pure returns (string memory) {
    return "v2";
  }
}

contract ProtectionPoolCycleManagerV2NotUpgradable {}
