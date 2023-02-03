// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import {ITranchedPool} from "./ITranchedPool.sol";

/**
 * @dev Goldfinch's senior pool interface that is the main entry point for senior LPs (a.k.a. capital providers).
 * Automatically invests across borrower pools using an adjustable strategy..
 * Copied from: https://github.com/goldfinch-eng/mono/blob/6e5da59fb38d2efece725ee1ee059fce4301d987/packages/protocol/contracts/interfaces/ISeniorPool.sol
 * Changes:
 *  1. Updated compiler version to match the rest of the project
 *  2. Removed "pragma experimental ABIEncoderV2"
 *  3. Removed all unused structs/events/functions
 *
 * Etherscan link: https://etherscan.io/address/0x8481a6EbAf5c7DABc3F7e09e44A89531fd31F822
 */
abstract contract ISeniorPool {
  /**
   * @notice Provides the current writedown amount for a given tranched pool address
   *
   * This is added to access public state "mapping(ITranchedPool => uint256) public writedowns" from Goldfinch's SeniorPool contract.
   */
  function writedowns(address tranchedPoolAddress)
    public
    view
    virtual
    returns (uint256 writedownAmount);
}
