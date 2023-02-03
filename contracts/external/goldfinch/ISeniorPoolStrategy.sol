// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import {ITranchedPool} from "./ITranchedPool.sol";

/**
 * @dev Goldfinch's senior pool strategy interface that is used to automatically invest across borrower pools.
 * Copied from: https://github.com/goldfinch-eng/mono/blob/18bb9de858477aa46a8a558f505ef8f796f293b9/packages/protocol/contracts/interfaces/ISeniorPoolStrategy.sol
 * Changes:
 *  1. Updated compiler version to match the rest of the project
 *  2. Removed "pragma experimental ABIEncoderV2"
 *  3. Removed all unused structs/events/functions
 */
abstract contract ISeniorPoolStrategy {
  function getLeverageRatio(ITranchedPool pool)
    public
    view
    virtual
    returns (uint256);
}
