// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

/**
 * @dev Version 2 of this interface is {IV2CreditLine}
 * @dev Goldfinch's credit line interface that represents the agreement between Backers and a Borrower.
 * Includes the terms of the loan, as well as the current accounting state, such as interest owed.
 * Copied from: https://github.com/goldfinch-eng/mono/blob/14872db0fce441ef226e646bdb05843a6f48a9b5/packages/protocol/contracts/interfaces/ICreditLine.sol
 * Changes:
 *  1. Updated compiler version to match the rest of the project
 *  2. Removed "pragma experimental ABIEncoderV2"
 *  3. Removed all unused structs/events/functions
 *
 * Etherscan link: https://etherscan.io/address/0x4Df1e7fFB382F79736CA565F378F783678d995D8
 */
interface ICreditLine {
  /**
   * Comments copied from GoldfinchFactory.createPool: https://github.com/goldfinch-eng/mono/blob/88f0e3f94f6dd23ebae429fe09e2511650df893a/packages/protocol/contracts/protocol/core/GoldfinchFactory.sol#L70
   * The interest amount, on an annualized basis (APR, so non-compounding), expressed as an integer.
   * We assume 18 digits of precision. For example, to submit 15.34%, you would pass up 153400000000000000,
   * and 5.34% would be 53400000000000000
   */
  function interestApr() external view returns (uint256);

  /**
   * Comments copied from GoldfinchFactory.createPool: https://github.com/goldfinch-eng/mono/blob/88f0e3f94f6dd23ebae429fe09e2511650df893a/packages/protocol/contracts/protocol/core/GoldfinchFactory.sol#L73
   * How many days in each payment period.
   * ie. the frequency with which they need to make payments.
   * Note: This is basic unscaled integer. i.e. 30 days is represented as 30
   */
  function paymentPeriodInDays() external view returns (uint256);

  /**
   * Comments copied from GoldfinchFactory.createPool: https://github.com/goldfinch-eng/mono/blob/88f0e3f94f6dd23ebae429fe09e2511650df893a/packages/protocol/contracts/protocol/core/GoldfinchFactory.sol#L75
   * Number of days in the credit term. It is used to set the `termEndTime` upon first drawdown.
   *  ie. The credit line should be fully paid off {_termInDays} days after the first drawdown.
   */
  function termInDays() external view returns (uint256);

  /**
   * Comments copied from GoldfinchFactory.createPool: https://github.com/goldfinch-eng/mono/blob/88f0e3f94f6dd23ebae429fe09e2511650df893a/packages/protocol/contracts/protocol/core/GoldfinchFactory.sol#L77
   * The additional interest you will pay if you are late. For example, if this is 3%, and your
   *  normal rate is 15%, then you will pay 18% while you are late. Also expressed as an 18 decimal precision integer
   */
  function lateFeeApr() external view returns (uint256);

  function isLate() external view returns (bool);

  // Accounting variables
  function balance() external view returns (uint256);

  function interestOwed() external view returns (uint256);

  function principalOwed() external view returns (uint256);

  function termEndTime() external view returns (uint256);

  function nextDueTime() external view returns (uint256);

  function interestAccruedAsOf() external view returns (uint256);

  function lastFullPaymentTime() external view returns (uint256);
}
