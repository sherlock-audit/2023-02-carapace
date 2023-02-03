// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {IERC20MetadataUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import {EnumerableSetUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import {IReferenceLendingPools, ProtectionPurchaseParams} from "./IReferenceLendingPools.sol";
import {IPremiumCalculator} from "./IPremiumCalculator.sol";
import {IProtectionPoolCycleManager} from "./IProtectionPoolCycleManager.sol";
import {IDefaultStateManager} from "./IDefaultStateManager.sol";

/// @notice Enum to represent the phase of the protection pool
enum ProtectionPoolPhase {
  /// @notice This means the pool is open for sellers/investors and NOT open for protection purchases
  OpenToSellers,
  /// @notice This means the pool is open for protection purchases and NOT open for sellers/investors
  OpenToBuyers,
  /// @notice This means the pool is open for both sellers/investors and protection purchases
  Open
}

/// @notice Contains various parameters which are used to create a new protection pool
struct ProtectionPoolParams {
  /// @notice the minimum leverage ratio allowed in the pool scaled to 18 decimals
  uint256 leverageRatioFloor;
  /// @notice the maximum leverage ratio allowed in the pool scaled to 18 decimals
  uint256 leverageRatioCeiling;
  /// @notice the leverage ratio buffer used in risk factor calculation scaled to 18 decimals
  uint256 leverageRatioBuffer;
  /// @notice the minimum capital required capital in the pool in underlying tokens
  uint256 minRequiredCapital;
  /// @notice curvature used in risk premium calculation scaled to 18 decimals
  uint256 curvature;
  /// @notice the minimum premium rate in percent paid by a protection buyer scaled to 18 decimals
  uint256 minCarapaceRiskPremiumPercent;
  /// @notice the percent of protection buyers' yield used in premium calculation scaled to 18 decimals
  uint256 underlyingRiskPremiumPercent;
  /// @notice the minimum duration of the protection coverage in seconds that buyer has to buy
  uint256 minProtectionDurationInSeconds;
  /// @notice the maximum duration in seconds during which a protection can be renewed after it expires
  uint256 protectionRenewalGracePeriodInSeconds;
}

/// @notice Contains protection pool information
struct ProtectionPoolInfo {
  /// @notice Various parameters used to create a new protection pool. See {ProtectionPoolParams}
  ProtectionPoolParams params;
  /// @notice address of ERC-20 compliant underlying token
  IERC20MetadataUpgradeable underlyingToken;
  /// @notice address of reference lending pools contract representing the basket of supported lending pools
  IReferenceLendingPools referenceLendingPools;
  /// @notice A enum indicating current phase of the pool.
  ProtectionPoolPhase currentPhase;
}

/// @notice A struct to store information about a protection purchased from this protection pool
struct ProtectionInfo {
  /// @notice the address of a protection buyer
  address buyer;
  /// @notice The amount of premium paid in underlying token
  uint256 protectionPremium;
  /// @notice The timestamp at which the protection is bought
  uint256 startTimestamp;
  /// @notice Constant K is calculated & captured at the time of the protection purchase
  /// This is used in accrued premium calculation.
  // solhint-disable-next-line var-name-mixedcase
  int256 K;
  /// @notice Lambda is calculated & captured at the time of the protection purchase
  /// This is used in accrued premium calculation
  int256 lambda;
  /// @notice A flag indicating if the protection is expired or not
  bool expired;
  /// @notice The protection purchase parameters such as protection amount, expiry, lending pool etc.
  ProtectionPurchaseParams purchaseParams;
}

/// @notice A struct to store the details of a lending pool such as
/// total premium, total protection, active protection indexes etc.
struct LendingPoolDetail {
  uint256 lastPremiumAccrualTimestamp;
  /// @notice Track the total amount of premium for each lending pool
  uint256 totalPremium;
  /// @notice Set to track all protections bought for specific lending pool, which are active/not expired
  EnumerableSetUpgradeable.UintSet activeProtectionIndexes;
  /// @notice Track the total amount of protection bought for each lending pool
  uint256 totalProtection;
}

