// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ERC20SnapshotUpgradeable, ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20SnapshotUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

/**
 * @title SToken
 * @author Carapace Finance
 * @dev Implementation of the interest bearing token for the Carapace protocol.
 * SToken is an ERC-20 compliant representation of balance underlying available in the protection pool.
 * Accrued protection premium is distributed to SToken holders.
 * Each protection pool will have a corresponding SToken.
 *
 * SToken uses OpenZeppelin's ERC20SnapshotUpgradeable to allow snapshotting of the token balance,
 * when a pool capital needs to be locked because of late payment.
 */
abstract contract SToken is PausableUpgradeable, ERC20SnapshotUpgradeable {
  /////////////////////////////////////////////////////
  ///             STORAGE - START                   ///
  /////////////////////////////////////////////////////
  /**
   * @dev DO NOT CHANGE THE ORDER OF THESE VARIABLES ONCE DEPLOYED
   */

  /**
   * @dev This empty reserved space is put in place to allow future versions to add new
   * variables without shifting down storage in the inheritance chain.
   * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
   * https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#storage-gaps
   */
  uint256[50] private __gap;

  //////////////////////////////////////////////////////
  ///             STORAGE - END                     ///
  /////////////////////////////////////////////////////

  /*** events ***/

  /// @notice Emitted when a new sToken is deployed and initialized
  event STokenCreated(string name, string symbol);

  /// @notice Emitted when new sToken shares are minted
  event Minted(address indexed receiver, uint256 amount);

  /** Initializer */

  // solhint-disable-next-line func-name-mixedcase
  function __sToken_init(string calldata _name, string calldata _symbol)
    internal
    onlyInitializing
  {
    __Pausable_init();
    __ERC20_init(_name, _symbol);

    emit STokenCreated(_name, _symbol);
  }

  /*** state-changing functions ***/

  /**
   * @dev Should be called by a deriving protection pool contract to mint sToken shares to a investor/protection sellers.
   * @param _to The address that should receive the minted tokens.
   * @param _amount the amount of tokens to mint
   */
  function _safeMint(address _to, uint256 _amount) internal whenNotPaused {
    _mint(_to, _amount);
    emit Minted(_to, _amount);
  }
}
