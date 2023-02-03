// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import {IReferenceLendingPools, LendingPoolStatus} from "./IReferenceLendingPools.sol";
import {IProtectionPool} from "./IProtectionPool.sol";

/// @notice the structure to track the locked capital instance for a lending pool
struct LockedCapital {
  uint256 snapshotId;
  uint256 amount;
  bool locked;
}

/// @notice the structure to track a lending pool status detail including the current status and
/// the timestamp at which the lending pool was marked as late
struct LendingPoolStatusDetail {
  /// @notice the current status of the lending pool
  LendingPoolStatus currentStatus;
  /// @notice the timestamp at which the lending pool was marked as late
  uint256 lateTimestamp;
}

/// @notice the structure to track the state of a protection pool
struct ProtectionPoolState {
  /// @notice the protection pool for which state is being tracked
  IProtectionPool protectionPool;
  /// @notice the timestamp at which the last time pool state was updated
  uint256 updatedTimestamp;
  /// @notice the mapping to track all lending pools referenced by the protection pool to its status details,
  /// which includes current status (Active, Expired, Late, Defaulted)
  /// @dev this is used to track state transitions: active -> late, late -> active, late -> defaulted
  mapping(address => LendingPoolStatusDetail) lendingPoolStateDetails;
  /// We need an array as some users may not have claimed their locked capital and another state change(active -> late) may occur.
  /// For each lending pool, every active -> late state change creates a new instance of the locked capital.
  /// Last item in the array represents the latest state change.
  /// The locked capital is released/unlocked from last item when the lending pool is moved from late -> active state,
  /// or locked capital is moved to default payout when the lending pool is moved from late -> defaulted state.
  /// @notice lock capital instances by a lending pool
  mapping(address => LockedCapital[]) lockedCapitals;
  /// @notice the mapping to track seller's last claimed snapshot id for each lending pool
  mapping(address => mapping(address => uint256)) lastClaimedSnapshotIds;
}

/**
 * @notice the interface for the default state manager contract,
 * to track/manage state transitions of all protection pools within the protocol.
 */
abstract contract IDefaultStateManager {
  /** events */

  /// @notice emitted when the contract factory address is set
  event ContractFactoryUpdated(address indexed contractFactory);

  /// @notice emitted when a a new protection pool is registered
  event ProtectionPoolRegistered(address indexed protectionPool);

  /// @notice emitted when lending status of all registered protection pools are assessed
  event ProtectionPoolStatesAssessed();

  /// @notice emitted when a lending pool is locked because of late payment
  event LendingPoolLocked(
    address indexed lendingPool,
    address indexed protectionPool,
    uint256 protectionPoolSnapshotId,
    uint256 amount
  );

  /// @notice emitted when a lending pool is unlocked because of 2 consecutive re-payments after a late payment
  event LendingPoolUnlocked(
    address indexed lendingPool,
    address indexed protectionPool,
    uint256 amount
  );

  /** errors */
  error NotContractFactory(address msgSender);
  error ProtectionPoolNotRegistered(address protectionPool);
  error ProtectionPoolAlreadyRegistered(address protectionPool);
  error ZeroContractFactoryAddress();

  /**
   * @notice Sets the contract factory address. Only callable by the owner.
   * @param _contractFactoryAddress address of the contract factory which is the only contract allowed to register pools.
   */
  function setContractFactory(address _contractFactoryAddress)
    external
    payable
    virtual;

  /**
   * @notice Registers a specified protection pool.
   * @dev Only contract factory can call this function.
   * @dev Function is marked payable as gas optimization
   * @param _protectionPool an address of the protection pool to register
   */
  function registerProtectionPool(address _protectionPool)
    external
    payable
    virtual;

  /**
   * @notice assess states of all registered protection pools and
   * initiate state changes & related actions as needed.
   */
  function assessStates() external virtual;

  /**
   * @notice assess state of specified registered pools and
   * initiate state changes & related actions as needed.
   * @notice This function is same as "assessStates" except that it only assesses the specified pools.
   * @param _pools the protection pools to assess
   */
  function assessStateBatch(address[] calldata _pools) external virtual;

  /**
   * @notice Calculates and returns the total claimable amount from all locked capital instances
   * in a given protection pool for a user address and marks the unlocked capital as claimed.
   * This function must be called by the protection pool contract.
   * @param _seller seller address who received sTokens for investing in the lending pool.
   * @return _claimedUnlockedCapital the unlocked capital that seller can claim from the protection pool.
   */
  function calculateAndClaimUnlockedCapital(address _seller)
    external
    virtual
    returns (uint256 _claimedUnlockedCapital);

  /**
   * @notice Calculates and returns the total claimable amount from all locked capital instances in a given protection pool for a seller address.
   * This function is same as "calculateAndClaimUnlockedCapital" except that it does not mark the unlocked capital as claimed.
   * @param _protectionPool protection pool
   * @param _seller seller address who received sTokens for investing in the lending pool.
   * @return _claimableUnlockedCapital the unlocked capital that seller can claim from the protection pool.
   */
  function calculateClaimableUnlockedAmount(
    address _protectionPool,
    address _seller
  ) external view virtual returns (uint256 _claimableUnlockedCapital);

  /**
   * @notice Provides the current status of the specified lending pool of given protection pool.
   * If the protection pool is not registered or lending pool is not supported by specified protection,
   * then it returns "NotSupported" status.
   * @param _protectionPoolAddress address of the protection pool
   * @param _lendingPoolAddress address of the lending pool
   * @return the status of the lending pool
   */
  function getLendingPoolStatus(
    address _protectionPoolAddress,
    address _lendingPoolAddress
  ) external view virtual returns (LendingPoolStatus);
}
