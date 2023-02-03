import { ContractFactory, Signer, Contract } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers, upgrades } from "hardhat";
import { USDC_ADDRESS } from "../test/utils/constants";
import { ProtectionPool } from "../typechain-types/contracts/core/pool/ProtectionPool";
import { ProtectionPoolParamsStruct } from "../typechain-types/contracts/interfaces/IProtectionPool";
import { ProtectionPoolCycleParamsStruct } from "../typechain-types/contracts/interfaces/IProtectionPoolCycleManager";
import { ContractFactory as CPContractFactory } from "../typechain-types/contracts/core/ContractFactory";
import { PremiumCalculator } from "../typechain-types/contracts/core/PremiumCalculator";
import { ReferenceLendingPools } from "../typechain-types/contracts/core/pool/ReferenceLendingPools";
import { ProtectionPoolCycleManager } from "../typechain-types/contracts/core/ProtectionPoolCycleManager";
import { AccruedPremiumCalculator } from "../typechain-types/contracts/libraries/AccruedPremiumCalculator";
import { RiskFactorCalculator } from "../typechain-types/contracts/libraries/RiskFactorCalculator";
import { GoldfinchAdapter } from "../typechain-types/contracts/adapters/GoldfinchAdapter";
import { DefaultStateManager } from "../typechain-types/contracts/core/DefaultStateManager";

import { parseUSDC } from "../test/utils/usdc";
import { getDaysInSeconds } from "../test/utils/time";

let deployer: Signer;
let account1: Signer;
let account2: Signer;
let account3: Signer;
let account4: Signer;

let protectionPoolImplementation: ProtectionPool;
let protectionPoolInstance: ProtectionPool;
let cpContractFactoryInstance: CPContractFactory;
let premiumCalculatorInstance: PremiumCalculator;
let referenceLendingPoolsInstance: ReferenceLendingPools;
let protectionPoolCycleManagerInstance: ProtectionPoolCycleManager;
let accruedPremiumCalculatorInstance: AccruedPremiumCalculator;
let riskFactorCalculatorInstance: RiskFactorCalculator;
let goldfinchAdapterImplementation: GoldfinchAdapter;
let goldfinchAdapterInstance: GoldfinchAdapter;
let referenceLendingPoolsImplementation: ReferenceLendingPools;
let defaultStateManagerInstance: DefaultStateManager;
let protectionPoolHelperInstance: Contract;

const GOLDFINCH_LENDING_POOLS = [
  "0xb26b42dd5771689d0a7faeea32825ff9710b9c11",
  "0xd09a57127bc40d680be7cb061c2a6629fe71abef"
];

(async () => {
  [deployer, account1, account2, account3, account4] =
    await ethers.getSigners();
  console.log("Deployer address: ", await deployer.getAddress());
})().catch((err) => {
  console.error(err);
});

const contractFactory: Function = async (
  contractName: string,
  libraries: any,
  deployerAccount: Signer = deployer
) => {
  const _contractFactory: ContractFactory = await ethers.getContractFactory(
    contractName,
    { signer: deployerAccount, libraries }
  );
  console.log("Deploying " + contractName + "...");
  return _contractFactory;
};

