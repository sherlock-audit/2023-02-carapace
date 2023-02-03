// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@prb/math/contracts/PRBMathUD60x18.sol";

import {UUPSUpgradeableBase} from "../UUPSUpgradeableBase.sol";

import {IPoolTokens} from "../external/goldfinch/IPoolTokens.sol";
import {ITranchedPool} from "../external/goldfinch/ITranchedPool.sol";
import {ICreditLine} from "../external/goldfinch/ICreditLine.sol";
import {IGoldfinchConfig} from "../external/goldfinch/IGoldfinchConfig.sol";
import {ConfigOptions} from "../external/goldfinch/ConfigOptions.sol";
import {ISeniorPoolStrategy} from "../external/goldfinch/ISeniorPoolStrategy.sol";
import {ISeniorPool} from "../external/goldfinch/ISeniorPool.sol";

import {ILendingProtocolAdapter} from "../interfaces/ILendingProtocolAdapter.sol";
import {IReferenceLendingPools, ProtectionPurchaseParams} from "../interfaces/IReferenceLendingPools.sol";
import "../libraries/Constants.sol";

/**
 * @title GoldfinchAdapter
 * @author Carapace Finance
 * @notice Adapter for Goldfinch lending protocol
 * This contract is upgradeable using the UUPS pattern.
 */
