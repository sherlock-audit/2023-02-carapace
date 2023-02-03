// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {GoldfinchAdapter} from "../adapters/GoldfinchAdapter.sol";

/// Contract to test the GoldfinchAdapter upgradeability
contract GoldfinchAdapterV2 is GoldfinchAdapter {
  function getVersion() external pure returns (string memory) {
    return "v2";
  }
}

contract GoldfinchAdapterNotUpgradable {}
