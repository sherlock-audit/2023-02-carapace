// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {EnumerableSetUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import {ProtectionPurchaseParams, LendingPoolStatus, IReferenceLendingPools} from "../interfaces/IReferenceLendingPools.sol";
import {ProtectionPoolInfo, ProtectionInfo, ProtectionBuyerAccount, IProtectionPool, LendingPoolDetail, ProtectionPoolPhase} from "../interfaces/IProtectionPool.sol";
import {IProtectionPoolCycleManager} from "../interfaces/IProtectionPoolCycleManager.sol";
import {IDefaultStateManager} from "../interfaces/IDefaultStateManager.sol";
import {IPremiumCalculator} from "../interfaces/IPremiumCalculator.sol";

import "./AccruedPremiumCalculator.sol";
import "./Constants.sol";

import "hardhat/console.sol";

/**
 * @title ProtectionPoolHelper
 * @author Carapace Finance
 * @notice Helper library contract for ProtectionPool contract, mainly for size reduction.
 */
library ProtectionPoolHelper {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.UintSet;

  /**
   * @notice Verifies that the status of the lending pool is ACTIVE and protection can be bought,
   * otherwise reverts with the appropriate error message.
   * @param poolCycleManager the pool cycle manager contract
   * @param defaultStateManager the default state manager contract
   * @param _protectionPool the address of the protection pool
   * @param poolInfo storage pointer to the protection pool info
   * @param _protectionStartTimestamp the timestamp when the protection starts
   * @param _protectionPurchaseParams the protection purchase params
   * @param _isRenewal whether the protection is being renewed or not
   */
  function verifyProtection(
    IProtectionPoolCycleManager poolCycleManager,
    IDefaultStateManager defaultStateManager,
    address _protectionPool,
    ProtectionPoolInfo storage poolInfo,
    uint256 _protectionStartTimestamp,
    ProtectionPurchaseParams calldata _protectionPurchaseParams,
    bool _isRenewal
  ) external {
    /// Verify that the pool is not in OpenToSellers phase
    if (poolInfo.currentPhase == ProtectionPoolPhase.OpenToSellers) {
      revert IProtectionPool.ProtectionPoolInOpenToSellersPhase();
    }

    /// a buyer needs to buy protection longer than min protection duration specified in the pool params
    /// or to renew protection longer than a day
    _verifyProtectionDuration(
      poolCycleManager,
      _protectionPool,
      _protectionStartTimestamp,
      _protectionPurchaseParams.protectionDurationInSeconds,
      _isRenewal
        ? Constants.SECONDS_IN_DAY_UINT
        : poolInfo.params.minProtectionDurationInSeconds
    );

    /// Verify that the lending pool is active
    _verifyLendingPoolIsActive(
      defaultStateManager,
      _protectionPool,
      _protectionPurchaseParams.lendingPoolAddress
    );

    if (
      !poolInfo.referenceLendingPools.canBuyProtection(
        msg.sender,
        _protectionPurchaseParams,
        _isRenewal
      )
    ) {
      revert IProtectionPool.ProtectionPurchaseNotAllowed(
        _protectionPurchaseParams
      );
    }
  }

  /**
   * @notice Calculates the protection premium amount and related vars.
   * @param premiumCalculator the premium calculator contract
   * @param poolInfo storage pointer to the protection pool info
   * @param _protectionPurchaseParams the protection purchase params
   * @param totalSTokenUnderlying the total sToken underlying amount
   * @param _leverageRatio the leverage ratio scaled to 18 decimals
   * @return _premiumAmountIn18Decimals The premium amount scaled to 18 decimals.
   * @return _premiumAmount The premium amount in underlying token decimals.
   * @return _isMinPremium True if the premium amount is equal to the minimum premium amount, false otherwise.
   */
  function calculateProtectionPremium(
    IPremiumCalculator premiumCalculator,
    ProtectionPoolInfo storage poolInfo,
    ProtectionPurchaseParams calldata _protectionPurchaseParams,
    uint256 totalSTokenUnderlying,
    uint256 _leverageRatio
  )
    public
    view
    returns (
      uint256 _premiumAmountIn18Decimals,
      uint256 _premiumAmount,
      bool _isMinPremium
    )
  {
    /// Calculate the protection premium amount scaled to 18 decimals and scale it to the underlying token decimals.
    /// This function call has bunch of inline vars to avoid "Stack too deep" error.
    (_premiumAmountIn18Decimals, _isMinPremium) = premiumCalculator
      .calculatePremium(
        /// the protection duration in seconds
        _protectionPurchaseParams.protectionDurationInSeconds,
        /// the protection amount scaled to 18 decimals
        scaleUnderlyingAmtTo18Decimals(
          _protectionPurchaseParams.protectionAmount,
          poolInfo.underlyingToken.decimals()
        ),
        /// the buyer's APR scaled to 18 decimals
        poolInfo.referenceLendingPools.calculateProtectionBuyerAPR(
          _protectionPurchaseParams.lendingPoolAddress
        ),
        _leverageRatio,
        totalSTokenUnderlying,
        poolInfo.params
      );

    _premiumAmount = scale18DecimalsAmtToUnderlyingDecimals(
      _premiumAmountIn18Decimals,
      poolInfo.underlyingToken.decimals()
    );
  }

  /**
   * @notice Calculates & tracks the premium amount for the protection purchase.
   * @param premiumCalculator the premium calculator contract
   * @param protectionBuyerAccounts storage pointer to the protection buyer accounts
   * @param poolInfo storage pointer to the protection pool info
   * @param lendingPoolDetail storage pointer to the lending pool detail
   * @param _protectionPurchaseParams the protection purchase params
   * @param _maxPremiumAmount the maximum premium amount
   * @return _premiumAmountIn18Decimals The premium amount scaled to 18 decimals.
   * @return _premiumAmount The premium amount in underlying token decimals.
   * @return _isMinPremium True if the premium amount is equal to the minimum premium amount, false otherwise.
   */
  function calculateAndTrackPremium(
    IPremiumCalculator premiumCalculator,
    mapping(address => ProtectionBuyerAccount) storage protectionBuyerAccounts,
    ProtectionPoolInfo storage poolInfo,
    LendingPoolDetail storage lendingPoolDetail,
    ProtectionPurchaseParams calldata _protectionPurchaseParams,
    uint256 _maxPremiumAmount,
    uint256 totalSTokenUnderlying,
    uint256 _leverageRatio
  )
    external
    returns (
      uint256 _premiumAmountIn18Decimals,
      uint256 _premiumAmount,
      bool _isMinPremium
    )
  {
    /// Calculate the protection premium
    (
      _premiumAmountIn18Decimals,
      _premiumAmount,
      _isMinPremium
    ) = calculateProtectionPremium(
      premiumCalculator,
      poolInfo,
      _protectionPurchaseParams,
      totalSTokenUnderlying,
      _leverageRatio
    );

    // If calculated premium amount is higher than the max premium amount, revert.
    if (_premiumAmount > _maxPremiumAmount) {
      revert IProtectionPool.PremiumExceedsMaxPremiumAmount(
        _premiumAmount,
        _maxPremiumAmount
      );
    }

    /// Increase the premium amount in the protection buyer account for the given lending pool
    protectionBuyerAccounts[msg.sender].lendingPoolToPremium[
      _protectionPurchaseParams.lendingPoolAddress
    ] += _premiumAmount;

    /// Increase the total premium amount in the lending pool detail
    lendingPoolDetail.totalPremium += _premiumAmount;
  }

  /**
   * @dev Accrues premium for given loan protection from last premium accrual to the latest payment timestamp.
   * @param protectionInfo The loan protection to accrue premium for.
   * @param _lastPremiumAccrualTimestamp The timestamp of last premium accrual.
   * @param _latestPaymentTimestamp The timestamp of latest payment made to the underlying lending pool.
   * @return _accruedPremiumInUnderlying The premium accrued for the protection.
   * @return _protectionExpired Whether the loan protection has expired or not.
   */
  function verifyAndAccruePremium(
    ProtectionPoolInfo storage poolInfo,
    ProtectionInfo storage protectionInfo,
    uint256 _lastPremiumAccrualTimestamp,
    uint256 _latestPaymentTimestamp
  )
    external
    view
    returns (uint256 _accruedPremiumInUnderlying, bool _protectionExpired)
  {
    uint256 _startTimestamp = protectionInfo.startTimestamp;

    /// This means no payment has been made after the protection is bought or protection starts in the future.
    /// so no premium needs to be accrued.
    if (
      _latestPaymentTimestamp < _startTimestamp ||
      _startTimestamp > block.timestamp
    ) {
      return (0, false);
    }

    /// Calculate the protection expiration timestamp and
    /// Check if the protection is expired or not.
    uint256 _expirationTimestamp = protectionInfo.startTimestamp +
      protectionInfo.purchaseParams.protectionDurationInSeconds;
    _protectionExpired = block.timestamp > _expirationTimestamp;

    /// Only accrue premium if the protection is expired
    /// or latest payment is made after the protection start & last premium accrual
    if (
      _protectionExpired ||
      (_latestPaymentTimestamp > _startTimestamp &&
        _latestPaymentTimestamp > _lastPremiumAccrualTimestamp)
    ) {
      /**
       * <-Protection Bought(second: 0) --- last accrual --- now(latestPaymentTimestamp) --- Expiration->
       * The time line starts when protection is bought and ends when protection is expired.
       * secondsUntilLastPremiumAccrual is the second elapsed since the last accrual timestamp.
       * secondsUntilLatestPayment is the second elapsed until latest payment is made.
       */

      // When premium is accrued for the first time, the _secondsUntilLastPremiumAccrual is 0.
      uint256 _secondsUntilLastPremiumAccrual;
      if (_lastPremiumAccrualTimestamp > _startTimestamp) {
        _secondsUntilLastPremiumAccrual =
          _lastPremiumAccrualTimestamp -
          _startTimestamp;
      }

      /// if loan protection is expired, then accrue premium till expiration and mark it for removal
      uint256 _secondsUntilLatestPayment;
      if (_protectionExpired) {
        _secondsUntilLatestPayment = _expirationTimestamp - _startTimestamp;
        console.log(
          "Protection expired for amt: %s",
          protectionInfo.purchaseParams.protectionAmount
        );
      } else {
        _secondsUntilLatestPayment = _latestPaymentTimestamp - _startTimestamp;
      }

      /// Calculate the accrued premium amount scaled to 18 decimals
      uint256 _accruedPremiumIn18Decimals = AccruedPremiumCalculator
        .calculateAccruedPremium(
          _secondsUntilLastPremiumAccrual,
          _secondsUntilLatestPayment,
          protectionInfo.K,
          protectionInfo.lambda
        );

      console.log(
        "accruedPremium from second %s to %s: ",
        _secondsUntilLastPremiumAccrual,
        _secondsUntilLatestPayment,
        _accruedPremiumIn18Decimals
      );

      /// Scale the premium amount to underlying decimals
      _accruedPremiumInUnderlying = scale18DecimalsAmtToUnderlyingDecimals(
        _accruedPremiumIn18Decimals,
        poolInfo.underlyingToken.decimals()
      );
    }
  }

  /**
   * @notice Marks the given protection as expired and moves it from active to expired protection indexes.
   * @param protectionBuyerAccounts storage pointer to protection buyer accounts
   * @param protectionInfo storage pointer to protection info
   * @param lendingPoolDetail storage pointer to lending pool detail
   * @param _protectionIndex The index of the protection to expire.
   */
  function expireProtection(
    mapping(address => ProtectionBuyerAccount) storage protectionBuyerAccounts,
    ProtectionInfo storage protectionInfo,
    LendingPoolDetail storage lendingPoolDetail,
    uint256 _protectionIndex
  ) public {
    /// Update protection info to mark it as expired
    protectionInfo.expired = true;

    /// remove expired protection index from activeProtectionIndexes of lendingPool & buyer account
    address _buyer = protectionInfo.buyer;
    lendingPoolDetail.activeProtectionIndexes.remove(_protectionIndex);
    ProtectionBuyerAccount storage buyerAccount = protectionBuyerAccounts[
      _buyer
    ];
    buyerAccount.activeProtectionIndexes.remove(_protectionIndex);

    /// Update buyer account to add expired protection index to expiredProtectionIndexes of lendingPool
    ProtectionPurchaseParams storage purchaseParams = protectionInfo
      .purchaseParams;
    buyerAccount.expiredProtectionIndexByLendingPool[
      purchaseParams.lendingPoolAddress
    ][purchaseParams.nftLpTokenId] = _protectionIndex;

    /// update total protection amount of lending pool by subtracting the expired protection amount
    lendingPoolDetail.totalProtection -= protectionInfo
      .purchaseParams
      .protectionAmount;
  }

  /**
   * @notice Scales the given underlying token amount to the amount with 18 decimals.
   * @param _underlyingAmt The amount to scale.
   * @param _underlyingTokenDecimals The number of decimals of the underlying token.
   * @return The scaled amount with 18 decimals.
   */
  function scaleUnderlyingAmtTo18Decimals(
    uint256 _underlyingAmt,
    uint256 _underlyingTokenDecimals
  ) public pure returns (uint256) {
    return
      (_underlyingAmt * Constants.SCALE_18_DECIMALS) /
      10**(_underlyingTokenDecimals);
  }

  /**
   * @notice Scales the given amount from 18 decimals to specified number of decimals.
   * @param amt The amount to scale.
   * @param _targetDecimals The number of decimals to scale to.
   * @return The scaled amount with target decimals.
   */
  function scale18DecimalsAmtToUnderlyingDecimals(
    uint256 amt,
    uint256 _targetDecimals
  ) public pure returns (uint256) {
    return (amt * 10**_targetDecimals) / Constants.SCALE_18_DECIMALS;
  }

  /**
   * @notice Verifies whether a buyer can renew protection for same lending position
   * in the same lending pool specified in the protection purchase params, otherwise reverts.
   * Protection can be renewed only within grace period after the protection is expired.
   * @param protectionBuyerAccounts storage pointer to protection buyer accounts
   * @param protectionInfos storage pointer to protection infos
   * @param _protectionPurchaseParams The protection purchase params.
   * @param _renewalGracePeriodInSeconds The grace period in seconds for renewal.
   */
  function verifyBuyerCanRenewProtection(
    mapping(address => ProtectionBuyerAccount) storage protectionBuyerAccounts,
    ProtectionInfo[] storage protectionInfos,
    ProtectionPurchaseParams calldata _protectionPurchaseParams,
    uint256 _renewalGracePeriodInSeconds
  ) external view {
    uint256 _renewalProtectionIndex = protectionBuyerAccounts[msg.sender]
      .expiredProtectionIndexByLendingPool[
        _protectionPurchaseParams.lendingPoolAddress
      ][_protectionPurchaseParams.nftLpTokenId];

    if (_renewalProtectionIndex == 0) {
      revert IProtectionPool.NoExpiredProtectionToRenew();
    }

    ProtectionInfo storage expiredProtectionInfo = protectionInfos[
      _renewalProtectionIndex
    ];
    ProtectionPurchaseParams
      storage expiredProtectionPurchaseParams = expiredProtectionInfo
        .purchaseParams;

    /// This means a buyer has expired protection for the same lending position
    if (
      expiredProtectionPurchaseParams.lendingPoolAddress ==
      _protectionPurchaseParams.lendingPoolAddress &&
      expiredProtectionPurchaseParams.nftLpTokenId ==
      _protectionPurchaseParams.nftLpTokenId
    ) {
      /// If we are NOT within grace period after the protection is expired, then revert
      if (
        block.timestamp >
        (expiredProtectionInfo.startTimestamp +
          expiredProtectionPurchaseParams.protectionDurationInSeconds +
          _renewalGracePeriodInSeconds)
      ) {
        revert IProtectionPool.CanNotRenewProtectionAfterGracePeriod();
      }
    }
  }

  /**
   * @dev Verify that the lending pool is active, otherwise revert.
   * @param defaultStateManager The default state manager contract.
   * @param _protectionPoolAddress The address of the protection pool.
   * @param _lendingPoolAddress The address of the lending pool.
   */
  function _verifyLendingPoolIsActive(
    IDefaultStateManager defaultStateManager,
    address _protectionPoolAddress,
    address _lendingPoolAddress
  ) internal view {
    LendingPoolStatus poolStatus = defaultStateManager.getLendingPoolStatus(
      _protectionPoolAddress,
      _lendingPoolAddress
    );

    if (poolStatus == LendingPoolStatus.NotSupported) {
      revert IProtectionPool.LendingPoolNotSupported(_lendingPoolAddress);
    }

    if (
      poolStatus == LendingPoolStatus.LateWithinGracePeriod ||
      poolStatus == LendingPoolStatus.Late
    ) {
      revert IProtectionPool.LendingPoolHasLatePayment(_lendingPoolAddress);
    }

    if (poolStatus == LendingPoolStatus.Expired) {
      revert IProtectionPool.LendingPoolExpired(_lendingPoolAddress);
    }

    if (poolStatus == LendingPoolStatus.Defaulted) {
      revert IProtectionPool.LendingPoolDefaulted(_lendingPoolAddress);
    }
  }

  /**
   * @dev Verify that the protection duration is valid, otherwise revert.
   * @param poolCycleManager The pool cycle manager contract.
   * @param _poolAddress The address of the protection pool.
   * @param _protectionStartTimestamp The protection start timestamp.
   * @param _protectionDurationInSeconds The protection duration in seconds.
   * @param _minProtectionDurationInSeconds The minimum protection duration in seconds.
   */
  function _verifyProtectionDuration(
    IProtectionPoolCycleManager poolCycleManager,
    address _poolAddress,
    uint256 _protectionStartTimestamp,
    uint256 _protectionDurationInSeconds,
    uint256 _minProtectionDurationInSeconds
  ) internal {
    uint256 _protectionExpirationTimestamp = _protectionStartTimestamp +
      _protectionDurationInSeconds;
    /// protection duration must be longer than specified minimum
    if (_protectionDurationInSeconds < _minProtectionDurationInSeconds) {
      revert IProtectionPool.ProtectionDurationTooShort(
        _protectionDurationInSeconds
      );
    }

    /// protection expiry can not be be after the next cycle end
    poolCycleManager.calculateAndSetPoolCycleState(_poolAddress);
    uint256 _nextCycleEndTimestamp = poolCycleManager.getNextCycleEndTimestamp(
      _poolAddress
    );

    if (_protectionExpirationTimestamp > _nextCycleEndTimestamp) {
      revert IProtectionPool.ProtectionDurationTooLong(
        _protectionDurationInSeconds
      );
    }
  }
}
