// // SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ProtectionPoolParams} from "./IProtectionPool.sol";

/// @notice Interface for premium calculator contract
abstract contract IPremiumCalculator {
  /**
   * @notice Calculates the premium amount in underlying tokens
   * and specifies whether returned premium is a minimum premium or not.
   * @param _protectionDurationInSeconds the protection duration in seconds since unix epoch.
   * @param _protectionAmount the protection amount in underlying tokens scaled to 18 decimals
   * @param _protectionBuyerApy the protection buyer's APY scaled to 18 decimals
   * @param _leverageRatio the leverage ratio of the pool scaled to 18 decimals
   * @param _totalCapital the total capital of the pool scaled to underlying decimals
   * @param _poolParameters the pool parameters
   * @return _premiumAmount the premium amount in underlying tokens scaled to 18 decimals
   * @return _isMinPremium indicates whether the returned premium is the minimum premium or not
   */
  function calculatePremium(
    uint256 _protectionDurationInSeconds,
    uint256 _protectionAmount,
    uint256 _protectionBuyerApy,
    uint256 _leverageRatio,
    uint256 _totalCapital,
    ProtectionPoolParams calldata _poolParameters
  ) external view virtual returns (uint256 _premiumAmount, bool _isMinPremium);
}