/// @notice A struct to store the details of a withdrawal cycle.
struct WithdrawalCycleDetail {
  /// @notice total amount of sTokens requested to be withdrawn for this cycle
  uint256 totalSTokenRequested;
  /// @notice The mapping to track the requested amount of sTokens to withdraw
  /// per protection seller for this withdrawal cycle.
  mapping(address => uint256) withdrawalRequests;
}

/// @notice A struct to store the details of a protection buyer.
struct ProtectionBuyerAccount {
  /// @notice The premium amount for each lending pool per buyer
  /// @dev a lending pool address to the premium amount paid
  mapping(address => uint256) lendingPoolToPremium;
  /// @notice Set to track all protections bought by a buyer, which are active/not-expired.
  EnumerableSetUpgradeable.UintSet activeProtectionIndexes;
  /// @notice Mapping to track last expired protection index of given lending pool by nft token id.
  /// @dev a lending pool address to NFT id to the last expired protection index
  mapping(address => mapping(uint256 => uint256)) expiredProtectionIndexByLendingPool;
}

/// @notice Interface for the protection pool contract
abstract contract IProtectionPool {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.UintSet;

  /*** errors ***/
  error LendingPoolNotSupported(address lendingPoolAddress);
  error LendingPoolHasLatePayment(address lendingPoolAddress);
  error LendingPoolExpired(address lendingPoolAddress);
  error LendingPoolDefaulted(address lendingPoolAddress);
  error ProtectionPurchaseNotAllowed(ProtectionPurchaseParams params);
  error ProtectionDurationTooShort(uint256 protectionDurationInSeconds);
  error ProtectionDurationTooLong(uint256 protectionDurationInSeconds);
  error ProtectionPoolIsNotOpen();
  error ProtectionPoolLeverageRatioTooHigh(uint256 leverageRatio);
  error ProtectionPoolLeverageRatioTooLow(uint256 leverageRatio);
  error ProtectionPoolHasNoMinCapitalRequired(uint256 totalSTokenUnderlying);
  error NoWithdrawalRequested(address msgSender, uint256 poolCycleIndex);
  error WithdrawalHigherThanRequested(
    address msgSender,
    uint256 requestedSTokenAmount
  );
  error InsufficientSTokenBalance(address msgSender, uint256 sTokenBalance);
  error OnlyDefaultStateManager(address msgSender);
  error ProtectionPoolInOpenToSellersPhase();
  error ProtectionPoolInOpenToBuyersPhase();
  error NoExpiredProtectionToRenew();
  error CanNotRenewProtectionAfterGracePeriod();
  error PremiumExceedsMaxPremiumAmount(
    uint256 premiumAmount,
    uint256 maxPremiumAmount
  );

  /*** events ***/

  /// @notice Emitted when a new pool is created.
  event ProtectionPoolInitialized(
    string name,
    string symbol,
    IERC20MetadataUpgradeable underlyingToken,
    IReferenceLendingPools referenceLendingPools
  );

  /// @notice Emitted when a protection is sold., i.e. when an investor deposits underlying tokens to the pool.
  event ProtectionSold(
    address indexed protectionSeller,
    uint256 protectionAmount
  );

  /// @notice Emitted when a new protection is bought from the pool by a buyer.
  event ProtectionBought(
    address indexed buyer,
    address indexed lendingPoolAddress,
    uint256 protectionAmount,
    uint256 premium
  );

  /// @notice Emitted when a existing protection is expired.
  event ProtectionExpired(
    address indexed buyer,
    address indexed lendingPoolAddress,
    uint256 protectionAmount
  );

  /// @notice Emitted when premium is accrued from all protections bought for a lending pool.
  event PremiumAccrued(
    address indexed lendingPool,
    uint256 lastPremiumAccrualTimestamp
  );

  /// @notice Emitted when a withdrawal request is made by a seller/investor.
  event WithdrawalRequested(
    address indexed seller,
    uint256 sTokenAmount,
    uint256 withdrawalCycleIndex // An index of a pool cycle when actual withdrawal can be made
  );

  /// @notice Emitted when a withdrawal is made by a seller/investor.
  event WithdrawalMade(
    address indexed seller,
    uint256 tokenAmount,
    address receiver
  );

  /// @notice Emitted when a pool phase is updated.
  event ProtectionPoolPhaseUpdated(ProtectionPoolPhase newPhase);

  /**
   * @notice Initializes the pool contract
   * @param _owner The owner of the pool
   * @param _poolInfo The information about this protection pool.
   * @param _premiumCalculator an address of a premium calculator contract
   * @param _poolCycleManager an address of a protection pool cycle manager contract
   * @param _defaultStateManager an address of a default state manager contract
   * @param _name a name of the sToken
   * @param _symbol a symbol of the sToken
   */
  function initialize(
    address _owner,
    ProtectionPoolInfo calldata _poolInfo,
    IPremiumCalculator _premiumCalculator,
    IProtectionPoolCycleManager _poolCycleManager,
    IDefaultStateManager _defaultStateManager,
    string calldata _name,
    string calldata _symbol
  ) external virtual;

  /**
   * @notice A buyer can buy protection for a lending position when lending pool is supported & active (not defaulted or expired).
   * Buyer must have a position in the lending pool & principal must be less or equal to the protection amount.
   * Buyer must approve underlying tokens to pay the expected premium.
   * @param _protectionPurchaseParams The protection purchase parameters such as protection amount, duration, lending pool etc.
   * @param _maxPremiumAmount the max protection premium in underlying tokens that buyer is willing to pay.
   * If protection premium calculated at the time of transaction is higher than the max premium amount, transaction will revert.
   */
  function buyProtection(
    ProtectionPurchaseParams calldata _protectionPurchaseParams,
    uint256 _maxPremiumAmount
  ) external virtual;

  /**
   * @notice A buyer can renew a protection for a lending position when lending pool is supported & active (not defaulted or expired).
   * Buyer must have a existing active protection for the same lending position, meaning same lending pool & nft token id.
   * Remaining principal in lending position must be less or equal to the renewal protection amount.
   * Protection renewal's duration must not exceed the end time of next pool cycle.
   * Buyer must approve underlying tokens to pay the expected premium.
   * @param _protectionPurchaseParams The protection purchase parameters such as protection amount, duration, lending pool etc.
   * @param _maxPremiumAmount the max protection premium in underlying tokens that buyer is willing to pay.
   * If protection premium calculated at the time of transaction is higher than the max premium amount, transaction will revert.
   */
  function renewProtection(
    ProtectionPurchaseParams calldata _protectionPurchaseParams,
    uint256 _maxPremiumAmount
  ) external virtual;

  /**
   * @notice Attempts to deposit the underlying amount specified.
   * Upon successful deposit, receiver will get sTokens based on current exchange rate.
   * A deposit can only be made when the protection pool is in "OpenToSellers" or "Open" phase.
   * Underlying amount needs to be approved for transfer to this contract.
   * @param _underlyingAmount The amount of underlying token to deposit.
   * @param _receiver The address to receive the STokens.
   */
  function deposit(uint256 _underlyingAmount, address _receiver)
    external
    virtual;

  /**
   * @notice Creates a withdrawal request for the given sToken amount to allow
   * actual withdrawal during open period following the next pool cycle's end.
   * @notice Each user can have single request per withdrawal cycle and
   * hence this function will overwrite any existing request.
   * @notice The actual withdrawal could be made during open period following the next pool cycle's end.
   * @param _sTokenAmount The amount of sToken to withdraw.
   */
  function requestWithdrawal(uint256 _sTokenAmount) external virtual;

  /**
   * @notice This function allows deposit and requestWithdrawal to be called in same transaction.
   * Receiver of the sTokens will be the msg.sender.
   * Underlying amount needs to be approved for transfer to this contract.
   * @param _underlyingAmountToDeposit The amount of underlying token to deposit.
   * @param _sTokenAmountToWithdraw The amount of sToken to withdraw.
   */
  function depositAndRequestWithdrawal(
    uint256 _underlyingAmountToDeposit,
    uint256 _sTokenAmountToWithdraw
  ) external virtual;

  /**
   * @notice Attempts to withdraw the sToken amount specified by the user.
   * A withdrawal request must exist for current withdrawal cycle for the holder of the sToken.
   * A withdrawal can only be made when the pool cycle is in "Open" state.
   * Proportional Underlying amount based on current exchange rate will be transferred to the receiver address.
   * @param _sTokenWithdrawalAmount The amount of sToken to withdraw.
   * @param _receiver The address to receive the underlying token.
   */
  function withdraw(uint256 _sTokenWithdrawalAmount, address _receiver)
    external
    virtual;

  /**
   * @notice Accrues the premium from all existing protections and updates the total premium accrued.
   * This function accrues premium from the last accrual timestamp to the latest payment timestamp of the underlying lending pool.
   * This function  also marks protections expired when protection duration has expired.
   * @param _lendingPools The lending pools for which premium needs to be accrued and protections need to be marked expired.
   * This is optional parameter. If not provided, premium will be accrued for all reference lending pools.
   *
   * @dev This function iterates over all active protections and may run into gas cost limit,
   * so optional parameter is provided to limit the number of protections iterated.
   */
  function accruePremiumAndExpireProtections(address[] memory _lendingPools)
    external
    virtual;

  /**
   * @notice Returns various parameters and other pool related info.
   */
  function getPoolInfo()
    external
    view
    virtual
    returns (ProtectionPoolInfo memory);

  /**
   * @notice Calculates and returns leverage ratio scaled to 18 decimals.
   * For example: 0.15 is returned as 0.15 x 10**18 = 15 * 10**16
   */
  function calculateLeverageRatio() external view virtual returns (uint256);

  /**
   * @notice Calculates & locks the required capital for specified lending pool in case late payment turns into default.
   * This method can only be called by the default state manager.
   * @dev Function is marked payable as gas optimization
   * @param _lendingPoolAddress The address of the lending pool.
   * @return _lockedAmount The amount of capital locked.
   * @return _snapshotId The id of SToken snapshot to capture the seller's share of the locked amount.
   */
  function lockCapital(address _lendingPoolAddress)
    external
    payable
    virtual
    returns (uint256 _lockedAmount, uint256 _snapshotId);

  /**
   * @notice Claims the total unlocked capital from this protection pool for a msg.sender.
   * this function claims the capital from all the lending pools supported by this protection pool.
   * @param _receiver The address to receive the underlying token amount.
   */
  function claimUnlockedCapital(address _receiver) external virtual;

  /**
   * @notice Calculates the premium amount for the given protection purchase params.
   * @param _protectionPurchaseParams The protection purchase parameters such as protection amount, duration, lending pool etc.
   * @return _premiumAmount The premium amount in underlying token.
   * @return _isMinPremium Whether the premium amount is minimum premium or not.
   */
  function calculateProtectionPremium(
    ProtectionPurchaseParams calldata _protectionPurchaseParams
  ) external view virtual returns (uint256 _premiumAmount, bool _isMinPremium);

  /**
   * @notice Calculates the max protection amount allowed in underlying token for the given lending position.
   * If a buyer(msg.sender) does not have matching lending position, then it returns 0.
   * @param _lendingPool address of the lending pool
   * @param _nftLpTokenId the id of NFT token representing the lending position of the buyer (msg.sender)
   * @return _maxAllowedProtectionAmount The max allowed protection amount in underlying token.
   */
  function calculateMaxAllowedProtectionAmount(
    address _lendingPool,
    uint256 _nftLpTokenId
  ) external view virtual returns (uint256 _maxAllowedProtectionAmount);

  /**
   * @notice Calculates the max protection duration allowed for buying or extending a protection at this moment.
   * @return _maxAllowedProtectionDurationInSeconds The max allowed protection duration in seconds as unscaled integer.
   */
  function calculateMaxAllowedProtectionDuration()
    external
    view
    virtual
    returns (uint256 _maxAllowedProtectionDurationInSeconds);

  /**
   * @notice Converts the given underlying amount to SToken shares/amount.
   * @param _underlyingAmount The amount of underlying assets to be converted in underlying decimals.
   * @return The SToken shares/amount scaled to 18 decimals.
   */
  function convertToSToken(uint256 _underlyingAmount)
    public
    view
    virtual
    returns (uint256);

  /**
   * @notice Converts specified SToken balance to underlying amount.
   * the exchange rate: SToken balance * the exchange rate
   * @param _sTokenShares The amount of SToken shares to be converted, scaled to 18 decimals.
   * @return The underlying amount scaled to underlying decimals.
   */
  function convertToUnderlying(uint256 _sTokenShares)
    public
    view
    virtual
    returns (uint256);

  /**
   * @notice Returns the msg.sender's requested Withdrawal amount for the specified withdrawal cycle index.
   * @param _withdrawalCycleIndex The index of the withdrawal cycle.
   * @return The requested withdrawal amount in this pool's token, sToken, scaled to 18 decimals.
   */
  function getRequestedWithdrawalAmount(uint256 _withdrawalCycleIndex)
    external
    view
    virtual
    returns (uint256);

  /**
   * @notice Returns the msg.sender's requested Withdrawal amount for the current withdrawal cycle index.
   * @return The requested withdrawal amount in this pool's token, sToken, scaled to 18 decimals.
   */
  function getCurrentRequestedWithdrawalAmount()
    external
    view
    virtual
    returns (uint256);

  /**
   * @notice Returns the total requested Withdrawal amount for the specified withdrawal cycle index.
   * @param _withdrawalCycleIndex The index of the withdrawal cycle.
   * @return The total requested withdrawal amount in this pool's token, sToken, scaled to 18 decimals.
   */
  function getTotalRequestedWithdrawalAmount(uint256 _withdrawalCycleIndex)
    external
    view
    virtual
    returns (uint256);

  /**
   * @notice Returns the lending pool's detail.
   * @param _lendingPoolAddress The address of the lending pool.
   * @return _lastPremiumAccrualTimestamp The timestamp of the last premium accrual.
   * @return _totalPremium The total premium paid for the lending pool.
   * @return _totalProtection The total protection bought for the lending pool.
   */
  function getLendingPoolDetail(address _lendingPoolAddress)
    external
    view
    virtual
    returns (
      uint256 _lastPremiumAccrualTimestamp,
      uint256 _totalPremium,
      uint256 _totalProtection
    );

  /**
   * @notice Returns all the protections bought from the pool, active & expired.
   */
  function getAllProtections()
    external
    view
    virtual
    returns (ProtectionInfo[] memory _protections);

  /**
   * @notice Returns all active protections bought by the specified buyer.
   * @param _buyer The address of the buyer.
   * @return _protectionInfos The array of active protections.
   */
  function getActiveProtections(address _buyer)
    external
    view
    virtual
    returns (ProtectionInfo[] memory _protectionInfos);

  /**
   * @notice Returns total premium paid by buyer for the specified lending pool.
   * @param _buyer The address of the buyer.
   * @param _lendingPoolAddress The address of the lending pool.
   */
  function getTotalPremiumPaidForLendingPool(
    address _buyer,
    address _lendingPoolAddress
  ) external view virtual returns (uint256);

  /**
   * Returns pool details such as total sToken underlying(capital), protection etc.
   * @return _totalSTokenUnderlying The total sToken underlying (capital) in the pool, in underlying token.
   * @return _totalProtection The total protection bought in the pool, in underlying token.
   * @return _totalPremium The total premium paid in the pool, in underlying token.
   * @return _totalPremiumAccrued The total premium accrued from the protections, in underlying token.
   */
  function getPoolDetails()
    external
    view
    virtual
    returns (
      uint256 _totalSTokenUnderlying,
      uint256 _totalProtection,
      uint256 _totalPremium,
      uint256 _totalPremiumAccrued
    );

  /**
   * Returns the current balance of the specified user in underlying token.
   * @param _user The address of the user.
   * @return The balance of the user in underlying token.
   */
  function getUnderlyingBalance(address _user)
    external
    view
    virtual
    returns (uint256);
}
