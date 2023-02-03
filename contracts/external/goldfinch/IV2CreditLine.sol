// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import {ICreditLine} from "./ICreditLine.sol";

/**
 * @dev Goldfinch's credit line interface version 2 that represents the agreement between Backers and a Borrower.
 * Includes the terms of the loan, as well as the current accounting state, such as interest owed.
 * Copied from: https://github.com/goldfinch-eng/mono/blob/455799ea56cacf666de9858ea8a22cd25eacd2df/packages/protocol/contracts/interfaces/IV2CreditLine.sol
 * Changes:
 *  1. Updated compiler version to match the rest of the project
 *  2. Removed "pragma experimental ABIEncoderV2"
 *  3. Removed all unused structs/events/functions
 *
 * Etherscan link: https://etherscan.io/address/0x4Df1e7fFB382F79736CA565F378F783678d995D8
 */
abstract contract IV2CreditLine is ICreditLine {
  function termStartTime() external view virtual returns (uint256);
}
