import { BigNumber } from "@ethersproject/bignumber";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { parseEther } from "ethers/lib/utils";
import { expect } from "chai";
import { Signer } from "ethers";
import { USDC_ADDRESS, ZERO_ADDRESS } from "../utils/constants";
import { ethers, upgrades } from "hardhat";
import { ProtectionPoolCycleManager } from "../../typechain-types/contracts/core/ProtectionPoolCycleManager";
import { ProtectionPoolParamsStruct } from "../../typechain-types/contracts/interfaces/IProtectionPool";
import { ProtectionPoolCycleParamsStruct } from "../../typechain-types/contracts/interfaces/IProtectionPoolCycleManager";
import { ProtectionPool } from "../../typechain-types/contracts/core/pool/ProtectionPool";
import { PremiumCalculator } from "../../typechain-types/contracts/core/PremiumCalculator";
import { ContractFactory } from "../../typechain-types/contracts/core/ContractFactory";
import { ReferenceLendingPools } from "../../typechain-types/contracts/core/pool/ReferenceLendingPools";
import { DefaultStateManager } from "../../typechain-types/contracts/core/DefaultStateManager";
import { parseUSDC } from "../utils/usdc";
import { getDaysInSeconds, getLatestBlockTimestamp } from "../utils/time";
import { ContractFactoryV2 } from "../../typechain-types/contracts/test/ContractFactoryV2";
const LENDING_POOL_1 = "0x759f097f3153f5d62ff1c2d82ba78b6350f223e3";

