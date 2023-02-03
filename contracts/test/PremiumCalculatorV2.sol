// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {PremiumCalculator} from "../core/PremiumCalculator.sol";

/// Contract to test the PremiumCalculator upgradeability
contract PremiumCalculatorV2 is PremiumCalculator {
  function calculatePremiumV2(uint256 _amount) external pure returns (uint256) {
    return _amount * 2;
  }
}
