// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v4.7.0) (proxy/ERC1967/ERC1967Proxy.sol)

pragma solidity 0.8.17;

import "./Proxy.sol";
import "@openzeppelin/contracts-upgradeable/proxy/ERC1967/ERC1967UpgradeUpgradeable.sol";

/**
 * @dev 01/09/2023 Carapace comments:
 * This contract and "./Proxy.sol" is copied from openzeppelin-contracts v4.7.0. package
 * to avoid installing/using entire openzeppelin-contracts package.
 * This project uses openzeppelin's contracts-upgradeable package.
 * Changes:
 *  1. Updated compiler version to match the rest of the project
 *  2. Updated import for "ERC1967Upgrade" to "ERC1967UpgradeUpgradeable" from contracts-upgradeable package
 *  3. Update function "_implementation" to use "ERC1967UpgradeUpgradeable._getImplementation" instead of "ERC1967Upgrade._getImplementation"
 */

/**
 * @dev This contract implements an upgradeable proxy. It is upgradeable because calls are delegated to an
 * implementation address that can be changed. This address is stored in storage in the location specified by
 * https://eips.ethereum.org/EIPS/eip-1967[EIP1967], so that it doesn't conflict with the storage layout of the
 * implementation behind the proxy.
 */
contract ERC1967Proxy is Proxy, ERC1967UpgradeUpgradeable {
  /**
   * @dev Initializes the upgradeable proxy with an initial implementation specified by `_logic`.
   *
   * If `_data` is nonempty, it's used as data in a delegate call to `_logic`. This will typically be an encoded
   * function call, and allows initializing the storage of the proxy like a Solidity constructor.
   */
  constructor(address _logic, bytes memory _data) payable {
    _upgradeToAndCall(_logic, _data, false);
  }

  /**
   * @dev Returns the current implementation address.
   */
  function _implementation()
    internal
    view
    virtual
    override
    returns (address impl)
  {
    return ERC1967UpgradeUpgradeable._getImplementation();
  }
}