contract GoldfinchAdapter is UUPSUpgradeableBase, ILendingProtocolAdapter {
  using PRBMathUD60x18 for uint256;

  /// Copied from Goldfinch's TranchingLogic.sol:
  /// https://github.com/goldfinch-eng/mono/blob/main/packages/protocol/contracts/protocol/core/TranchingLogic.sol#L42
  uint256 private constant NUM_TRANCHES_PER_SLICE = 2;

  /// This is the address of the goldfinch config contract
  /// which is used to access other goldfinch contracts and config vars.
  /// See: https://dev.goldfinch.finance/docs/reference/contracts/core/GoldfinchConfig
  address private constant GOLDFINCH_CONFIG_ADDRESS =
    0xaA425F8BfE82CD18f634e2Fe91E5DdEeFD98fDA1;

  /////////////////////////////////////////////////////
  ///             STORAGE - START                   ///
  /////////////////////////////////////////////////////
  /**
   * @dev DO NOT CHANGE THE ORDER OF THESE VARIABLES ONCE DEPLOYED
   */

  /// This contract stores mappings of useful goldfinch's "protocol config state".
  /// These config vars are enumerated in the `ConfigOptions` library.
  IGoldfinchConfig private goldfinchConfig;

  //////////////////////////////////////////////////////
  ///             STORAGE - END                     ///
  /////////////////////////////////////////////////////

  /*** initializer ***/
  function initialize(address _owner) external initializer {
    __UUPSUpgradeableBase_init();
    _transferOwnership(_owner);
    goldfinchConfig = IGoldfinchConfig(GOLDFINCH_CONFIG_ADDRESS);
  }

  /// @inheritdoc ILendingProtocolAdapter
  function isLendingPoolExpired(address _lendingPoolAddress)
    external
    view
    override
    returns (bool)
  {
    ICreditLine _creditLine = _getCreditLine(_lendingPoolAddress);
    uint256 _termEndTimestamp = _creditLine.termEndTime();

    /// Repaid logic derived from Goldfinch frontend code:
    /// https://github.com/goldfinch-eng/mono/blob/bd9adae6fbd810d1ebb5f7ef22df5bb6f1eaee3b/packages/client2/lib/pools/index.ts#L54
    /// when the credit line has zero balance with valid term end, it is considered repaid
    return
      block.timestamp >= _termEndTimestamp ||
      (_termEndTimestamp > 0 && _creditLine.balance() == 0);
  }

  /// @inheritdoc ILendingProtocolAdapter
  function isLendingPoolLate(address _lendingPoolAddress)
    external
    view
    override
    returns (bool)
  {
    return _isLendingPoolLate(_lendingPoolAddress);
  }

  /// @inheritdoc ILendingProtocolAdapter
  function isLendingPoolLateWithinGracePeriod(
    address _lendingPoolAddress,
    uint256 _gracePeriodInDays
  ) external view override returns (bool) {
    uint256 _lastPaymentTimestamp = _getLatestPaymentTimestamp(
      _lendingPoolAddress
    );

    /// Lending pool is considered late but within grace period if:
    /// 1. Lending pool is late and
    /// 2. Current time is less than the last payment time plus the payment period plus the grace period
    return
      _isLendingPoolLate(_lendingPoolAddress) &&
      block.timestamp <=
      (_lastPaymentTimestamp +
        ((_getCreditLine(_lendingPoolAddress).paymentPeriodInDays() +
          _gracePeriodInDays) * Constants.SECONDS_IN_DAY_UINT));
  }

  /// @inheritdoc ILendingProtocolAdapter
  function getLendingPoolTermEndTimestamp(address _lendingPoolAddress)
    external
    view
    override
    returns (uint256 _termEndTimestamp)
  {
    /// Term end time in goldfinch is timestamp of first drawdown + term length in seconds
    _termEndTimestamp = _getCreditLine(_lendingPoolAddress).termEndTime();
  }

  /// @inheritdoc ILendingProtocolAdapter
  function calculateProtectionBuyerAPR(address _lendingPoolAddress)
    external
    view
    override
    returns (uint256 _interestRate)
  {
    ITranchedPool _tranchedPool = ITranchedPool(_lendingPoolAddress);
    ICreditLine _creditLine = _tranchedPool.creditLine();

    uint256 _loanInterestRate = _creditLine.interestApr();
    uint256 _protocolFeePercent = _getProtocolFeePercent();

    /// Junior Reallocation Percent is plain uint, so we need to scale it to 18 decimals
    /// For example, juniorReallocationPercent of 20 => 0.2 => 20% => 20 * 10^16
    uint256 _juniorReallocationPercent = (_tranchedPool.juniorFeePercent() *
      Constants.SCALE_18_DECIMALS) / 100;

    uint256 _leverageRatio = _getLeverageRatio(_tranchedPool);

    /// Backers receive an effective interest rate of:
    /// I(junior) = Interest Rate Percent ∗ (1 − Protocol Fee Percent + (Leverage Ratio ∗ Junior Reallocation Percent))
    /// details: https://docs.goldfinch.finance/goldfinch/protocol-mechanics/backers
    /// For example: Consider a Borrower Pool with a 15% interest rate and 4X leverage ratio.
    /// junior tranche(backers/buyers) interest rate: 0.15 * (1 - 0.1 + (4 * 0.2)) = 0.255 = 25.5%
    _interestRate = _loanInterestRate.mul(
      Constants.SCALE_18_DECIMALS -
        _protocolFeePercent +
        _leverageRatio.mul(_juniorReallocationPercent)
    );
  }

  /// @inheritdoc ILendingProtocolAdapter
  function calculateRemainingPrincipal(
    address _lendingPoolAddress,
    address _lender,
    uint256 _nftLpTokenId
  ) public view override returns (uint256 _principalRemaining) {
    IPoolTokens _poolTokens = _getPoolTokens();

    /// If lender owns the NFT, then calculate the remaining principal
    /// otherwise, the remaining principal is zero
    if (_poolTokens.ownerOf(_nftLpTokenId) == _lender) {
      IPoolTokens.TokenInfo memory _tokenInfo = _poolTokens.getTokenInfo(
        _nftLpTokenId
      );

      /// If the token is for the specified lending pool and is a junior tranche, then calculate the remaining principal
      /// otherwise, the remaining principal is zero
      /// Only junior tranche is allowed to have protection coverage
      if (
        _tokenInfo.pool == _lendingPoolAddress &&
        _isJuniorTrancheId(_tokenInfo.tranche)
      ) {
        _principalRemaining =
          _tokenInfo.principalAmount -
          _tokenInfo.principalRedeemed;
      }
    }
  }

  /// @inheritdoc ILendingProtocolAdapter
  function getPaymentPeriodInDays(address _lendingPool)
    public
    view
    override
    returns (uint256)
  {
    return _getCreditLine(_lendingPool).paymentPeriodInDays();
  }

  /// @inheritdoc ILendingProtocolAdapter
  function getLatestPaymentTimestamp(address _lendingPool)
    public
    view
    override
    returns (uint256)
  {
    return _getLatestPaymentTimestamp(_lendingPool);
  }

  /** internal functions */

  /**
   * @dev copied from TranchingLogic: https://github.com/goldfinch-eng/mono/blob/main/packages/protocol/contracts/protocol/core/TranchingLogic.sol#L419
   */
  function _isJuniorTrancheId(uint256 trancheId) internal pure returns (bool) {
    return trancheId != 0 && (trancheId % NUM_TRANCHES_PER_SLICE) == 0;
  }

  /**
   * @dev Calculates the protocol fee percent based on reserve denominator
   * @return _feePercent protocol fee percent scaled to 18 decimals
   */
  function _getProtocolFeePercent()
    internal
    view
    returns (uint256 _feePercent)
  {
    uint256 reserveDenominator = goldfinchConfig.getNumber(
      uint256(ConfigOptions.Numbers.ReserveDenominator)
    );

    /// Convert the denominator to percent and scale by 18 decimals
    /// reserveDenominator = 10 => 0.1 percent => (1 * 10 ** 18)/10 => 10 ** 17
    _feePercent = Constants.SCALE_18_DECIMALS / reserveDenominator;
  }

  /**
   * @dev Provides the leverage ratio used for specified tranched pool.
   * @param _tranchedPool address of tranched pool
   * @return _leverageRatio scaled to 18 decimals. For example: 4X leverage ratio => 4 * 10 ** 18
   */
  function _getLeverageRatio(ITranchedPool _tranchedPool)
    internal
    view
    returns (uint256 _leverageRatio)
  {
    ISeniorPoolStrategy _seniorPoolStrategy = ISeniorPoolStrategy(
      goldfinchConfig.getAddress(
        uint256(ConfigOptions.Addresses.SeniorPoolStrategy)
      )
    );
    return _seniorPoolStrategy.getLeverageRatio(_tranchedPool);
  }

  /**
   * @dev Provides the PoolTokens contract
   */
  function _getPoolTokens() internal view returns (IPoolTokens) {
    return
      IPoolTokens(
        goldfinchConfig.getAddress(uint256(ConfigOptions.Addresses.PoolTokens))
      );
  }

  /**
   * @dev Provides the credit line contract for specified tranched pool(lending pool) address
   * @param _lendingPoolAddress address of tranched pool
   */
  function _getCreditLine(address _lendingPoolAddress)
    internal
    view
    returns (ICreditLine)
  {
    return ITranchedPool(_lendingPoolAddress).creditLine();
  }

  /**
   * @dev Provides the latest payment timestamp for specified tranched pool(lending pool) address
   * @param _lendingPool address of tranched pool
   */
  function _getLatestPaymentTimestamp(address _lendingPool)
    internal
    view
    returns (uint256)
  {
    return _getCreditLine(_lendingPool).lastFullPaymentTime();
  }

  /**
   * @dev Checks if the tranched pool(lending pool) is late
   * @param _lendingPoolAddress address of tranched pool
   */
  function _isLendingPoolLate(address _lendingPoolAddress)
    internal
    view
    returns (bool)
  {
    return _getCreditLine(_lendingPoolAddress).isLate();
  }
}