const deployContracts: Function = async () => {
  try {
    // Deploy RiskFactorCalculator library
    const riskFactorCalculatorFactory = await contractFactory(
      "RiskFactorCalculator"
    );
    riskFactorCalculatorInstance = await riskFactorCalculatorFactory.deploy();
    await riskFactorCalculatorInstance.deployed();
    console.log(
      "RiskFactorCalculator deployed to:",
      riskFactorCalculatorInstance.address
    );

    // Deploy AccruedPremiumCalculator library
    const riskFactorLibRef = {
      RiskFactorCalculator: riskFactorCalculatorInstance.address
    };
    const AccruedPremiumCalculator = await contractFactory(
      "AccruedPremiumCalculator",
      riskFactorLibRef
    );
    accruedPremiumCalculatorInstance = await AccruedPremiumCalculator.deploy();
    await accruedPremiumCalculatorInstance.deployed();
    console.log(
      "AccruedPremiumCalculator deployed to:",
      accruedPremiumCalculatorInstance.address
    );

    // Deploy PremiumCalculator contract
    const premiumCalculatorFactory = await contractFactory(
      "PremiumCalculator",
      riskFactorLibRef
    );

    // unsafeAllowLinkedLibraries needs to be set to true for the contract to be deployed
    // More details: https://docs.openzeppelin.com/upgrades-plugins/1.x/faq#why-cant-i-use-external-libraries
    // https://forum.openzeppelin.com/t/upgrade-safe-libraries/13832/2
    premiumCalculatorInstance = (await upgrades.deployProxy(
      premiumCalculatorFactory,
      {
        unsafeAllowLinkedLibraries: true
      }
    )) as PremiumCalculator;
    await premiumCalculatorInstance.deployed();
    console.log(
      "PremiumCalculator deployed to:",
      premiumCalculatorInstance.address
    );

    // Deploy a proxy to ProtectionPoolCycleManager contract
    const protectionPoolCycleManagerFactory = await contractFactory(
      "ProtectionPoolCycleManager"
    );
    protectionPoolCycleManagerInstance = (await upgrades.deployProxy(
      protectionPoolCycleManagerFactory
    )) as ProtectionPoolCycleManager;
    await protectionPoolCycleManagerInstance.deployed();
    console.log(
      "ProtectionPoolCycleManager is deployed to: ",
      protectionPoolCycleManagerInstance.address
    );

    // Deploy a proxy to DefaultStateManager contract
    const defaultStateManagerFactory = await contractFactory(
      "DefaultStateManager"
    );
    defaultStateManagerInstance = (await upgrades.deployProxy(
      defaultStateManagerFactory
    )) as DefaultStateManager;
    await defaultStateManagerInstance.deployed();
    console.log(
      "DefaultStateManager is deployed to: ",
      defaultStateManagerInstance.address
    );

    // Deploy ProtectionPoolHelper library contract
    const protectionPoolHelperFactory = await contractFactory(
      "ProtectionPoolHelper",
      {
        AccruedPremiumCalculator: accruedPremiumCalculatorInstance.address
      }
    );
    protectionPoolHelperInstance = await protectionPoolHelperFactory.deploy();
    await protectionPoolHelperInstance.deployed();
    console.log(
      "ProtectionPoolHelper lib is deployed to:",
      protectionPoolHelperInstance.address
    );

    // Deploy a proxy to ContractFactory contract
    const _cpContractFactoryFactory = await contractFactory("ContractFactory");
    cpContractFactoryInstance = (await upgrades.deployProxy(
      _cpContractFactoryFactory,
      [
        protectionPoolCycleManagerInstance.address,
        defaultStateManagerInstance.address
      ]
    )) as CPContractFactory;
    await cpContractFactoryInstance.deployed();
    console.log(
      "ContractFactory is deployed to: ",
      cpContractFactoryInstance.address
    );

    /// Sets pool factory address into the ProtectionPoolCycleManager & DefaultStateManager
    /// This is required to enable the ProtectionPoolCycleManager & DefaultStateManager to register a new pool when it is created
    /// "setPoolFactory" must be called by the owner
    await protectionPoolCycleManagerInstance
      .connect(deployer)
      .setContractFactory(cpContractFactoryInstance.address);
    await defaultStateManagerInstance
      .connect(deployer)
      .setContractFactory(cpContractFactoryInstance.address);

    // Deploy GoldfinchAdapter implementation contract
    const goldfinchAdapterFactory = await contractFactory("GoldfinchAdapter");
    goldfinchAdapterImplementation = await goldfinchAdapterFactory.deploy();
    await goldfinchAdapterImplementation.deployed();
    console.log(
      "GoldfinchAdapter implementation is deployed to:",
      goldfinchAdapterImplementation.address
    );

    // Create an upgradable instance of GoldfinchAdapter
    await cpContractFactoryInstance.createLendingProtocolAdapter(
      0, // Goldfinch
      goldfinchAdapterImplementation.address,
      goldfinchAdapterImplementation.interface.encodeFunctionData(
        "initialize",
        [await deployer.getAddress()]
      )
    );

    // Retrieve an instance of GoldfinchAdapter from the LendingProtocolAdapterFactory
    goldfinchAdapterInstance = (await ethers.getContractAt(
      "GoldfinchAdapter",
      await cpContractFactoryInstance.getLendingProtocolAdapter(0)
    )) as GoldfinchAdapter;

    console.log(
      "GoldfinchAdapter is deployed at: ",
      goldfinchAdapterInstance.address
    );

    // Deploy ReferenceLendingPools Implementation contract
    const referenceLendingPoolsFactory = await contractFactory(
      "ReferenceLendingPools"
    );
    referenceLendingPoolsImplementation =
      await referenceLendingPoolsFactory.deploy();
    await referenceLendingPoolsImplementation.deployed();
    console.log(
      "ReferenceLendingPools Implementation deployed to:",
      referenceLendingPoolsImplementation.address
    );

    // Create an instance of the ReferenceLendingPools
    const _lendingProtocols = [0, 0]; // 0 = Goldfinch
    const _purchaseLimitsInDays = [90, 60];
    await cpContractFactoryInstance.createReferenceLendingPools(
      referenceLendingPoolsImplementation.address,
      GOLDFINCH_LENDING_POOLS,
      _lendingProtocols,
      _purchaseLimitsInDays,
      cpContractFactoryInstance.address
    );
    referenceLendingPoolsInstance =
      await getLatestReferenceLendingPoolsInstance(cpContractFactoryInstance);

    // Deploy a ProtectionPool implementation contract
    const protectionPoolFactory = await getProtectionPoolContractFactory();
    protectionPoolImplementation = await protectionPoolFactory.deploy();
    await protectionPoolImplementation.deployed();
    console.log(
      "ProtectionPool implementation is deployed to: ",
      protectionPoolImplementation.address
    );

    // Create an instance of the ProtectionPool, which should be upgradable
    // Create a pool using PoolFactory instead of deploying new pool directly to mimic the prod behavior
    const _poolCycleParams: ProtectionPoolCycleParamsStruct = {
      openCycleDuration: getDaysInSeconds(10),
      cycleDuration: getDaysInSeconds(30)
    };

    const _poolParams: ProtectionPoolParamsStruct = {
      leverageRatioFloor: parseEther("0.5"),
      leverageRatioCeiling: parseEther("1"),
      leverageRatioBuffer: parseEther("0.05"),
      minRequiredCapital: parseUSDC("100000"), // 100k
      curvature: parseEther("0.05"),
      minCarapaceRiskPremiumPercent: parseEther("0.02"),
      underlyingRiskPremiumPercent: parseEther("0.1"),
      minProtectionDurationInSeconds: getDaysInSeconds(10),
      protectionRenewalGracePeriodInSeconds: getDaysInSeconds(14) // 2 weeks
    };

    await cpContractFactoryInstance.createProtectionPool(
      protectionPoolImplementation.address,
      _poolParams,
      _poolCycleParams,
      USDC_ADDRESS,
      referenceLendingPoolsInstance.address,
      premiumCalculatorInstance.address,
      "sToken11",
      "sT11"
    );

    protectionPoolInstance = await getLatestProtectionPoolInstance(
      cpContractFactoryInstance
    );
  } catch (e) {
    console.log(e);
  }
};

