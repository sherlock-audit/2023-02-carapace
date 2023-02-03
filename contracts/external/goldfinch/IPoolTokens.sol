// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import {IERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";

/**
 * @dev Goldfinch ERC721 compliant token interface to represent junior tranche or senior tranche shares of any of the borrower pools.
 * Copied from: https://github.com/goldfinch-eng/mono/blob/332cb7041441be1340ff77be9ec5bfb9ab2e804d/packages/protocol/contracts/interfaces/IPoolTokens.sol
 * Changes:
 *  1. Updated compiler version to match the rest of the project
 *  2. Removed "pragma experimental ABIEncoderV2"
 *  3. Updated ERC721 interface import to use upgradeable version
 *  4. Removed all unused structs/events/functions

 * Mainnet: https://etherscan.io/address/0x57686612C601Cb5213b01AA8e80AfEb24BBd01df
 */
interface IPoolTokens is IERC721Upgradeable {
  struct TokenInfo {
    address pool;
    uint256 tranche;
    uint256 principalAmount;
    uint256 principalRedeemed;
    uint256 interestRedeemed;
  }

  function getTokenInfo(uint256 tokenId)
    external
    view
    returns (TokenInfo memory);
}
