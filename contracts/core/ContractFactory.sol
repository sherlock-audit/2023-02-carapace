// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {IERC20MetadataUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import {AddressUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";

import {OwnableUpgradeable, UUPSUpgradeableBase} from "../UUPSUpgradeableBase.sol";
import {ERC1967Proxy} from "../external/openzeppelin/ERC1967/ERC1967Proxy.sol";
import {IProtectionPool, ProtectionPoolParams, ProtectionPoolInfo, ProtectionPoolPhase} from "../interfaces/IProtectionPool.sol";
import {IPremiumCalculator} from "../interfaces/IPremiumCalculator.sol";
import {IReferenceLendingPools} from "../interfaces/IReferenceLendingPools.sol";
import {ProtectionPoolCycleParams, IProtectionPoolCycleManager} from "../interfaces/IProtectionPoolCycleManager.sol";
import {IDefaultStateManager} from "../interfaces/IDefaultStateManager.sol";
import {IReferenceLendingPools, LendingProtocol} from "../interfaces/IReferenceLendingPools.sol";
import {ILendingProtocolAdapter} from "../interfaces/ILendingProtocolAdapter.sol";
import {ILendingProtocolAdapterFactory} from "../interfaces/ILendingProtocolAdapterFactory.sol";

import "../libraries/Constants.sol";

/**
 * @title ContractFactory
 * @author Carapace Finance
 * @notice This contract is used to create new upgradable instances of following contracts using ERC1967 proxy:
 * {IProtectionPool}, {IReferenceLendingPools} and {ILendingProtocolAdapter}
 *
 * @dev This factory contract is also upgradeable using the UUPS pattern.
 */
