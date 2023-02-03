// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {UUPSUpgradeableBase} from "../../UUPSUpgradeableBase.sol";

import {IReferenceLendingPools, LendingPoolStatus, LendingProtocol, ProtectionPurchaseParams, ReferenceLendingPoolInfo} from "../../interfaces/IReferenceLendingPools.sol";
import {ILendingProtocolAdapter} from "../../interfaces/ILendingProtocolAdapter.sol";
import {ILendingProtocolAdapterFactory} from "../../interfaces/ILendingProtocolAdapterFactory.sol";

import "../../libraries/Constants.sol";

/**
 * @title ReferenceLendingPools
 * @author Carapace Finance
 * @notice ReferenceLendingPools manages the basket of reference lending pools,
 * against which the carapace protocol can provide the protection.
 *
 * @dev This contract is upgradeable using the UUPS pattern.
 */
contract ReferenceLendingPools is UUPSUpgradeableBase, IReferenceLendingPools {
  /////////////////////////////////////////////////////
  ///             STORAGE - START                   ///
  /////////////////////////////////////////////////////
  /**
   * @dev DO NOT CHANGE THE ORDER OF THESE VARIABLES ONCE DEPLOYED
   */

  /// @notice the lending protocol adapter factory
  ILendingProtocolAdapterFactory private lendingProtocolAdapterFactory;

  /// @notice the mapping of the lending pool address to the lending pool info
  mapping(address => ReferenceLendingPoolInfo) public referenceLendingPools;

  /// @notice an array of all the added lending pools in this basket
  address[] private lendingPools;

  //////////////////////////////////////////////////////
  ///             STORAGE - END                     ///
  /////////////////////////////////////////////////////

  /** modifiers */

  /// @dev modifier to check if the lending pool is supported,
  /// i.e. added to this basket and is active
  modifier whenLendingPoolSupported(address _lendingPoolAddress) {
    if (!_isReferenceLendingPoolAdded(_lendingPoolAddress)) {
      revert ReferenceLendingPoolNotSupported(_lendingPoolAddress);
    }
    _;
  }

  /// @inheritdoc IReferenceLendingPools
  function initialize(
    address _owner,
    address[] calldata _lendingPools,
    LendingProtocol[] calldata _lendingPoolProtocols,
    uint256[] calldata _protectionPurchaseLimitsInDays,
    address _lendingProtocolAdapterFactory
  ) external override initializer {
    if (
      _lendingPools.length != _lendingPoolProtocols.length ||
      _lendingPools.length != _protectionPurchaseLimitsInDays.length
    ) {
      revert ReferenceLendingPoolsConstructionError(
        "Array inputs length must match"
      );
    }

    if (_owner == Constants.ZERO_ADDRESS) {
      revert ReferenceLendingPoolsConstructionError(
        "Owner address must not be zero"
      );
    }

    /// Initialize the UUPSUpgradeableBase
    __UUPSUpgradeableBase_init();

    lendingProtocolAdapterFactory = ILendingProtocolAdapterFactory(
      _lendingProtocolAdapterFactory
    );

    /// Transfer ownership of this contract to the specified owner address
    _transferOwnership(_owner);

    /// Add the specified lending pools to the basket
    uint256 length = _lendingPools.length;
    for (uint256 i; i < length; ) {
      _addReferenceLendingPool(
        _lendingPools[i],
        _lendingPoolProtocols[i],
        _protectionPurchaseLimitsInDays[i]
      );

      unchecked {
        ++i;
      }
    }
  }

  /** state changing functions */

  /**
   * @notice Adds a new reference lending pool to the basket.
   * @dev This function can only be called by the owner of this contract.
   * @dev This function is marked as payable for gas optimization.
   * @param _lendingPoolAddress address of the lending pool
   * @param _lendingPoolProtocol the protocol of underlying lending pool
   * @param _protectionPurchaseLimitInDays the protection purchase limit in days.
   * i.e. 90 days means the protection can be purchased within {_protectionPurchaseLimitInDays} days of
   * lending pool being added to this contract.
   */
  function addReferenceLendingPool(
    address _lendingPoolAddress,
    LendingProtocol _lendingPoolProtocol,
    uint256 _protectionPurchaseLimitInDays
  ) external payable onlyOwner {
    _addReferenceLendingPool(
      _lendingPoolAddress,
      _lendingPoolProtocol,
      _protectionPurchaseLimitInDays
    );
  }

  /** view functions */

  /// @inheritdoc IReferenceLendingPools
  function getLendingPools() public view override returns (address[] memory) {
    return lendingPools;
  }

  /// @inheritdoc IReferenceLendingPools
  function canBuyProtection(
    address _buyer,
    ProtectionPurchaseParams calldata _purchaseParams,
    bool _isRenewal
  )
    external
    view
    override
    whenLendingPoolSupported(_purchaseParams.lendingPoolAddress)
    returns (bool)
  {
    ReferenceLendingPoolInfo storage lendingPoolInfo = referenceLendingPools[
      _purchaseParams.lendingPoolAddress
    ];

    /// When buyer is not renewing the existing protection and
    /// the protection purchase is NOT within purchase limit duration after
    /// a lending pool added, the buyer cannot purchase protection.
    /// i.e. if the purchase limit is 90 days, the buyer cannot purchase protection
    /// after 90 days of lending pool added to the basket
    if (
      !_isRenewal &&
      block.timestamp > lendingPoolInfo.protectionPurchaseLimitTimestamp
    ) {
      return false;
    }

    /// Verify that protection amount is less than or equal to the remaining principal
    /// that buyer has lent to the underlying lending pool
    return
      _purchaseParams.protectionAmount <=
      calculateRemainingPrincipal(
        _purchaseParams.lendingPoolAddress,
        _buyer,
        _purchaseParams.nftLpTokenId
      );
  }

  /// @inheritdoc IReferenceLendingPools
  function calculateProtectionBuyerAPR(address _lendingPoolAddress)
    public
    view
    override
    whenLendingPoolSupported(_lendingPoolAddress)
    returns (uint256)
  {
    return
      _getLendingProtocolAdapter(_lendingPoolAddress)
        .calculateProtectionBuyerAPR(_lendingPoolAddress);
  }

  /// @inheritdoc IReferenceLendingPools
  function assessState()
    public
    view
    override
    returns (
      address[] memory _lendingPools,
      LendingPoolStatus[] memory _statuses
    )
  {
    uint256 _length = lendingPools.length;
    _lendingPools = new address[](_length);
    _statuses = new LendingPoolStatus[](_length);

    /// Iterate through all the lending pools in this basket and get their statuses
    for (uint256 i; i < _length; ) {
      _lendingPools[i] = lendingPools[i];
      _statuses[i] = _getLendingPoolStatus(lendingPools[i]);

      unchecked {
        ++i;
      }
    }
  }

  /// @inheritdoc IReferenceLendingPools
  function calculateRemainingPrincipal(
    address _lendingPool,
    address _lender,
    uint256 _nftLpTokenId
  )
    public
    view
    override
    whenLendingPoolSupported(_lendingPool)
    returns (uint256)
  {
    return
      _getLendingProtocolAdapter(_lendingPool).calculateRemainingPrincipal(
        _lendingPool,
        _lender,
        _nftLpTokenId
      );
  }

  /// @inheritdoc IReferenceLendingPools
  function getLatestPaymentTimestamp(address _lendingPool)
    public
    view
    override
    returns (uint256)
  {
    return
      _getLendingProtocolAdapter(_lendingPool).getLatestPaymentTimestamp(
        _lendingPool
      );
  }

  /// @inheritdoc IReferenceLendingPools
  function getPaymentPeriodInDays(address _lendingPool)
    public
    view
    override
    returns (uint256)
  {
    return
      _getLendingProtocolAdapter(_lendingPool).getPaymentPeriodInDays(
        _lendingPool
      );
  }

  /** internal functions */

  /**
   * @dev Adds a new reference lending pool to the basket if it is not already added.
   */
  function _addReferenceLendingPool(
    address _lendingPoolAddress,
    LendingProtocol _lendingPoolProtocol,
    uint256 _protectionPurchaseLimitInDays
  ) internal {
    if (_lendingPoolAddress == Constants.ZERO_ADDRESS) {
      revert ReferenceLendingPoolIsZeroAddress();
    }

    if (_isReferenceLendingPoolAdded(_lendingPoolAddress)) {
      revert ReferenceLendingPoolAlreadyAdded(_lendingPoolAddress);
    }

    uint256 _protectionPurchaseLimitTimestamp = block.timestamp +
      (_protectionPurchaseLimitInDays * Constants.SECONDS_IN_DAY_UINT);

    /// add the underlying lending pool to this basket
    referenceLendingPools[_lendingPoolAddress] = ReferenceLendingPoolInfo({
      protocol: _lendingPoolProtocol,
      addedTimestamp: block.timestamp,
      protectionPurchaseLimitTimestamp: _protectionPurchaseLimitTimestamp
    });
    lendingPools.push(_lendingPoolAddress);

    LendingPoolStatus _poolStatus = _getLendingPoolStatus(_lendingPoolAddress);
    if (_poolStatus != LendingPoolStatus.Active) {
      revert ReferenceLendingPoolIsNotActive(_lendingPoolAddress);
    }

    emit ReferenceLendingPoolAdded(
      _lendingPoolAddress,
      _lendingPoolProtocol,
      block.timestamp,
      _protectionPurchaseLimitTimestamp
    );
  }

  /// @dev Returns the lending protocol adapter for the given lending pool address
  function _getLendingProtocolAdapter(address _lendingPoolAddress)
    internal
    view
    returns (ILendingProtocolAdapter)
  {
    return
      lendingProtocolAdapterFactory.getLendingProtocolAdapter(
        referenceLendingPools[_lendingPoolAddress].protocol
      );
  }

  /// @dev Specifies whether the given lending pool is added to the basket or not
  function _isReferenceLendingPoolAdded(address _lendingPoolAddress)
    internal
    view
    returns (bool)
  {
    return referenceLendingPools[_lendingPoolAddress].addedTimestamp != 0;
  }

  /// @dev Returns the status of the given lending pool
  function _getLendingPoolStatus(address _lendingPoolAddress)
    internal
    view
    returns (LendingPoolStatus)
  {
    if (!_isReferenceLendingPoolAdded(_lendingPoolAddress)) {
      return LendingPoolStatus.NotSupported;
    }

    ILendingProtocolAdapter _adapter = _getLendingProtocolAdapter(
      _lendingPoolAddress
    );

    if (_adapter.isLendingPoolExpired(_lendingPoolAddress)) {
      return LendingPoolStatus.Expired;
    }

    if (
      _adapter.isLendingPoolLateWithinGracePeriod(
        _lendingPoolAddress,
        Constants.LATE_PAYMENT_GRACE_PERIOD_IN_DAYS
      )
    ) {
      return LendingPoolStatus.LateWithinGracePeriod;
    }

    if (_adapter.isLendingPoolLate(_lendingPoolAddress)) {
      return LendingPoolStatus.Late;
    }

    return LendingPoolStatus.Active;
  }
}
