// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {EnumerableSetUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";
import {IERC20MetadataUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import {UUPSUpgradeableBase} from "../../UUPSUpgradeableBase.sol";
import {SToken} from "./SToken.sol";
import {IPremiumCalculator} from "../../interfaces/IPremiumCalculator.sol";
import {IReferenceLendingPools, LendingPoolStatus, ProtectionPurchaseParams} from "../../interfaces/IReferenceLendingPools.sol";
import {IProtectionPoolCycleManager, ProtectionPoolCycleState} from "../../interfaces/IProtectionPoolCycleManager.sol";
import {IProtectionPool, ProtectionPoolParams, ProtectionPoolInfo, ProtectionInfo, LendingPoolDetail, WithdrawalCycleDetail, ProtectionBuyerAccount, ProtectionPoolPhase} from "../../interfaces/IProtectionPool.sol";
import {IDefaultStateManager} from "../../interfaces/IDefaultStateManager.sol";

import "../../libraries/AccruedPremiumCalculator.sol";
import "../../libraries/Constants.sol";
import "../../libraries/ProtectionPoolHelper.sol";

import "hardhat/console.sol";

/**
 * @title ProtectionPool
 * @author Carapace Finance
 * @notice ProtectionPool is the core contract of the protocol.
 * Each protection pool is a market where protection sellers
 * and buyers can swap credit default risks of designated/referenced underlying loans.
 * Protection buyers purchase protections by paying a premium in underlying tokens to the pool.
 * Protection sellers deposit underlying tokens into the pool and receives proportionate shares of STokens.
 * Protection sellers can withdraw their underlying tokens from the pool after requesting a withdrawal
 * and only during the open period following the next pool cycle's end.
 *
 * This contract is upgradeable using the UUPS pattern.
 */
contract ProtectionPool is
  UUPSUpgradeableBase,
  ReentrancyGuardUpgradeable,
  IProtectionPool,
  SToken
{
  /*** libraries ***/
  using SafeERC20Upgradeable for IERC20MetadataUpgradeable;
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.UintSet;

  //////////////////////////////////////////////////////
  ///             STORAGE- START                   ///
  /////////////////////////////////////////////////////
  /**
   * @dev DO NOT CHANGE THE ORDER OF THESE VARIABLES ONCE DEPLOYED
   */

  /// @notice Reference to the PremiumPricing contract
  IPremiumCalculator private premiumCalculator;

  /// @notice Reference to the ProtectionPoolCycleManager contract
  IProtectionPoolCycleManager private poolCycleManager;

  /// @notice Reference to default state manager contract
  IDefaultStateManager private defaultStateManager;

  /// @notice information about this protection pool
  ProtectionPoolInfo private poolInfo;

  /// @notice The total underlying amount of premium paid to the pool by protection buyers
  uint256 private totalPremium;

  /// @notice The total underlying amount of protection bought from this pool by protection buyers
  uint256 private totalProtection;

  /// @notice The total premium accrued in underlying token up to the last premium accrual timestamp
  uint256 private totalPremiumAccrued;

  /**
   * @notice The total underlying amount in the pool backing the value of STokens.
   * @notice This is the total capital deposited by sellers + accrued premiums from buyers - locked capital - default payouts.
   */
  uint256 private totalSTokenUnderlying;

  /// @notice The array to track all protections bought from this pool
  /// @dev This array has dummy element at index 0 to validate the index of the protection
  ProtectionInfo[] private protectionInfos;

  /// @notice The mapping to track pool cycle index at which actual withdrawal will happen to withdrawal details
  mapping(uint256 => WithdrawalCycleDetail) private withdrawalCycleDetails;

  /// @notice The mapping to track all lending pool details by address
  mapping(address => LendingPoolDetail) private lendingPoolDetails;

  /// @notice The mapping to track all protection buyer accounts by address
  mapping(address => ProtectionBuyerAccount) private protectionBuyerAccounts;

  //////////////////////////////////////////////////////
  ///             STORAGE - END                     ///
  /////////////////////////////////////////////////////

  /*** modifiers ***/

  /// @notice Checks whether pool cycle is in open state. If not, reverts.
  /// @dev This modifier is used to restrict certain functions to be called only during the open period of a pool cycle.
  /// @dev This modifier also updates the pool cycle state before verifying the state.
  modifier whenPoolIsOpen() {
    /// Update the pool cycle state
    ProtectionPoolCycleState cycleState = poolCycleManager
      .calculateAndSetPoolCycleState(address(this));

    if (cycleState != ProtectionPoolCycleState.Open) {
      revert ProtectionPoolIsNotOpen();
    }
    _;
  }

  /// @notice Checks caller is DefaultStateManager contract. If not, reverts.
  /// @dev This modifier is used to restrict certain functions to be called only by the DefaultStateManager contract.
  modifier onlyDefaultStateManager() {
    if (msg.sender != address(defaultStateManager)) {
      revert OnlyDefaultStateManager(msg.sender);
    }
    _;
  }

  /*** initializer ***/

  /// @inheritdoc IProtectionPool
  function initialize(
    address _owner,
    ProtectionPoolInfo calldata _poolInfo,
    IPremiumCalculator _premiumCalculator,
    IProtectionPoolCycleManager _poolCycleManager,
    IDefaultStateManager _defaultStateManager,
    string calldata _name,
    string calldata _symbol
  ) external override initializer {
    /// initialize parent contracts in same order as they are inherited to mimic the behavior of a constructor
    __UUPSUpgradeableBase_init();
    __ReentrancyGuard_init();
    __sToken_init(_name, _symbol);

    /// set the storage variables
    poolInfo = _poolInfo;
    premiumCalculator = _premiumCalculator;
    poolCycleManager = _poolCycleManager;
    defaultStateManager = _defaultStateManager;

    emit ProtectionPoolInitialized(
      _name,
      _symbol,
      poolInfo.underlyingToken,
      poolInfo.referenceLendingPools
    );

    /// Transfer the ownership of this pool to the specified owner
    _transferOwnership(_owner);

    /// Add dummy protection info to make index 0 invalid
    protectionInfos.push();
  }

  /*** state-changing functions ***/

  /// @inheritdoc IProtectionPool
  function buyProtection(
    ProtectionPurchaseParams calldata _protectionPurchaseParams,
    uint256 _maxPremiumAmount
  ) external override whenNotPaused nonReentrant {
    /// Verify that user can buy protection and then create protection
    _verifyAndCreateProtection(
      block.timestamp,
      _protectionPurchaseParams,
      _maxPremiumAmount,
      false
    );
  }

  /// @inheritdoc IProtectionPool
  function renewProtection(
    ProtectionPurchaseParams calldata _protectionPurchaseParams,
    uint256 _maxPremiumAmount
  ) external override whenNotPaused nonReentrant {
    /// Verify that user can renew protection
    ProtectionPoolHelper.verifyBuyerCanRenewProtection(
      protectionBuyerAccounts,
      protectionInfos,
      _protectionPurchaseParams,
      poolInfo.params.protectionRenewalGracePeriodInSeconds
    );

    /// Verify that user can buy protection and then create a new protection for renewal
    _verifyAndCreateProtection(
      block.timestamp,
      _protectionPurchaseParams,
      _maxPremiumAmount,
      true
    );
  }

  /// @inheritdoc IProtectionPool
  function deposit(uint256 _underlyingAmount, address _receiver)
    external
    override
    whenNotPaused
    nonReentrant
  {
    _deposit(_underlyingAmount, _receiver);
  }

  /// @inheritdoc IProtectionPool
  function requestWithdrawal(uint256 _sTokenAmount)
    external
    override
    whenNotPaused
  {
    _requestWithdrawal(_sTokenAmount);
  }

  /// @inheritdoc IProtectionPool
  function depositAndRequestWithdrawal(
    uint256 _underlyingAmountToDeposit,
    uint256 _sTokenAmountToWithdraw
  ) external virtual override whenNotPaused nonReentrant {
    _deposit(_underlyingAmountToDeposit, msg.sender);
    _requestWithdrawal(_sTokenAmountToWithdraw);
  }

  /// @inheritdoc IProtectionPool
  function withdraw(uint256 _sTokenWithdrawalAmount, address _receiver)
    external
    override
    whenPoolIsOpen
    whenNotPaused
    nonReentrant
  {
    /// Step 1: Retrieve withdrawal details for current pool cycle index
    uint256 _currentCycleIndex = poolCycleManager.getCurrentCycleIndex(
      address(this)
    );
    WithdrawalCycleDetail storage withdrawalCycle = withdrawalCycleDetails[
      _currentCycleIndex
    ];

    /// Step 2: Verify withdrawal request exists in this withdrawal cycle for the user
    uint256 _sTokenRequested = withdrawalCycle.withdrawalRequests[msg.sender];
    if (_sTokenRequested == 0) {
      revert NoWithdrawalRequested(msg.sender, _currentCycleIndex);
    }

    /// Step 3: Verify that withdrawal amount is not more than the requested amount.
    if (_sTokenWithdrawalAmount > _sTokenRequested) {
      revert WithdrawalHigherThanRequested(msg.sender, _sTokenRequested);
    }

    /// Step 4: calculate underlying amount to transfer based on sToken withdrawal amount
    uint256 _underlyingAmountToTransfer = convertToUnderlying(
      _sTokenWithdrawalAmount
    );

    /// Step 5: burn sTokens shares.
    /// This step must be done after calculating underlying amount to be transferred
    _burn(msg.sender, _sTokenWithdrawalAmount);

    /// Step 6: Update total sToken underlying amount
    totalSTokenUnderlying -= _underlyingAmountToTransfer;

    /// Step 7: update seller's withdrawal amount and total requested withdrawal amount
    withdrawalCycle.withdrawalRequests[msg.sender] -= _sTokenWithdrawalAmount;
    withdrawalCycle.totalSTokenRequested -= _sTokenWithdrawalAmount;

    /// Step 8: transfer underlying token to receiver
    poolInfo.underlyingToken.safeTransfer(
      _receiver,
      _underlyingAmountToTransfer
    );

    emit WithdrawalMade(msg.sender, _sTokenWithdrawalAmount, _receiver);
  }

  /// @inheritdoc IProtectionPool
  /// @dev Can't use 'calldata` for _lendingPools parameter because of potential re-assignment in the function
  function accruePremiumAndExpireProtections(address[] memory _lendingPools)
    external
    override
  {
    /// When no lending pools are passed, accrue premium for all lending pools
    if (_lendingPools.length == 0) {
      _lendingPools = poolInfo.referenceLendingPools.getLendingPools();
    }

    /// Track total premium accrued and protection removed for all lending pools
    uint256 _totalPremiumAccrued;
    uint256 _totalProtectionRemoved;

    /// Iterate all lending pools of this protection pool to check if there is new payment after last premium accrual
    uint256 length = _lendingPools.length;
    for (uint256 _lendingPoolIndex; _lendingPoolIndex < length; ) {
      /// Retrieve lending pool detail from the storage
      address _lendingPool = _lendingPools[_lendingPoolIndex];
      LendingPoolDetail storage lendingPoolDetail = lendingPoolDetails[
        _lendingPool
      ];

      /// Get the latest payment timestamp for the lending pool
      uint256 _latestPaymentTimestamp = poolInfo
        .referenceLendingPools
        .getLatestPaymentTimestamp(_lendingPool);

      /// Get the last premium accrual timestamp for the lending pool from the storage
      uint256 _lastPremiumAccrualTimestamp = lendingPoolDetail
        .lastPremiumAccrualTimestamp;

      console.log(
        "lendingPool: %s, lastPremiumAccrualTimestamp: %s, latestPaymentTimestamp: %s",
        _lendingPool,
        _lastPremiumAccrualTimestamp,
        _latestPaymentTimestamp
      );

      /// Iterate all active protections for this lending pool and
      /// accrue premium and expire protections if there is new payment
      (
        uint256 _accruedPremiumForLendingPool,
        uint256 _totalProtectionRemovedForLendingPool
      ) = _accruePremiumAndExpireProtections(
          lendingPoolDetail,
          _lastPremiumAccrualTimestamp,
          _latestPaymentTimestamp
        );
      _totalPremiumAccrued += _accruedPremiumForLendingPool;
      _totalProtectionRemoved += _totalProtectionRemovedForLendingPool;

      /// Persist the last premium accrual of the lending pool in the storage,
      /// only if there was premium accrued
      if (_accruedPremiumForLendingPool > 0) {
        lendingPoolDetail.lastPremiumAccrualTimestamp = _latestPaymentTimestamp;

        emit PremiumAccrued(_lendingPool, _latestPaymentTimestamp);
      }

      unchecked {
        ++_lendingPoolIndex;
      }
    }

    /// Gas optimization: only update storage vars if there was premium accrued
    if (_totalPremiumAccrued > 0) {
      totalPremiumAccrued += _totalPremiumAccrued;
      totalSTokenUnderlying += _totalPremiumAccrued;
    }

    /// Reduce the total protection amount of this protection pool
    /// by the total protection amount of the expired protections
    if (_totalProtectionRemoved > 0) {
      totalProtection -= _totalProtectionRemoved;
    }
  }

  /// @inheritdoc IProtectionPool
  function lockCapital(address _lendingPoolAddress)
    external
    payable
    override
    onlyDefaultStateManager
    whenNotPaused
    returns (uint256 _lockedAmount, uint256 _snapshotId)
  {
    /// step 1: Capture protection pool's current investors by creating a snapshot of the token balance by using ERC20Snapshot in SToken
    _snapshotId = _snapshot();

    /// step 2: calculate total capital to be locked
    LendingPoolDetail storage lendingPoolDetail = lendingPoolDetails[
      _lendingPoolAddress
    ];

    /// Get indexes of active protection for a lending pool from the storage
    EnumerableSetUpgradeable.UintSet
      storage activeProtectionIndexes = lendingPoolDetail
        .activeProtectionIndexes;

    /// Iterate all active protections and calculate total locked amount for this lending pool
    /// 1. calculate remaining principal amount for each loan protection in the lending pool.
    /// 2. for each loan protection, lockedAmt = min(protectionAmt, remainingPrincipal)
    /// 3. total locked amount = sum of lockedAmt for all loan protections
    uint256 _length = activeProtectionIndexes.length();
    for (uint256 i; i < _length; ) {
      /// Get protection info from the storage
      uint256 _protectionIndex = activeProtectionIndexes.at(i);
      ProtectionInfo storage protectionInfo = protectionInfos[_protectionIndex];

      /// Calculate remaining principal amount for a loan protection in the lending pool
      uint256 _remainingPrincipal = poolInfo
        .referenceLendingPools
        .calculateRemainingPrincipal(
          _lendingPoolAddress,
          protectionInfo.buyer,
          protectionInfo.purchaseParams.nftLpTokenId
        );

      /// Locked amount is minimum of protection amount and remaining principal
      uint256 _protectionAmount = protectionInfo
        .purchaseParams
        .protectionAmount;
      uint256 _lockedAmountPerProtection = _protectionAmount <
        _remainingPrincipal
        ? _protectionAmount
        : _remainingPrincipal;

      _lockedAmount += _lockedAmountPerProtection;

      unchecked {
        ++i;
      }
    }

    unchecked {
      /// step 3: Update total locked & available capital in storage
      if (totalSTokenUnderlying < _lockedAmount) {
        /// If totalSTokenUnderlying < _lockedAmount, then lock all available capital
        _lockedAmount = totalSTokenUnderlying;
        totalSTokenUnderlying = 0;
      } else {
        /// Reduce the total sToken underlying amount by the locked amount
        totalSTokenUnderlying -= _lockedAmount;
      }
    }
  }

  /// @inheritdoc IProtectionPool
  function claimUnlockedCapital(address _receiver)
    external
    override
    whenNotPaused
  {
    /// Investors can claim their total share of released/unlocked capital across all lending pools
    uint256 _claimableAmount = defaultStateManager
      .calculateAndClaimUnlockedCapital(msg.sender);

    if (_claimableAmount > 0) {
      console.log(
        "Total sToken underlying: %s, claimableAmount: %s",
        totalSTokenUnderlying,
        _claimableAmount
      );
      /// transfer the share of unlocked capital to the receiver
      poolInfo.underlyingToken.safeTransfer(_receiver, _claimableAmount);
    }
  }

  /** admin functions */

  /// @notice allows the owner to pause the contract
  /// @dev This function is marked as payable for gas optimization.
  function pause() external payable onlyOwner {
    _pause();
  }

  /// @notice allows the owner to unpause the contract
  /// @dev This function is marked as payable for gas optimization.
  function unpause() external payable onlyOwner {
    _unpause();
  }

  /**
   * @notice Updates the leverage ratio parameters: floor, ceiling, and buffer.
   * @notice Only callable by the owner.
   * @dev This function is marked as payable for gas optimization.
   * @param _leverageRatioFloor the new floor for the leverage ratio scaled by 18 decimals. i.e. 0.5 is 5 * 10^17
   * @param _leverageRatioCeiling the new ceiling for the leverage ratio scaled by 18 decimals. i.e. 1.5 is 1.5 * 10^18
   * @param _leverageRatioBuffer the new buffer for the leverage ratio scaled by 18 decimals. i.e. 0.05 is 5 * 10^16
   */
  function updateLeverageRatioParams(
    uint256 _leverageRatioFloor,
    uint256 _leverageRatioCeiling,
    uint256 _leverageRatioBuffer
  ) external payable onlyOwner {
    poolInfo.params.leverageRatioFloor = _leverageRatioFloor;
    poolInfo.params.leverageRatioCeiling = _leverageRatioCeiling;
    poolInfo.params.leverageRatioBuffer = _leverageRatioBuffer;
  }

  /**
   * @notice Updates risk premium calculation params: curvature, minCarapaceRiskPremiumPercent & underlyingRiskPremiumPercent
   * @notice Only callable by the owner.
   * @dev This function is marked as payable for gas optimization.
   * @param _curvature the new curvature parameter scaled by 18 decimals. i.e. 0.05 curvature is 5 * 10^16
   * @param _minCarapaceRiskPremiumPercent the new minCarapaceRiskPremiumPercent parameter scaled by 18 decimals. i.e. 0.03 is 3 * 10^16
   * @param _underlyingRiskPremiumPercent the new underlyingRiskPremiumPercent parameter scaled by 18 decimals. i.e. 0.10 is 1 * 10^17
   */
  function updateRiskPremiumParams(
    uint256 _curvature,
    uint256 _minCarapaceRiskPremiumPercent,
    uint256 _underlyingRiskPremiumPercent
  ) external payable onlyOwner {
    poolInfo.params.curvature = _curvature;
    poolInfo
      .params
      .minCarapaceRiskPremiumPercent = _minCarapaceRiskPremiumPercent;
    poolInfo
      .params
      .underlyingRiskPremiumPercent = _underlyingRiskPremiumPercent;
  }

  /**
   * @notice Updates the minimum required capital for the protection pool
   * @notice Only callable by the owner.
   * @dev This function is marked as payable for gas optimization.
   * @param _minRequiredCapital the new minimum required capital for the protection pool in underlying token
   */
  function updateMinRequiredCapital(uint256 _minRequiredCapital)
    external
    payable
    onlyOwner
  {
    poolInfo.params.minRequiredCapital = _minRequiredCapital;
  }

  /**
   * @notice Allows the owner to move pool phase after verification
   * @notice Only callable by the owner.
   * @dev This function is marked as payable for gas optimization.
   * @return _newPhase the new phase of the pool, if the phase is updated
   */
  function movePoolPhase()
    external
    payable
    onlyOwner
    returns (ProtectionPoolPhase _newPhase)
  {
    ProtectionPoolPhase _currentPhase = poolInfo.currentPhase;

    /// Pool starts in OpenToSellers phase.
    /// Once the pool has enough capital, it can be moved to OpenToBuyers phase
    if (
      _currentPhase == ProtectionPoolPhase.OpenToSellers &&
      _hasMinRequiredCapital()
    ) {
      poolInfo.currentPhase = _newPhase = ProtectionPoolPhase.OpenToBuyers;
      emit ProtectionPoolPhaseUpdated(_newPhase);
    } else if (_currentPhase == ProtectionPoolPhase.OpenToBuyers) {
      /// when the pool is in OpenToBuyers phase, it can be moved to Open phase,
      /// if the leverage ratio is below the ceiling
      if (calculateLeverageRatio() <= poolInfo.params.leverageRatioCeiling) {
        poolInfo.currentPhase = _newPhase = ProtectionPoolPhase.Open;
        emit ProtectionPoolPhaseUpdated(_newPhase);
      }
    }

    /// Once the pool is in Open phase, phase can not be updated
  }

  /** view functions */

  /// @inheritdoc IProtectionPool
  function getPoolInfo()
    external
    view
    override
    returns (ProtectionPoolInfo memory)
  {
    return poolInfo;
  }

  /// @inheritdoc IProtectionPool
  function getAllProtections()
    external
    view
    override
    returns (ProtectionInfo[] memory _protections)
  {
    uint256 _length = protectionInfos.length;
    _protections = new ProtectionInfo[](_length - 1);
    uint256 _index;

    /// skip the first element in the array, as it is dummy/empty protection info
    for (uint256 i = 1; i < _length; ) {
      _protections[_index] = protectionInfos[i];

      unchecked {
        ++i;
        ++_index;
      }
    }
  }

  /// @inheritdoc IProtectionPool
  function calculateLeverageRatio() public view override returns (uint256) {
    return _calculateLeverageRatio(totalSTokenUnderlying);
  }

  /// @inheritdoc IProtectionPool
  function convertToSToken(uint256 _underlyingAmount)
    public
    view
    override
    returns (uint256)
  {
    uint256 _scaledUnderlyingAmt = ProtectionPoolHelper
      .scaleUnderlyingAmtTo18Decimals(
        _underlyingAmount,
        poolInfo.underlyingToken.decimals()
      );

    /// if there are no sTokens in the pool, return the underlying amount
    if (totalSupply() == 0) return _scaledUnderlyingAmt;

    return
      (_scaledUnderlyingAmt * Constants.SCALE_18_DECIMALS) / _getExchangeRate();
  }

  /// @inheritdoc IProtectionPool
  function convertToUnderlying(uint256 _sTokenShares)
    public
    view
    override
    returns (uint256)
  {
    return
      ProtectionPoolHelper.scale18DecimalsAmtToUnderlyingDecimals(
        ((_sTokenShares * _getExchangeRate()) / Constants.SCALE_18_DECIMALS), /// underlying amount in 18 decimals
        poolInfo.underlyingToken.decimals()
      );
  }

  /// @inheritdoc IProtectionPool
  function getRequestedWithdrawalAmount(uint256 _withdrawalCycleIndex)
    external
    view
    override
    returns (uint256)
  {
    return _getRequestedWithdrawalAmount(_withdrawalCycleIndex);
  }

  /// @inheritdoc IProtectionPool
  function getCurrentRequestedWithdrawalAmount()
    external
    view
    override
    returns (uint256)
  {
    return
      _getRequestedWithdrawalAmount(
        poolCycleManager.getCurrentCycleIndex(address(this))
      );
  }

  /// @inheritdoc IProtectionPool
  function getTotalRequestedWithdrawalAmount(uint256 _withdrawalCycleIndex)
    external
    view
    override
    returns (uint256)
  {
    return withdrawalCycleDetails[_withdrawalCycleIndex].totalSTokenRequested;
  }

  /// @inheritdoc IProtectionPool
  function getLendingPoolDetail(address _lendingPoolAddress)
    external
    view
    override
    returns (
      uint256 _lastPremiumAccrualTimestamp,
      uint256 _totalPremium,
      uint256 _totalProtection
    )
  {
    LendingPoolDetail storage lendingPoolDetail = lendingPoolDetails[
      _lendingPoolAddress
    ];
    _lastPremiumAccrualTimestamp = lendingPoolDetail
      .lastPremiumAccrualTimestamp;
    _totalPremium = lendingPoolDetail.totalPremium;
    _totalProtection = lendingPoolDetail.totalProtection;
  }

  /// @inheritdoc IProtectionPool
  function getActiveProtections(address _buyer)
    external
    view
    override
    returns (ProtectionInfo[] memory _protectionInfos)
  {
    /// Retrieve the active protection indexes for the buyer
    EnumerableSetUpgradeable.UintSet
      storage activeProtectionIndexes = protectionBuyerAccounts[_buyer]
        .activeProtectionIndexes;
    uint256 _length = activeProtectionIndexes.length();
    _protectionInfos = new ProtectionInfo[](_length);

    /// Retrieve the protection info for each active protection index
    /// and set it in the return array
    for (uint256 i; i < _length; ) {
      uint256 _protectionIndex = activeProtectionIndexes.at(i);
      _protectionInfos[i] = protectionInfos[_protectionIndex];

      unchecked {
        ++i;
      }
    }
  }

  /// @inheritdoc IProtectionPool
  function getTotalPremiumPaidForLendingPool(
    address _buyer,
    address _lendingPoolAddress
  ) external view override returns (uint256) {
    return
      protectionBuyerAccounts[_buyer].lendingPoolToPremium[_lendingPoolAddress];
  }

  /// @inheritdoc IProtectionPool
  function calculateProtectionPremium(
    ProtectionPurchaseParams calldata _protectionPurchaseParams
  )
    external
    view
    override
    returns (uint256 _premiumAmount, bool _isMinPremium)
  {
    uint256 _leverageRatio = calculateLeverageRatio();

    (, _premiumAmount, _isMinPremium) = ProtectionPoolHelper
      .calculateProtectionPremium(
        premiumCalculator,
        poolInfo,
        _protectionPurchaseParams,
        totalSTokenUnderlying,
        _leverageRatio
      );
  }

  /// @inheritdoc IProtectionPool
  function calculateMaxAllowedProtectionAmount(
    address _lendingPool,
    uint256 _nftLpTokenId
  ) external view override returns (uint256 _maxAllowedProtectionAmount) {
    /// Users can not purchase protection for more than the remaining principal
    return
      poolInfo.referenceLendingPools.calculateRemainingPrincipal(
        _lendingPool,
        msg.sender,
        _nftLpTokenId
      );
  }

  /// @inheritdoc IProtectionPool
  function calculateMaxAllowedProtectionDuration()
    external
    view
    override
    returns (uint256 _maxAllowedProtectionDurationInSeconds)
  {
    /// Users can not purchase protection for more than the duration remaining till end of next cycle
    _maxAllowedProtectionDurationInSeconds =
      poolCycleManager.getNextCycleEndTimestamp(address(this)) -
      block.timestamp;
  }

  /// @inheritdoc IProtectionPool
  function getPoolDetails()
    external
    view
    override
    returns (
      uint256 _totalSTokenUnderlying,
      uint256 _totalProtection,
      uint256 _totalPremium,
      uint256 _totalPremiumAccrued
    )
  {
    _totalSTokenUnderlying = totalSTokenUnderlying;
    _totalProtection = totalProtection;
    _totalPremium = totalPremium;
    _totalPremiumAccrued = totalPremiumAccrued;
  }

  /// @inheritdoc IProtectionPool
  function getUnderlyingBalance(address _user)
    external
    view
    override
    returns (uint256)
  {
    return convertToUnderlying(balanceOf(_user));
  }

  /*** internal functions */

  /**
   * @dev Verify protection purchase and create a protection if it is valid
   * @param _protectionStartTimestamp The timestamp at which protection starts
   * @param _protectionPurchaseParams The protection purchase params
   * @param _maxPremiumAmount The maximum premium amount that the user is willing to pay
   * @param _isRenewal Whether the protection is being renewed or not
   */
  function _verifyAndCreateProtection(
    uint256 _protectionStartTimestamp,
    ProtectionPurchaseParams calldata _protectionPurchaseParams,
    uint256 _maxPremiumAmount,
    bool _isRenewal
  ) internal {
    /// Verify that user can buy protection
    ProtectionPoolHelper.verifyProtection(
      poolCycleManager,
      defaultStateManager,
      address(this),
      poolInfo,
      _protectionStartTimestamp,
      _protectionPurchaseParams,
      _isRenewal
    );

    /// Step 1: Calculate & check the leverage ratio
    /// Ensure that leverage ratio floor is never breached
    totalProtection += _protectionPurchaseParams.protectionAmount;
    uint256 _leverageRatio = calculateLeverageRatio();
    if (_leverageRatio < poolInfo.params.leverageRatioFloor) {
      revert ProtectionPoolLeverageRatioTooLow(_leverageRatio);
    }

    /// Retrieve the lending pool detail and
    /// update the total protection of the lending pool by the protection amount
    LendingPoolDetail storage lendingPoolDetail = lendingPoolDetails[
      _protectionPurchaseParams.lendingPoolAddress
    ];
    lendingPoolDetail.totalProtection += _protectionPurchaseParams
      .protectionAmount;

    /// Step 2: Calculate the protection premium amount scaled to 18 decimals and
    /// scale it down to the underlying token decimals.
    (
      uint256 _premiumAmountIn18Decimals,
      uint256 _premiumAmount,
      bool _isMinPremium
    ) = ProtectionPoolHelper.calculateAndTrackPremium(
        premiumCalculator,
        protectionBuyerAccounts,
        poolInfo,
        lendingPoolDetail,
        _protectionPurchaseParams,
        _maxPremiumAmount,
        totalSTokenUnderlying,
        _leverageRatio
      );
    totalPremium += _premiumAmount;

    /// Step 3: Calculate protection in days and scale it to 18 decimals.
    uint256 _protectionDurationInDaysScaled = ((
      _protectionPurchaseParams.protectionDurationInSeconds
    ) * Constants.SCALE_18_DECIMALS) / uint256(Constants.SECONDS_IN_DAY);

    console.log(
      "protectionDurationInDays: %s, protectionPremium: %s, leverageRatio: ",
      _protectionDurationInDaysScaled,
      _premiumAmount,
      _leverageRatio
    );

    /// Step 4: Capture loan protection data for premium accrual calculation
    // solhint-disable-next-line
    (int256 _k, int256 _lambda) = AccruedPremiumCalculator.calculateKAndLambda(
      _premiumAmountIn18Decimals,
      _protectionDurationInDaysScaled,
      _leverageRatio,
      poolInfo.params.leverageRatioFloor,
      poolInfo.params.leverageRatioCeiling,
      poolInfo.params.leverageRatioBuffer,
      poolInfo.params.curvature,
      _isMinPremium ? poolInfo.params.minCarapaceRiskPremiumPercent : 0
    );

    /// Step 5: Add protection to the pool
    protectionInfos.push(
      ProtectionInfo({
        buyer: msg.sender,
        protectionPremium: _premiumAmount,
        startTimestamp: _protectionStartTimestamp,
        K: _k,
        lambda: _lambda,
        expired: false,
        purchaseParams: _protectionPurchaseParams
      })
    );

    /// Step 6: Track all loan protections for a lending pool to calculate
    // the total locked amount for the lending pool, when/if pool is late for payment
    uint256 _protectionIndex = protectionInfos.length - 1;
    lendingPoolDetail.activeProtectionIndexes.add(_protectionIndex);
    protectionBuyerAccounts[msg.sender].activeProtectionIndexes.add(
      _protectionIndex
    );

    emit ProtectionBought(
      msg.sender,
      _protectionPurchaseParams.lendingPoolAddress,
      _protectionPurchaseParams.protectionAmount,
      _premiumAmount
    );

    /// Step 7: transfer premium amount from buyer to pool
    poolInfo.underlyingToken.safeTransferFrom(
      msg.sender,
      address(this),
      _premiumAmount
    );
  }

  /**
   * @dev the exchange rate = total capital / total SToken supply
   * @dev total capital = total seller deposits + premium accrued - locked capital - default payouts
   * @dev the rehypothecation and the protocol fees will be added in the upcoming versions
   * @return the exchange rate scaled to 18 decimals
   */
  function _getExchangeRate() internal view returns (uint256) {
    uint256 _totalScaledCapital = ProtectionPoolHelper
      .scaleUnderlyingAmtTo18Decimals(
        totalSTokenUnderlying,
        poolInfo.underlyingToken.decimals()
      );
    uint256 _totalSTokenSupply = totalSupply();
    uint256 _exchangeRate = (_totalScaledCapital *
      Constants.SCALE_18_DECIMALS) / _totalSTokenSupply;

    console.log(
      "Total capital: %s, Total SToken Supply: %s, exchange rate: %s",
      _totalScaledCapital,
      _totalSTokenSupply,
      _exchangeRate
    );

    return _exchangeRate;
  }

  /**
   * @dev Calculate the minimum required capital for the pool to be able to enable protection purchases.
   */
  function _hasMinRequiredCapital() internal view returns (bool) {
    return totalSTokenUnderlying >= poolInfo.params.minRequiredCapital;
  }

  /**
   * @dev Calculate the leverage ratio for the pool.
   * @param _totalCapital the total capital of the pool in underlying token
   * @return the leverage ratio scaled to 18 decimals
   */
  function _calculateLeverageRatio(uint256 _totalCapital)
    internal
    view
    returns (uint256)
  {
    if (totalProtection == 0) {
      return 0;
    }

    return (_totalCapital * Constants.SCALE_18_DECIMALS) / totalProtection;
  }

  /**
   * @dev Accrue premium for all active protections and mark expired protections for the specified lending pool.
   * Premium is only accrued when the lending pool has a new payment.
   * @return _accruedPremiumForLendingPool the total premium accrued for the lending pool
   * @return _totalProtectionRemoved the total protection removed because of expired protections
   */
  function _accruePremiumAndExpireProtections(
    LendingPoolDetail storage lendingPoolDetail,
    uint256 _lastPremiumAccrualTimestamp,
    uint256 _latestPaymentTimestamp
  )
    internal
    returns (
      uint256 _accruedPremiumForLendingPool,
      uint256 _totalProtectionRemoved
    )
  {
    /// Get all active protection indexes for the lending pool
    uint256[] memory _protectionIndexes = lendingPoolDetail
      .activeProtectionIndexes
      .values();

    /// Iterate through all active protection indexes for the lending pool
    uint256 _length = _protectionIndexes.length;
    for (uint256 j; j < _length; ) {
      uint256 _protectionIndex = _protectionIndexes[j];
      ProtectionInfo storage protectionInfo = protectionInfos[_protectionIndex];

      /// Verify & accrue premium for the protection and
      /// if the protection is expired, then mark it as expired
      (
        uint256 _accruedPremiumInUnderlying,
        bool _expired
      ) = ProtectionPoolHelper.verifyAndAccruePremium(
          poolInfo,
          protectionInfo,
          _lastPremiumAccrualTimestamp,
          _latestPaymentTimestamp
        );
      _accruedPremiumForLendingPool += _accruedPremiumInUnderlying;

      if (_expired) {
        /// Add removed protection amount to the total protection removed
        _totalProtectionRemoved += protectionInfo
          .purchaseParams
          .protectionAmount;

        ProtectionPoolHelper.expireProtection(
          protectionBuyerAccounts,
          protectionInfo,
          lendingPoolDetail,
          _protectionIndex
        );
        emit ProtectionExpired(
          protectionInfo.buyer,
          protectionInfo.purchaseParams.lendingPoolAddress,
          protectionInfo.purchaseParams.protectionAmount
        );
      }

      unchecked {
        ++j;
      }
    }
  }

  /**
   * @dev Deposits the specified amount of underlying token to the pool and
   * mints the corresponding sToken shares to the receiver.
   * @param _underlyingAmount the amount of underlying token to deposit
   * @param _receiver the address to receive the sToken shares
   */
  function _deposit(uint256 _underlyingAmount, address _receiver) internal {
    /// Verify that the pool is not in OpenToBuyers phase
    if (poolInfo.currentPhase == ProtectionPoolPhase.OpenToBuyers) {
      revert ProtectionPoolInOpenToBuyersPhase();
    }

    uint256 _sTokenShares = convertToSToken(_underlyingAmount);
    totalSTokenUnderlying += _underlyingAmount;
    _safeMint(_receiver, _sTokenShares);
    poolInfo.underlyingToken.safeTransferFrom(
      msg.sender,
      address(this),
      _underlyingAmount
    );

    /// Verify leverage ratio only when total capital/sTokenUnderlying is higher than minimum capital requirement
    if (_hasMinRequiredCapital()) {
      /// calculate pool's current leverage ratio considering the new deposit
      uint256 _leverageRatio = calculateLeverageRatio();

      if (_leverageRatio > poolInfo.params.leverageRatioCeiling) {
        revert ProtectionPoolLeverageRatioTooHigh(_leverageRatio);
      }
    }

    emit ProtectionSold(_receiver, _underlyingAmount);
  }

  /**
   * @dev Requests the specified amount of sToken for withdrawal from the pool.
   * @param _sTokenAmount the amount of sToken shares to withdraw
   */
  function _requestWithdrawal(uint256 _sTokenAmount) internal {
    uint256 _sTokenBalance = balanceOf(msg.sender);
    if (_sTokenAmount > _sTokenBalance) {
      revert InsufficientSTokenBalance(msg.sender, _sTokenBalance);
    }

    /// Get current cycle index for this pool
    uint256 _currentCycleIndex = poolCycleManager.getCurrentCycleIndex(
      address(this)
    );

    /// Actual withdrawal is allowed in open period of cycle after next cycle
    /// For example: if request is made in at some time in cycle 1,
    /// then withdrawal is allowed in open period of cycle 3
    uint256 _withdrawalCycleIndex = _currentCycleIndex + 2;

    WithdrawalCycleDetail storage withdrawalCycle = withdrawalCycleDetails[
      _withdrawalCycleIndex
    ];

    /// Cache existing requested amount for the cycle for the sender
    uint256 _oldRequestAmount = withdrawalCycle.withdrawalRequests[msg.sender];
    withdrawalCycle.withdrawalRequests[msg.sender] = _sTokenAmount;

    unchecked {
      /// Update total requested withdrawal amount for the cycle considering existing requested amount
      if (_oldRequestAmount > _sTokenAmount) {
        withdrawalCycle.totalSTokenRequested -= (_oldRequestAmount -
          _sTokenAmount);
      } else {
        withdrawalCycle.totalSTokenRequested += (_sTokenAmount -
          _oldRequestAmount);
      }
    }

    emit WithdrawalRequested(msg.sender, _sTokenAmount, _withdrawalCycleIndex);
  }

  /**
   * @dev Provides the requested amount of sToken for withdrawal from the pool for the specified cycle index.
   * @param _withdrawalCycleIndex the cycle index for which the withdrawal is requested
   * @return the requested amount of sToken to withdraw
   */
  function _getRequestedWithdrawalAmount(uint256 _withdrawalCycleIndex)
    internal
    view
    returns (uint256)
  {
    return
      withdrawalCycleDetails[_withdrawalCycleIndex].withdrawalRequests[
        msg.sender
      ];
  }
}
