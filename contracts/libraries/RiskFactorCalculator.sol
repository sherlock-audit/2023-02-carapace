// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@prb/math/contracts/PRBMathSD59x18.sol";

import "./Constants.sol";

import "hardhat/console.sol";

/**
 * @title RiskFactorCalculator
 * @author Carapace Finance
 * @notice Library contract to provide risk factor related calculations.
 * Risk factor is used to calculate the risk premium.
 */
library RiskFactorCalculator {
  using PRBMathSD59x18 for int256;

  /**
   * @notice Calculates and returns the risk factor scaled to 18 decimals.
   * For example: 0.15 is returned as 0.15 x 10**18 = 15 * 10**16
   * All params passed into this function must be scaled to 18 decimals.
   * For example: 0.005 is passed as 0.005 x 10**18 = 5 * 10**15
   * Formula for Risk Factor:
   * curvature * ((leverageRatioCeiling + BUFFER - currentLeverageRatio) / (currentLeverageRatio - leverageRatioFloor - BUFFER))
   * @param _currentLeverageRatio the current leverage ratio of the pool scaled to 18 decimals
   * @param _leverageRatioFloor the minimum leverage ratio allowed in the pool scaled to 18 decimals
   * @param _leverageRatioCeiling the maximum leverage ratio allowed in the pool scaled to 18 decimals
   * @param _leverageRatioBuffer the buffer used in risk factor calculation scaled to 18 decimals
   * @param _curvature the curvature used in risk premium calculation scaled to 18 decimals
   * @return _riskFactor the risk factor scaled to 18 decimals
   */
  function calculateRiskFactor(
    uint256 _currentLeverageRatio,
    uint256 _leverageRatioFloor,
    uint256 _leverageRatioCeiling,
    uint256 _leverageRatioBuffer,
    uint256 _curvature
  ) external view returns (int256 _riskFactor) {
    console.log(
      "Calculating risk factor... leverage ratio: %s, floor: %s, ceiling: %s",
      _currentLeverageRatio,
      _leverageRatioFloor,
      _leverageRatioCeiling
    );

    int256 _numerator = int256(
      (_leverageRatioCeiling + _leverageRatioBuffer) - _currentLeverageRatio
    );

    int256 _denominator = int256(_currentLeverageRatio) -
      int256(_leverageRatioFloor - _leverageRatioBuffer);

    _riskFactor = (int256(_curvature) * _numerator) / _denominator;
    console.logInt(_riskFactor);
  }

  /**
   * @notice Calculates and returns the risk factor using minimum premium.
   * Formula: riskFactor = (-1 * log(1 - min premium) / duration in days) * 365.24
   * @param _minCarapaceRiskPremiumPercent the minimum premium rate for the loan protection scaled to 18 decimals.
   * For example: 0.02 should be passed as 0.02 x 10**18 = 2 * 10**16
   * @param _durationInDays the duration of the loan protection in days scaled to 18 decimals
   * @return _riskFactor the risk factor scaled to 18 decimals
   */
  function calculateRiskFactorUsingMinPremium(
    uint256 _minCarapaceRiskPremiumPercent,
    uint256 _durationInDays
  ) external view returns (int256 _riskFactor) {
    console.log(
      "Calculating risk factor using minCarapaceRiskPremiumPercent... minCarapaceRiskPremiumPercent: %s, durationInDays: %s",
      _minCarapaceRiskPremiumPercent,
      _durationInDays
    );
    int256 _logValue = (Constants.SCALE_18_DECIMALS_INT -
      int256(_minCarapaceRiskPremiumPercent)).ln();
    console.logInt(_logValue);

    /**
     * min premium = 1 - e ^ (-1 * lambda * duration in days)
     * lambda = -1 * logBaseE(1 - min premium) / duration in days
     * riskFactor = lambda * days in years(365.24)
     * Need to re-scale here because numerator (log value) & denominator(duration in days) both are scaled to 18 decimals
     */
    int256 _lambda = (-1 * _logValue * Constants.SCALE_18_DECIMALS_INT) /
      int256(_durationInDays);
    console.logInt(_lambda);

    _riskFactor = (_lambda * Constants.SCALED_DAYS_IN_YEAR) / 100;
    console.logInt(_riskFactor);
  }

  /**
   * @notice Determine whether the risk factor can be calculated or not.
   * Risk factor can not be calculated in following scenarios.
   * 1) total capital is less than minimum required capital
   * 2) leverage ratio is not between floor and ceiling
   * @param _totalCapital the total capital of the pool scaled to underlying decimals
   * @param _leverageRatio the current leverage ratio of the pool scaled to 18 decimals
   * @param _leverageRatioFloor the minimum leverage ratio allowed in the pool scaled to 18 decimals
   * @param _leverageRatioCeiling the maximum leverage ratio allowed in the pool scaled to 18 decimals
   * @param _minRequiredCapital the minimum required capital in the pool scaled to underlying decimals
   * @return _canCalculate true if risk factor can be calculated, false otherwise
   */
  function canCalculateRiskFactor(
    uint256 _totalCapital,
    uint256 _leverageRatio,
    uint256 _leverageRatioFloor,
    uint256 _leverageRatioCeiling,
    uint256 _minRequiredCapital
  ) external pure returns (bool _canCalculate) {
    if (
      _totalCapital < _minRequiredCapital ||
      _leverageRatio < _leverageRatioFloor ||
      _leverageRatio > _leverageRatioCeiling
    ) {
      _canCalculate = false;
    } else {
      _canCalculate = true;
    }
  }
}
