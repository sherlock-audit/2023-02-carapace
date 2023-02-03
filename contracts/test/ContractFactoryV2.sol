// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ContractFactory} from "../core/ContractFactory.sol";

/// Contract to test the ContractFactory upgradeability
contract ContractFactoryV2 is ContractFactory {
  function getVersion() external pure returns (string memory) {
    return "v2";
  }
}

contract ContractFactoryNotUpgradable {}
