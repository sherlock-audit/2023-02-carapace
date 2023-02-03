// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {LendingProtocol, ILendingProtocolAdapter} from "../interfaces/ILendingProtocolAdapter.sol";

/// @notice Interface for ContractFactory contract to expose the {ILendingProtocolAdapter} instances
interface ILendingProtocolAdapterFactory {
  /**
   * @notice Returns the {ILendingProtocolAdapter} instance for the given lending protocol.
   * This function will return zero address if the lending protocol is not supported.
   * @param _lendingProtocol the lending protocol
   * @return _lendingProtocolAdapter the {ILendingProtocolAdapter} instance
   */
  function getLendingProtocolAdapter(LendingProtocol _lendingProtocol)
    external
    view
    returns (ILendingProtocolAdapter);
}