async function getLatestReferenceLendingPoolsInstance(
  cpContractFactory: CPContractFactory
): Promise<ReferenceLendingPools> {
  const referenceLendingPoolsList =
    await cpContractFactory.getReferenceLendingPoolsList();
  const newReferenceLendingPoolsInstance = (await ethers.getContractAt(
    "ReferenceLendingPools",
    referenceLendingPoolsList[referenceLendingPoolsList.length - 1]
  )) as ReferenceLendingPools;

  console.log(
    "ReferenceLendingPools instance created at: ",
    newReferenceLendingPoolsInstance.address
  );

  return newReferenceLendingPoolsInstance;
}

async function getLatestProtectionPoolInstance(
  contractFactoryInstance: CPContractFactory
): Promise<ProtectionPool> {
  const pools = await contractFactoryInstance.getProtectionPools();
  const newPoolInstance = (await ethers.getContractAt(
    "ProtectionPool",
    pools[pools.length - 1]
  )) as ProtectionPool;

  console.log(
    "Latest ProtectionPool instance is deployed at: ",
    newPoolInstance.address
  );
  return newPoolInstance;
}

async function getProtectionPoolContractFactory(
  contractName = "ProtectionPool"
) {
  return await contractFactory(contractName, {
    AccruedPremiumCalculator: accruedPremiumCalculatorInstance.address,
    ProtectionPoolHelper: protectionPoolHelperInstance.address
  });
}

export {
  deployer,
  account1,
  account2,
  account3,
  account4,
  deployContracts,
  protectionPoolImplementation,
  protectionPoolInstance,
  cpContractFactoryInstance,
  premiumCalculatorInstance,
  referenceLendingPoolsInstance, // This is the proxy instance cloned from implementation
  protectionPoolCycleManagerInstance,
  accruedPremiumCalculatorInstance,
  riskFactorCalculatorInstance,
  goldfinchAdapterImplementation,
  goldfinchAdapterInstance,
  referenceLendingPoolsImplementation, // implementation contract which is used to create proxy contract
  defaultStateManagerInstance,
  GOLDFINCH_LENDING_POOLS,
  getLatestReferenceLendingPoolsInstance,
  getLatestProtectionPoolInstance,
  getProtectionPoolContractFactory
};
