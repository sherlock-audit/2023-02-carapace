// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title UUPSUpgradeableBase
 * @author Carapace Finance
 * @dev Base contract for all UUPSUpgradeable contracts that are intended to be used through proxy
 and hence can be upgraded.
 */
abstract contract UUPSUpgradeableBase is
  Initializable,
  OwnableUpgradeable,
  UUPSUpgradeable
{
  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    /// Disable the initialization of this implementation contract as
    /// it is intended to be used through proxy.
    _disableInitializers();
  }

  /**
   * @dev Initializes parent contracts in same order as they are inherited to mimic the behavior of a constructor
   */
  // solhint-disable-next-line func-name-mixedcase
  function __UUPSUpgradeableBase_init() internal onlyInitializing {
    __Ownable_init();
    __UUPSUpgradeable_init();
  }

  /// @inheritdoc UUPSUpgradeable
  // solhint-disable-next-line no-empty-blocks
  function _authorizeUpgrade(address) internal override onlyOwner {}
}
