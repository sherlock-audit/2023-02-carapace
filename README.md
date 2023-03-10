# Carapace contest details

- Join [Sherlock Discord](https://discord.gg/MABEWyASkp)
- Submit findings using the issue page in your private contest repo (label issues as med or high)
- [Read for more details](https://docs.sherlock.xyz/audits/watsons)

# About Carapace

Carapace connects buyers and sellers of protections against default risk for under-collateralized loans in DeFi.
In this version, Carapace protocol supports only Goldfinch as a lending protocol.

Following are links to the Carapace whitepaper and documentation:

- Whitepaper: https://www.carapace.finance/WhitePaper
- User Docs: https://www.carapace.finance/docs/
- Carapace Complementary Docs: https://docs.google.com/document/d/1qK-Lf8rwnns55lHgicB5flwcoFrepbXL14AwWSaqhNw
- Carapace Smart Contracts Overview: https://docs.google.com/document/d/1RihHcf-jS45BorVufVm4aYdXdQ65CaOxtW6ljz8DCOs

# Carapace Audit Commit

Commit [e69045a](https://github.com/carapace-finance/credit-default-swaps-contracts/commit/e69045a1a721c4a18e8911bfba9edb6bb55bf562) is the frozen commit for the audit.

# Running Tests

Join the contest and see `README-carapace.md` for details on how to setup local development environment and run tests.
<br>
Test coverage report can be generated using `npm run cover` command.


# Audit scope

All contracts in `contracts` folder, excluding `test` folder.

./:

- UUPSUpgradeableBase.sol

./adapters:

- GoldfinchAdapter.sol : upgradeable using UUPS pattern

./core:

- ContractFactory.sol : upgradeable using UUPS pattern
- DefaultStateManager.sol : upgradeable using UUPS pattern
- PremiumCalculator.sol : upgradeable using UUPS pattern
- ProtectionPoolCycleManager.sol : upgradeable using UUPS pattern

./core/pool:

- **ProtectionPool.sol : This is core contract of the protocol and upgradeable using UUPS pattern**
- ReferenceLendingPools.sol : upgradeable using UUPS pattern
- **SToken.sol : ERC-20 compliant implementation of the interest bearing token for the Carapace protocol**

./external/goldfinch:

- ConfigOptions.sol
- ICreditLine.sol
- IGoldfinchConfig.sol
- IPoolTokens.sol
- ISeniorPool.sol
- ISeniorPoolStrategy.sol
- ITranchedPool.sol
- IV2CreditLine.sol

./external/openzeppelin/ERC1967:

- ERC1967Proxy.sol
- Proxy.sol

./interfaces:

- IDefaultStateManager.sol
- ILendingProtocolAdapter.sol
- ILendingProtocolAdapterFactory.sol
- IPremiumCalculator.sol
- IProtectionPool.sol
- IProtectionPoolCycleManager.sol
- IReferenceLendingPools.sol

./libraries:

- AccruedPremiumCalculator.sol
- Constants.sol
- ProtectionPoolHelper.sol
- RiskFactorCalculator.sol

# On-chain context

```
DEPLOYMENT: mainnet
ERC20: USDC, SToken (ERC-20 compliant Carapace Protection Pool Token to be used for sharing premium earned by the pool)
ERC721: Goldfinch PoolTokens, see: https://dev.goldfinch.finance/docs/reference/contracts/core/PoolTokens
ERC777: none
FEE-ON-TRANSFER: none
REBASING TOKENS: none
ADMIN: Trusted
EXTERNAL-ADMINS: n/a
```

## Smart contract ownership

In Carapace protocol, all contracts are deployed and owned by the protocol.
There are no user controlled admins. From trust perspective, there are only 2 types of users:

- Protocol Owner
- End Users

## Smart contracts with restricted functions

Following contracts have restricted functions, which are only callable by certain contracts:

- `DefaultStateManager.sol`

  - `registerProtectionPool` : only callable by `ContractFactory.sol`
  - `calculateAndClaimUnlockedCapital`: only callable by `ProtectionPool.sol`

    <br>

- `ProtectionPoolCycleManager.sol`

  - `registerProtectionPool`: only callable by `ContractFactory.sol`

    <br>

- `ProtectionPool.sol`

  - `lockCapital`: only callable by `DefaultStateManager.sol`

    <br>

## Smart contracts with owner controlled functions

Following contracts have owner controlled functions:

- `ProtectionPool.sol`
  - `pause`
  - `unpause`
  - `updateLeverageRatioParams`
  - `updateRiskPremiumParams`
  - `updateMinRequiredCapital`
  - `movePoolPhase`

<br>

- `ContractFactory.sol`
  - `createProtectionPool`
  - `createReferenceLendingPools`
  - `createLendingProtocolAdapter`

<br>

- `DefaultStateManager.sol`
  - `setContractFactory`

<br>

- `ProtectionPoolCycleManager.sol`
  - `setContractFactory`

<br>

- `ReferenceLendingPools.sol`
  - `addReferenceLendingPool`

<br>

## Operational/monitoring functions

Following contract functions will be called daily for operational & monitoring purposes:

- `ProtectionPool.accruePremiumAndExpireProtections`: This function is used to accrue premium and expire protections and will be called daily via a cron job or using OZ defender or similar service.

- `ProtectionPoolCycleManager.calculateAndSetPoolCycleState`: This function is used to calculate and set the pool cycle state and will be called daily via a cron job or using OZ defender or similar service.

- `DefaultStateManager.assessStates`: This function is used to assess the states of the protection pools and will be called daily via a cron job or using OZ defender or similar service.

<br>