contract ContractFactory is
  UUPSUpgradeableBase,
  ILendingProtocolAdapterFactory
{
  /////////////////////////////////////////////////////
  ///             STORAGE - START                   ///
  /////////////////////////////////////////////////////
  /**
   * @dev DO NOT CHANGE THE ORDER OF THESE VARIABLES ONCE DEPLOYED
   */

  /// @notice reference to the protection pool cycle manager
  IProtectionPoolCycleManager private protectionPoolCycleManager;

  /// @notice reference to the default state manager
  IDefaultStateManager private defaultStateManager;

  /// @notice list of all protection pools created by this factory
  address[] private protectionPools;

  /// @notice list of all reference lending pools created by this factory
  address[] private referenceLendingPoolsList;

  /// @notice the mapping of the lending pool protocol to the lending protocol adapter
  /// i.e Goldfinch => GoldfinchAdapter
  mapping(LendingProtocol => ILendingProtocolAdapter)
    private lendingProtocolAdapters;

  //////////////////////////////////////////////////////
  ///             STORAGE - END                     ///
  /////////////////////////////////////////////////////

  /*** events ***/

  /// @notice Emitted when a new protection pool is created.
  event ProtectionPoolCreated(
    address poolAddress,
    uint256 floor,
    uint256 ceiling,
    IERC20MetadataUpgradeable underlyingToken,
    IReferenceLendingPools referenceLendingPools,
    IPremiumCalculator premiumCalculator
  );

  /// @notice Emitted when a new reference lending pools is created.
  event ReferenceLendingPoolsCreated(address referenceLendingPools);

  /// @notice Emitted when a new lending protocol adapter is created.
  event LendingProtocolAdapterCreated(
    LendingProtocol indexed lendingProtocol,
    address lendingProtocolAdapter
  );

  /** errors */

  error LendingProtocolAdapterAlreadyAdded(LendingProtocol protocol);

  /*** initializer ***/

  function initialize(
    IProtectionPoolCycleManager _protectionPoolCycleManager,
    IDefaultStateManager _defaultStateManager
  ) external initializer {
    /// initialize the UUPSUpgradeableBase contract
    __UUPSUpgradeableBase_init();

    protectionPoolCycleManager = _protectionPoolCycleManager;
    defaultStateManager = _defaultStateManager;
  }

  /*** state-changing functions ***/

  /**
   * @notice Creates a new upgradable {IProtectionPool} instance using ERC1967 proxy.
   * @dev Needs to be called by the owner of the factory contract.
   * @dev This function is marked as payable for gas optimization.
   * @param _poolImpl An address of a ProtectionPool implementation.
   * @param _poolParameters struct containing pool related parameters.
   * @param _underlyingToken an address of an underlying token
   * @param _referenceLendingPools an address of the ReferenceLendingPools contract
   * @param _premiumCalculator an address of a PremiumCalculator contract
   * @param _name a name of the sToken
   * @param _symbol a symbol of the sToken
   */
  function createProtectionPool(
    address _poolImpl,
    ProtectionPoolParams calldata _poolParameters,
    ProtectionPoolCycleParams calldata _poolCycleParams,
    IERC20MetadataUpgradeable _underlyingToken,
    IReferenceLendingPools _referenceLendingPools,
    IPremiumCalculator _premiumCalculator,
    string calldata _name,
    string calldata _symbol
  ) external payable onlyOwner {
    /// Create a proxy contract for the protection pool using specified implementation.
    /// This newly created proxy is upgradable using UUPS pattern
    ERC1967Proxy _poolProxy = new ERC1967Proxy(
      _poolImpl,
      abi.encodeWithSelector(
        IProtectionPool(address(0)).initialize.selector,
        _msgSender(),
        ProtectionPoolInfo({
          params: _poolParameters,
          underlyingToken: _underlyingToken,
          referenceLendingPools: _referenceLendingPools,
          currentPhase: ProtectionPoolPhase.OpenToSellers
        }),
        _premiumCalculator,
        protectionPoolCycleManager,
        defaultStateManager,
        _name,
        _symbol
      )
    );

    /// Add the newly created protection pool to the list of all pools
    address _poolProxyAddress = address(_poolProxy);
    protectionPools.push(_poolProxyAddress);

    /// register newly created protection pool to the pool cycle manager
    protectionPoolCycleManager.registerProtectionPool(
      _poolProxyAddress,
      _poolCycleParams
    );

    /// register newly created protection pool to the default state manager
    defaultStateManager.registerProtectionPool(_poolProxyAddress);

    emit ProtectionPoolCreated(
      _poolProxyAddress,
      _poolParameters.leverageRatioFloor,
      _poolParameters.leverageRatioCeiling,
      _underlyingToken,
      _referenceLendingPools,
      _premiumCalculator
    );
  }

  /**
   * @notice Creates a new upgradable {IReferenceLendingPools} instance using ERC1967 proxy.
   * @dev Needs to be called by the owner of the factory contract.
   * @dev This function is marked as payable for gas optimization.
   * @param _referenceLendingPoolsImplementation the address of the implementation of the {IReferenceLendingPools} contract
   * @param _lendingPools the addresses of the lending pools which will be added to the basket
   * @param _lendingPoolProtocols the corresponding protocols of the lending pools which will be added to the basket
   * @param _protectionPurchaseLimitsInDays the corresponding protection purchase limits(in days) of the lending pools,
   * which will be added to the basket
   * @param _lendingProtocolAdapterFactory the address of the {LendingProtocolAdapterFactory} contract
   */
  function createReferenceLendingPools(
    address _referenceLendingPoolsImplementation,
    address[] calldata _lendingPools,
    LendingProtocol[] calldata _lendingPoolProtocols,
    uint256[] calldata _protectionPurchaseLimitsInDays,
    address _lendingProtocolAdapterFactory
  ) external payable onlyOwner {
    /// Create a ERC1967 proxy contract for the reference lending pools using specified implementation address.
    /// This instance of reference lending pools is upgradable using UUPS pattern
    ERC1967Proxy _referenceLendingPools = new ERC1967Proxy(
      _referenceLendingPoolsImplementation,
      abi.encodeWithSelector(
        IReferenceLendingPools(address(0)).initialize.selector,
        _msgSender(),
        _lendingPools,
        _lendingPoolProtocols,
        _protectionPurchaseLimitsInDays,
        _lendingProtocolAdapterFactory
      )
    );

    /// add the newly created reference lending pools to the list of reference lending pools
    address _referenceLendingPoolsAddress = address(_referenceLendingPools);
    referenceLendingPoolsList.push(_referenceLendingPoolsAddress);
    emit ReferenceLendingPoolsCreated(_referenceLendingPoolsAddress);
  }

  /**
   * @notice Creates a new upgradable {ILendingProtocolAdapter} instance using ERC1967 proxy, if it doesn't exist.
   * If it already exists, transaction is reverted.
   * @dev Needs to be called by the owner of the factory contract.
   * @dev This function is marked as payable for gas optimization.
   * @param _lendingProtocol the lending protocol
   * @param _lendingProtocolAdapterImplementation the lending protocol adapter implementation
   * @param _lendingProtocolAdapterInitData Encoded function call to initialize the lending protocol adapter
   */
  function createLendingProtocolAdapter(
    LendingProtocol _lendingProtocol,
    address _lendingProtocolAdapterImplementation,
    bytes memory _lendingProtocolAdapterInitData
  ) external payable onlyOwner {
    _createLendingProtocolAdapter(
      _lendingProtocol,
      _lendingProtocolAdapterImplementation,
      _lendingProtocolAdapterInitData
    );
  }

  /*** view functions ***/

  /**
   * @notice Returns all protection pools created by this factory.
   */
  function getProtectionPools() external view returns (address[] memory) {
    return protectionPools;
  }

  /**
   * @notice Returns the list of reference lending pools created by the factory.
   */
  function getReferenceLendingPoolsList()
    external
    view
    returns (address[] memory)
  {
    return referenceLendingPoolsList;
  }

  /// @inheritdoc ILendingProtocolAdapterFactory
  function getLendingProtocolAdapter(LendingProtocol _lendingProtocol)
    external
    view
    returns (ILendingProtocolAdapter)
  {
    return lendingProtocolAdapters[_lendingProtocol];
  }

  /*** internal functions ***/

  /**
   * @notice Creates a new upgradable {ILendingProtocolAdapter} instance using ERC1967 proxy, if it doesn't exist.
   * If it already exists, transaction is reverted.
   * @param _lendingProtocol the lending protocol
   * @param _lendingProtocolAdapterImplementation the lending protocol adapter implementation
   * @param _lendingProtocolAdapterInitData Encoded function call to initialize the created lending protocol adapter
   */
  function _createLendingProtocolAdapter(
    LendingProtocol _lendingProtocol,
    address _lendingProtocolAdapterImplementation,
    bytes memory _lendingProtocolAdapterInitData
  ) internal {
    /// Verify that the lending protocol adapter doesn't exist
    if (
      address(lendingProtocolAdapters[_lendingProtocol]) ==
      Constants.ZERO_ADDRESS
    ) {
      /// Create a ERC1967 proxy contract for the lending protocol adapter using specified implementation address.
      address _lendingProtocolAdapterAddress = address(
        new ERC1967Proxy(
          _lendingProtocolAdapterImplementation,
          _lendingProtocolAdapterInitData
        )
      );

      /// add the newly created lending protocol adapter to the mapping of lending protocol adapters
      lendingProtocolAdapters[_lendingProtocol] = ILendingProtocolAdapter(
        _lendingProtocolAdapterAddress
      );

      emit LendingProtocolAdapterCreated(
        _lendingProtocol,
        _lendingProtocolAdapterAddress
      );
    } else {
      revert LendingProtocolAdapterAlreadyAdded(_lendingProtocol);
    }
  }
}
