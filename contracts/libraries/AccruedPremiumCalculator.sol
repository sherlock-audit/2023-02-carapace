// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@prb/math/contracts/PRBMathSD59x18.sol";
import "./Constants.sol";
import "./RiskFactorCalculator.sol";

import "hardhat/console.sol";

/**
 * @title AccruedPremiumCalculator
 * @author Carapace Finance
 * @notice Library contract to calculate the accrued premium and related pricing params for the protection purchases.
 */
library AccruedPremiumCalculator {
  using PRBMathSD59x18 for int256;

  /**
   * @notice Calculates K and lambda based on the risk factor.
   * @notice Formula for lambda: Risk Factor / 365
   * @notice Formula for K: _protectionPremium / (1 - e^(-1 * _protection_duration_in_days * lambda))
   * @param _protectionPremium the premium paid for the loan protection scaled to 18 decimals
   * @param _protectionDurationInDays the duration of the loan protection in days scaled to 18 decimals
   * @param _currentLeverageRatio the current leverage ratio of the pool scaled to 18 decimals
   * @param _leverageRatioFloor the minimum leverage ratio allowed in the pool scaled to 18 decimals
   * @param _leverageRatioCeiling the maximum leverage ratio allowed in the pool scaled to 18 decimals
   * @param _leverageRatioBuffer the buffer used in risk factor calculation scaled to 18 decimals
   * @param _curvature the curvature used in risk premium calculation scaled to 18 decimals
   * @param _minCarapaceRiskPremiumPercent the minimum premium percent scaled to 18 decimals.
   * When min premium is specified, risk factor should be calculated on the basis of minimum premium.
   * @return K scaled to 18 decimals
   * @return _lambda scaled to 18 decimals
   */
  function calculateKAndLambda(
    uint256 _protectionPremium,
    uint256 _protectionDurationInDays,
    uint256 _currentLeverageRatio,
    uint256 _leverageRatioFloor,
    uint256 _leverageRatioCeiling,
    uint256 _leverageRatioBuffer,
    uint256 _curvature,
    uint256 _minCarapaceRiskPremiumPercent
  )
    external
    view
    returns (
      // solhint-disable-next-line var-name-mixedcase
      int256 K,
      int256 _lambda
    )
  {
    /// When minRiskPremiumPercent is specified, risk factor should be calculated on the basis of minimum premium rate
    int256 _riskFactor;
    if (_minCarapaceRiskPremiumPercent > 0) {
      _riskFactor = RiskFactorCalculator.calculateRiskFactorUsingMinPremium(
        _minCarapaceRiskPremiumPercent,
        _protectionDurationInDays
      );
    } else {
      _riskFactor = RiskFactorCalculator.calculateRiskFactor(
        _currentLeverageRatio,
        _leverageRatioFloor,
        _leverageRatioCeiling,
        _leverageRatioBuffer,
        _curvature
      );
    }

    /// lambda: Risk Factor / 365.24
    _lambda = (_riskFactor * 100) / Constants.SCALED_DAYS_IN_YEAR;
    console.logInt(_lambda);

    /// exp1 = (-1 * _protectionDurationInDays * lambda)
    /// Need to scale down once because _protectionDurationInDays and lambda both are in 18 decimals
    int256 _power1 = (-1 * int256(_protectionDurationInDays) * _lambda) /
      Constants.SCALE_18_DECIMALS_INT;
    console.logInt(_power1);

    /// exp1 = e^(-1 * _protectionDurationInDays * lambda)
    int256 _exp1 = _power1.exp();
    console.logInt(_exp1);

    /// K = _protectionPremium / (1 - e^(-1 * _protectionDurationInDays * lambda))
    console.log("Calculating K");
    K = int256(_protectionPremium).div(Constants.SCALE_18_DECIMALS_INT - _exp1);
    console.logInt(K);
  }

  /**
   * @notice Calculates the accrued premium from start to end second, scaled to 18 decimals.
   * The time line starts when protection is bought and ends when protection is expired.
   * Formula used to calculate accrued premium from time t to T is: K * (e^(-t * L) - e^(-T * L))
   * L is lambda, which is calculated using the risk factor.
   * K is the constant calculated using protection premium, protection duration and lambda
   * @param _fromSecond from second in time line
   * @param _toSecond to second in time line
   * @param _k the constant calculated using protection premium, protection duration and lambda
   * @param _lambda the constant calculated using the risk factor
   * @return the accrued premium scaled to 18 decimals
   * For example: 150 is returned as 150 x 10**18 = 15 * 10**19
   */
  function calculateAccruedPremium(
    uint256 _fromSecond,
    uint256 _toSecond,
    int256 _k,
    int256 _lambda
  ) external view returns (uint256) {
    console.log(
      "Calculating accrued premium from: %s to %s",
      _fromSecond,
      _toSecond
    );

    /// power1 = -1 * _fromSecond * lambda
    int256 _power1 = -1 *
      ((int256(_fromSecond) * _lambda) / Constants.SECONDS_IN_DAY);
    console.logInt(_power1);

    /// _exp1 = e^(-t * L)
    int256 _exp1 = _power1.exp();
    console.logInt(_exp1);

    /// power2 = -1 * _toSecond * lambda
    int256 _power2 = -1 *
      ((int256(_toSecond) * _lambda) / Constants.SECONDS_IN_DAY);
    console.logInt(_power2);

    /// _exp2 = e^(-T * L)
    int256 _exp2 = _power2.exp();
    console.logInt(_exp2);

    /// _accruedPremium = K * (e^(-t * L) -  e^(-T * L))
    int256 _accruedPremium = _k.mul(_exp1 - _exp2);
    console.logInt(_accruedPremium);

    assert(_accruedPremium >= 0);
    return uint256(_accruedPremium);
  }
}
