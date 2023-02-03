// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// @notice Enum of supported lending protocols
enum LendingProtocol {
  Goldfinch
}

/// @notice Interface for lending protocol adapters
abstract contract ILendingProtocolAdapter {
  /**
   * @notice Determines whether the specified lending pool's term has ended or balance has been repaid.
   * @param _lendingPoolAddress the address of the lending pool
   */
  function isLendingPoolExpired(address _lendingPoolAddress)
    external
    view
    virtual
    returns (bool);

  /**
   * @notice Determines whether the specified lending pool is late for payment.
   * @param _lendingPoolAddress the address of the lending pool
   */
  function isLendingPoolLate(address _lendingPoolAddress)
    external
    view
    virtual
    returns (bool);

  /**
   * @notice Returns the term end timestamp of the lending pool
   * @param _lendingPoolAddress Address of the underlying lending pool
   * @return Timestamp of the term end in seconds
   */
  function getLendingPoolTermEndTimestamp(address _lendingPoolAddress)
    external
    view
    virtual
    returns (uint256);

  /**
   * @notice Calculates the interest rate for the protection buyer for the specified lending pool
   * @param _lendingPoolAddress Address of the underlying lending pool
   * @return Interest rate for the protection buyer, scaled to 18 decimals
   */
  function calculateProtectionBuyerAPR(address _lendingPoolAddress)
    external
    view
    virtual
    returns (uint256);

  /**
   * @notice Returns the principal amount that is remaining in the specified lending pool for the specified lender for the specified token id.
   * @param _lendingPoolAddress the address of the underlying lending pool
   * @param _lender address of the lender
   * @param _nftLpTokenId the id of NFT token representing the lending position of the specified lender
   * @return the remaining principal amount in underlying
   */
  function calculateRemainingPrincipal(
    address _lendingPoolAddress,
    address _lender,
    uint256 _nftLpTokenId
  ) public view virtual returns (uint256);

  /**
   * @notice Returns the latest payment timestamp of the specified lending pool
   * @param _lendingPool Address of the lending pool
   */
  function getLatestPaymentTimestamp(address _lendingPool)
    public
    view
    virtual
    returns (uint256);

  /**
   * @notice Determines whether the specified lending pool is late for payment but within the specified grace period.
   * @param _lendingPoolAddress the address of the lending pool
   * @param _gracePeriodInDays the grace period in days using unscaled value, i.e. 1 day = 1
   * @return true if the lending pool is late for payment but within the specified grace period
   */
  function isLendingPoolLateWithinGracePeriod(
    address _lendingPoolAddress,
    uint256 _gracePeriodInDays
  ) external view virtual returns (bool);

  /**
   * @notice Returns the payment period of the specified lending pool in days
   * @param _lendingPool Address of the lending pool
   * @return Payment period in days, unscaled, i.e. 1 day = 1
   */
  function getPaymentPeriodInDays(address _lendingPool)
    public
    view
    virtual
    returns (uint256);
}
