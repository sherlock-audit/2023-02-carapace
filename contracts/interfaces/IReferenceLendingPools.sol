// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import {LendingProtocol} from "./ILendingProtocolAdapter.sol";

/// @notice Enum to represent the status of the lending pool
enum LendingPoolStatus {
  /// @notice This means the lending pool is not added to the basket and the protection can NOT be purchased
  NotSupported,
  /// @notice This means the lending pool is added to the basket and the protection can be purchased
  Active,
  /// @notice This means the lending pool is late for payment but within the grace period and the protection can NOT be purchased
  LateWithinGracePeriod,
  /// @notice This means the lending pool is late for payment and beyond the grace period and the protection can NOT be purchased
  Late,
  /// @notice This means the lending pool is defaulted and the protection can NOT be purchased
  Defaulted,
  /// @notice This means the lending pool is either fully repaid or full term has been completed and the protection can NOT be purchased
  Expired
}

/// @notice This struct represents the information of the reference lending pool for which buyers can purchase the protection
struct ReferenceLendingPoolInfo {
  /// @notice the protocol of the lending pool
  LendingProtocol protocol;
  /// @notice the timestamp at which the lending pool is added to the basket of pools
  uint256 addedTimestamp;
  /// @notice the timestamp at which the protection purchase limit expires,
  /// meaning the protection can NOT be purchased after this timestamp
  uint256 protectionPurchaseLimitTimestamp;
}

/// @notice This struct represents the protection purchase parameters such as the protection amount, duration, etc.
struct ProtectionPurchaseParams {
  /// @notice address of the lending pool where the buyer has a lending position
  address lendingPoolAddress;
  /// @notice Id of ERC721 LP token received by the buyer to represent the deposit in the lending pool
  /// Buyer has to specify `nftTokenId` when underlying protocol provides ERC721 LP token, i.e. Goldfinch
  uint256 nftLpTokenId;
  /// @notice the protection amount in underlying tokens
  uint256 protectionAmount;
  /// @notice the protection duration in seconds
  uint256 protectionDurationInSeconds;
}

/**
 * @notice Interface to represent the basket of the Carapace eligible lending pools
 * for which the protocol can provide the protection.
 */
abstract contract IReferenceLendingPools {
  /*** events ***/

  /// @notice emitted when a new reference lending pool is added to the basket
  event ReferenceLendingPoolAdded(
    address indexed lendingPoolAddress,
    LendingProtocol indexed lendingPoolProtocol,
    uint256 addedTimestamp,
    uint256 protectionPurchaseLimitTimestamp
  );

  /** errors */
  error ReferenceLendingPoolsConstructionError(string error);
  error ReferenceLendingPoolNotSupported(address lendingPoolAddress);
  error ReferenceLendingPoolAlreadyAdded(address lendingPoolAddress);
  error ReferenceLendingPoolIsNotActive(address lendingPoolAddress);
  error ReferenceLendingPoolIsZeroAddress();

  /**
   * @notice the initialization function for the reference lending pools contract.
   * This is intended to be called just once upon creation of a proxy contract.
   * @param _owner the owner of the contract
   * @param _lendingPools the addresses of the lending pools which will be added to the basket
   * @param _lendingPoolProtocols the corresponding protocols of the lending pools which will be added to the basket
   * @param _protectionPurchaseLimitsInDays the corresponding protection purchase limits(in days) of the lending pools,
   * which will be added to the basket
   * @param _lendingProtocolAdapterFactory the address of the contract which implements interface {LendingProtocolAdapterFactory}
   */
  function initialize(
    address _owner,
    address[] calldata _lendingPools,
    LendingProtocol[] calldata _lendingPoolProtocols,
    uint256[] calldata _protectionPurchaseLimitsInDays,
    address _lendingProtocolAdapterFactory
  ) external virtual;

  /**
   * @notice returns all lending pools which are added/available in this basket
   */
  function getLendingPools() public view virtual returns (address[] memory);

  /**
   * @notice Determines whether a buyer can buy the protection for the specified lending pool or not.
   * 1. A buyer can buy protection only within certain time an underlying lending pool added
   * to the basket of the Carapace eligible loans.
   * 2. A buyer can buy protection only when h/she has position in the specified lending pool and
   * protection amount is less than or equal to the amount lent
   * @param _buyer the address of the buyer
   * @param _purchaseParams the protection purchase parameters
   * @param _isExtension flag to indicate whether the buyer is extending existing  protection or not
   * @return true if the buyer can buy protection, false otherwise
   */
  function canBuyProtection(
    address _buyer,
    ProtectionPurchaseParams calldata _purchaseParams,
    bool _isExtension
  ) external view virtual returns (bool);

  /**
   * @notice Calculates the protection buyer's annual interest rate for the specified underlying lending pool.
   * @param _lendingPoolAddress address of the lending pool
   * @return annual interest rate scaled to 18 decimals
   */
  function calculateProtectionBuyerAPR(address _lendingPoolAddress)
    public
    view
    virtual
    returns (uint256);

  /**
   * @notice assess & return statuses of all lending pools in this basket
   */
  function assessState()
    public
    view
    virtual
    returns (
      address[] memory _lendingPools,
      LendingPoolStatus[] memory _statues
    );

  /**
   * @notice Calculate and returns the principal amount that is remaining in the specified lending pool
   * for the specified lender for the specified token id.
   * If lender does not have matching lending position, then it returns 0.
   * @param _lendingPool address of the lending pool
   * @param _lender address of the lender
   * @param _nftLpTokenId the id of NFT token representing the lending position of the specified lender
   * @return the remaining principal amount in underlying tokens
   */
  function calculateRemainingPrincipal(
    address _lendingPool,
    address _lender,
    uint256 _nftLpTokenId
  ) public view virtual returns (uint256);

  /**
   * @notice Returns the latest payment timestamp of the specified lending pool
   * @param _lendingPool address of the lending pool
   * @return latest payment timestamp in seconds
   */
  function getLatestPaymentTimestamp(address _lendingPool)
    public
    view
    virtual
    returns (uint256);

  /**
   * @notice Returns the payment period of the specified lending pool in days
   * @param _lendingPool address of the lending pool
   * @return payment period in days unscaled, i.e. 1 day = 1
   */
  function getPaymentPeriodInDays(address _lendingPool)
    public
    view
    virtual
    returns (uint256);
}
