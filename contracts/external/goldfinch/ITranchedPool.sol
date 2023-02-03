// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import {IV2CreditLine} from "./IV2CreditLine.sol";

/**
 * @dev Goldfinch's tranched pool interface that represents the Borrower pool.
 * Copied from: https://github.com/goldfinch-eng/mono/blob/88f0e3f94f6dd23ebae429fe09e2511650df893a/packages/protocol/contracts/interfaces/ITranchedPool.sol
 * Changes:
 *  1. Updated compiler version to match the rest of the project
 *  2. Removed "pragma experimental ABIEncoderV2"
 *  3. Removed all unused structs/events/functions
 * Following etherscan link is for main implementation of TranchedPool contract and
 * various clones are deployed for different lending pools.
 * Etherscan link: https://etherscan.io/address/0x38Dd72b21cBB6023b9818060c541D2Ce7D4D107b
 */
abstract contract ITranchedPool {
  IV2CreditLine public creditLine;

  /**
   * Comments copied from: https://github.com/goldfinch-eng/mono/blob/88f0e3f94f6dd23ebae429fe09e2511650df893a/packages/protocol/contracts/protocol/core/GoldfinchFactory.sol#L67
   * The percent of senior interest allocated to junior investors, expressed as
   * integer percents. eg. 20% is simply 20
   *
   * This is added to access public variable "juniorFeePercent" from Goldfinch's TranchedPool contract.
   */
  function juniorFeePercent() external view virtual returns (uint256);

  function assess() external virtual;
}
