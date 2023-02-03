// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/**
 * @notice Interface to interact with GoldfinchConfig contract.
 * Derived from Goldfinch's GoldfinchConfig.sol: https://github.com/goldfinch-eng/mono/blob/main/packages/protocol/contracts/protocol/core/GoldfinchConfig.sol
 *
 * Ethereum mainnet: https://etherscan.io/address/0xaA425F8BfE82CD18f634e2Fe91E5DdEeFD98fDA1#readProxyContract
 */
abstract contract IGoldfinchConfig {
  function getAddress(uint256 index) public view virtual returns (address);

  function getNumber(uint256 index) public view virtual returns (uint256);
}