const testContractFactory: Function = (
  deployer: Signer,
  account1: Signer,
  cpContractFactory: ContractFactory,
  premiumCalculator: PremiumCalculator,
  referenceLendingPools: ReferenceLendingPools,
  protectionPoolCycleManager: ProtectionPoolCycleManager,
  defaultStateManager: DefaultStateManager,
  poolImplementation: ProtectionPool,
  referenceLendingPoolsImplementation: ReferenceLendingPools,
  getLatestReferenceLendingPoolsInstance: Function
) => {
  describe("ContractFactory", () => {
    let _firstPoolAddress: string;
    let _secondPoolAddress: string;

    before(async () => {
      _firstPoolAddress = (await cpContractFactory.getProtectionPools())[0];
    });

    describe("implementation", async () => {
      let cpContractFactoryImplementation: ContractFactory;

      before(async () => {
        cpContractFactoryImplementation = (await ethers.getContractAt(
          "ContractFactory",
          await upgrades.erc1967.getImplementationAddress(
            cpContractFactory.address
          )
        )) as ContractFactory;
      });

      it("...should NOT have an owner on construction", async () => {
        expect(await cpContractFactoryImplementation.owner()).to.equal(
          ZERO_ADDRESS
        );
      });

      it("...should disable initialize after construction", async () => {
        await expect(
          cpContractFactoryImplementation.initialize(ZERO_ADDRESS, ZERO_ADDRESS)
        ).to.be.revertedWith("Initializable: contract is already initialized");
      });
    });

    describe("constructor", () => {
      it("...should be valid instance", async () => {
        expect(cpContractFactory).to.not.equal(undefined);
      });

      it("...should set deployer as on owner", async () => {
        expect(await cpContractFactory.owner()).to.equal(
          await deployer.getAddress()
        );
      });

      it("... should revert when initialize is called 2nd time", async () => {
        await expect(
          cpContractFactory.initialize(ZERO_ADDRESS, ZERO_ADDRESS)
        ).to.be.revertedWith("Initializable: contract is already initialized");
      });
    });

    describe("createPool", async () => {
      const _poolCycleParams: ProtectionPoolCycleParamsStruct = {
        openCycleDuration: getDaysInSeconds(10), // 10 days
        cycleDuration: getDaysInSeconds(30) // 30 days
      };
      const _floor: BigNumber = BigNumber.from(100);
      const _ceiling: BigNumber = BigNumber.from(500);
      const _poolParams: ProtectionPoolParamsStruct = {
        leverageRatioFloor: _floor,
        leverageRatioCeiling: _ceiling,
        leverageRatioBuffer: BigNumber.from(5),
        minRequiredCapital: parseUSDC("10000"),
        curvature: BigNumber.from(5),
        minCarapaceRiskPremiumPercent: parseEther("0.02"),
        underlyingRiskPremiumPercent: parseEther("0.1"),
        minProtectionDurationInSeconds: getDaysInSeconds(10),
        protectionRenewalGracePeriodInSeconds: getDaysInSeconds(14) // 2 weeks
      };

      it("...only the owner should be able to call the createPool function", async () => {
        await expect(
          cpContractFactory
            .connect(account1)
            .createProtectionPool(
              poolImplementation.address,
              _poolParams,
              _poolCycleParams,
              USDC_ADDRESS,
              referenceLendingPools.address,
              premiumCalculator.address,
              "sToken11",
              "sT11",
              { gasLimit: 100000 }
            )
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("...should have started a new pool cycle for 1st pool created", async () => {
        expect(
          await protectionPoolCycleManager.getCurrentCycleIndex(
            _firstPoolAddress
          )
        ).to.equal(0);
        expect(
          await protectionPoolCycleManager.getCurrentCycleState(
            _firstPoolAddress
          )
        ).to.equal(1); // 1 = Open
      });

      it("...should revert when new pool is created with zero address by owner", async () => {
        await expect(
          cpContractFactory
            .connect(deployer)
            .createProtectionPool(
              ZERO_ADDRESS,
              _poolParams,
              _poolCycleParams,
              USDC_ADDRESS,
              referenceLendingPools.address,
              premiumCalculator.address,
              "sToken21",
              "sT21"
            )
        ).to.be.revertedWith("ERC1967: new implementation is not a contract");
      });

      // 1st pool is already created by deploy script
      it("...should create the second pool successfully", async () => {
        const expectedCycleStartTimestamp: BigNumber =
          (await getLatestBlockTimestamp()) + 1;

        await expect(
          cpContractFactory.createProtectionPool(
            poolImplementation.address,
            _poolParams,
            _poolCycleParams,
            USDC_ADDRESS,
            referenceLendingPools.address,
            premiumCalculator.address,
            "sToken21",
            "sT21"
          )
        )
          .to.emit(cpContractFactory, "PoolCreated")
          .withArgs(
            _secondPoolAddress,
            anyValue,
            _floor,
            _ceiling,
            USDC_ADDRESS,
            referenceLendingPools.address,
            premiumCalculator.address
          )
          .emit(cpContractFactory, "OwnershipTransferred")
          .withArgs(await account1.getAddress(), await deployer.getAddress())
          // Newly created pool should be registered to ProtectionPoolCycleManager
          .to.emit(protectionPoolCycleManager, "ProtectionPoolCycleCreated")
          .withArgs(
            _secondPoolAddress,
            0,
            expectedCycleStartTimestamp,
            _poolCycleParams.openCycleDuration,
            _poolCycleParams.cycleDuration
          )
          .emit(defaultStateManager, "ProtectionPoolRegistered");

        _secondPoolAddress = (await cpContractFactory.getProtectionPools())[1];
      });

      it("...should start new pool cycle for the second pool", async () => {
        expect(
          await protectionPoolCycleManager.getCurrentCycleIndex(
            _secondPoolAddress
          )
        ).to.equal(0);
        expect(
          await protectionPoolCycleManager.getCurrentCycleState(
            _secondPoolAddress
          )
        ).to.equal(1); // 1 = Open
        expect(
          (
            await protectionPoolCycleManager.getCurrentPoolCycle(
              _secondPoolAddress
            )
          ).currentCycleStartTime
        ).to.equal((await ethers.provider.getBlock("latest")).timestamp);
      });

      it("...should transfer pool's ownership to contractFactory's owner", async () => {
        const deployerAddress: string = await deployer.getAddress();
        expect(cpContractFactory)
          .to.emit(cpContractFactory, "OwnershipTransferred")
          .withArgs(cpContractFactory.address, deployerAddress);

        const secondPool: ProtectionPool = (await ethers.getContractAt(
          "ProtectionPool",
          _secondPoolAddress
        )) as ProtectionPool;
        expect(await secondPool.owner()).to.equal(deployerAddress);
      });
    });

    describe("createReferenceLendingPools", () => {
      it("...should revert when not called by owner", async () => {
        await expect(
          cpContractFactory
            .connect(account1)
            .createReferenceLendingPools(
              referenceLendingPoolsImplementation.address,
              [ZERO_ADDRESS],
              [0],
              [0],
              ZERO_ADDRESS
            )
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("...should revert when new reference lending pool is created with zero address by owner", async () => {
        await expect(
          cpContractFactory
            .connect(deployer)
            .createReferenceLendingPools(
              ZERO_ADDRESS,
              [ZERO_ADDRESS],
              [0],
              [0],
              ZERO_ADDRESS
            )
        ).to.be.revertedWith("ERC1967: new implementation is not a contract");
      });

      it("...should revert when lending pools and protocols array lengths are not equal", async () => {
        await expect(
          cpContractFactory.createReferenceLendingPools(
            referenceLendingPoolsImplementation.address,
            [ZERO_ADDRESS],
            [],
            [],
            ZERO_ADDRESS
          )
        ).to.be.revertedWith;
      });

      it("...should revert when lending protocols and purchase limit days array lengths are not equal", async () => {
        await expect(
          cpContractFactory.createReferenceLendingPools(
            referenceLendingPoolsImplementation.address,
            [ZERO_ADDRESS],
            [0],
            [10, 11],
            ZERO_ADDRESS
          )
        ).to.be.revertedWith;
      });

      it("...should create an instance of ReferenceLendingPools successfully", async () => {
        const _purchaseLimitInDays = 30;
        const tx = await cpContractFactory
          .connect(deployer)
          .createReferenceLendingPools(
            referenceLendingPoolsImplementation.address,
            [LENDING_POOL_1],
            [0],
            [_purchaseLimitInDays],
            cpContractFactory.address
          );
        const referenceLendingPoolsInstance =
          await getLatestReferenceLendingPoolsInstance(cpContractFactory);

        const lendingPoolInfo =
          await referenceLendingPoolsInstance.referenceLendingPools(
            LENDING_POOL_1
          );

        const _expectedLatestTimestamp = await getLatestBlockTimestamp();
        const _expectedPurchaseLimitTimestamp =
          _expectedLatestTimestamp +
          getDaysInSeconds(_purchaseLimitInDays).toNumber();

        expect(lendingPoolInfo.protocol).to.be.eq(0); // Goldfinch
        expect(lendingPoolInfo.addedTimestamp).to.be.eq(
          _expectedLatestTimestamp
        );
        expect(lendingPoolInfo.protectionPurchaseLimitTimestamp).to.be.eq(
          _expectedPurchaseLimitTimestamp
        );

        expect(await referenceLendingPoolsInstance.owner()).to.be.eq(
          await deployer.getAddress()
        );
      });
    });

    describe("createLendingProtocolAdapter", () => {
      before(async () => {
        await upgrades.erc1967.getImplementationAddress(
          cpContractFactory.address
        );
      });

      it("...should revert when not called by owner", async () => {
        await expect(
          cpContractFactory
            .connect(account1)
            .createLendingProtocolAdapter(0, ZERO_ADDRESS, [])
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("...should revert when new reference lending pool is created for existing protocol", async () => {
        await expect(
          cpContractFactory
            .connect(deployer)
            .createLendingProtocolAdapter(0, ZERO_ADDRESS, [])
        ).to.be.revertedWith("LendingProtocolAdapterAlreadyAdded(0)");
      });
    });

    describe("upgrade", () => {
      let upgradedContractFactory: ContractFactoryV2;

      it("... should revert when upgradeTo is called by non-owner", async () => {
        await expect(
          cpContractFactory
            .connect(account1)
            .upgradeTo("0xA18173d6cf19e4Cc5a7F63780Fe4738b12E8b781")
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("... should fail upon invalid upgrade", async () => {
        try {
          await upgrades.validateUpgrade(
            cpContractFactory.address,
            await ethers.getContractFactory("ContractFactoryNotUpgradable"),
            {
              kind: "uups"
            }
          );
        } catch (e: any) {
          expect(e.message).includes(
            "Contract `contracts/test/ContractFactoryV2.sol:ContractFactoryNotUpgradable` is not upgrade safe"
          );
        }
      });

      it("... should upgrade successfully", async () => {
        const cpContractFactoryV2Factory = await ethers.getContractFactory(
          "ContractFactoryV2"
        );

        // upgrade to v2
        upgradedContractFactory = (await upgrades.upgradeProxy(
          cpContractFactory.address,
          cpContractFactoryV2Factory
        )) as ContractFactoryV2;
      });

      it("... should have same address after upgrade", async () => {
        expect(upgradedContractFactory.address).to.be.equal(
          cpContractFactory.address
        );
      });

      it("... should be able to call new function in v2", async () => {
        const value = await upgradedContractFactory.getVersion();
        expect(value).to.equal("v2");
      });

      it("... should be able to call existing function in v1", async () => {
        expect(
          await upgradedContractFactory.getReferenceLendingPoolsList()
        ).to.have.lengthOf(2);
      });
    });
  });
};

export { testContractFactory };
