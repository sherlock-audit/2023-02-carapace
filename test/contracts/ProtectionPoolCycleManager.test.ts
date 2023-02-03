import { BigNumber } from "@ethersproject/bignumber";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { assert } from "console";
import { Signer } from "ethers";
import { ethers, upgrades } from "hardhat";
import { ProtectionPoolCycleManager } from "../../typechain-types/contracts/core/ProtectionPoolCycleManager";
import { ProtectionPoolCycleParamsStruct } from "../../typechain-types/contracts/interfaces/IProtectionPoolCycleManager";
import { ProtectionPoolCycleManagerV2 } from "../../typechain-types/contracts/test/ProtectionPoolCycleManagerV2";
import { ZERO_ADDRESS } from "../utils/constants";
import { getDaysInSeconds, moveForwardTime } from "../utils/time";

const testProtectionPoolCycleManager: Function = (
  deployer: Signer,
  account1: Signer,
  protectionPoolCycleManager: ProtectionPoolCycleManager,
  contractFactoryAddress: string
) => {
  describe("ProtectionPoolCycleManager", () => {
    const _poolAddress: string = "0x395326f1418F65F581693de55719c824ad48A367";
    const _secondPoolAddress: string =
      "0x7dA5E231478d5F5ACB45DBC122DE7846b676F715";
    const _openCycleDuration = getDaysInSeconds(7);
    const _cycleDuration = getDaysInSeconds(30);
    const _poolCycleParams: ProtectionPoolCycleParamsStruct = {
      openCycleDuration: _openCycleDuration,
      cycleDuration: _cycleDuration
    };
    describe("implementation", async () => {
      let poolCycleManagerImplementation: ProtectionPoolCycleManager;

      before(async () => {
        poolCycleManagerImplementation = (await ethers.getContractAt(
          "DefaultStateManager",
          await upgrades.erc1967.getImplementationAddress(
            protectionPoolCycleManager.address
          )
        )) as ProtectionPoolCycleManager;
      });

      it("...should NOT have an owner on construction", async () => {
        expect(await poolCycleManagerImplementation.owner()).to.equal(
          ZERO_ADDRESS
        );
      });

      it("...should disable initialize after construction", async () => {
        await expect(
          poolCycleManagerImplementation.initialize()
        ).to.be.revertedWith("Initializable: contract is already initialized");
      });
    });

    describe("constructor", async () => {
      it("...should be valid instance", async () => {
        expect(protectionPoolCycleManager).to.not.equal(undefined);
      });

      it("...should set deployer as on owner", async () => {
        expect(await protectionPoolCycleManager.owner()).to.equal(
          await deployer.getAddress()
        );
      });

      it("... should revert when initialize is called 2nd time", async () => {
        await expect(
          protectionPoolCycleManager.initialize()
        ).to.be.revertedWith("Initializable: contract is already initialized");
      });
    });

    describe("setContractFactory", async () => {
      it("...should fail when called by non-owner", async () => {
        await expect(
          protectionPoolCycleManager
            .connect(account1)
            .setContractFactory(ZERO_ADDRESS)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("...should fail when address is zeo", async () => {
        await expect(
          protectionPoolCycleManager
            .connect(deployer)
            .setContractFactory(ZERO_ADDRESS)
        ).to.be.revertedWith("ZeroContractFactoryAddress");
      });

      it("...should work correctly by owner", async () => {
        expect(
          await protectionPoolCycleManager.contractFactoryAddress()
        ).to.equal(contractFactoryAddress);

        // Set deployer as contract factory for tests
        await expect(
          protectionPoolCycleManager
            .connect(deployer)
            .setContractFactory(await deployer.getAddress())
        ).to.emit(protectionPoolCycleManager, "ContractFactoryUpdated");

        expect(
          await protectionPoolCycleManager.contractFactoryAddress()
        ).to.equal(await deployer.getAddress());
      });
    });

    describe("registerPool", async () => {
      it("...should NOT be callable by non-pool-factory address", async () => {
        await expect(
          protectionPoolCycleManager
            .connect(account1)
            .registerProtectionPool(_poolAddress, _poolCycleParams)
        ).to.be.revertedWith(
          `NotContractFactory("${await account1.getAddress()}")`
        );
      });

      it("...should be able callable by only pool factory contract", async () => {
        await expect(
          protectionPoolCycleManager
            .connect(deployer)
            .registerProtectionPool(_poolAddress, _poolCycleParams)
        )
          .to.emit(protectionPoolCycleManager, "ProtectionPoolCycleCreated")
          .withArgs(
            _poolAddress,
            0,
            anyValue,
            _poolCycleParams.openCycleDuration,
            _poolCycleParams.cycleDuration
          );
      });

      it("...should NOT be able to register pool twice", async () => {
        await expect(
          protectionPoolCycleManager
            .connect(deployer)
            .registerProtectionPool(_poolAddress, _poolCycleParams)
        ).to.be.revertedWith(`PoolAlreadyRegistered("${_poolAddress}")`);
      });

      it("...should NOT be able to register pool with openCycleDuration > cycleDuration", async () => {
        const _newCycleParams: ProtectionPoolCycleParamsStruct = {
          openCycleDuration: _openCycleDuration.add(
            _poolCycleParams.cycleDuration
          ),
          cycleDuration: _poolCycleParams.cycleDuration
        };
        await expect(
          protectionPoolCycleManager
            .connect(deployer)
            .registerProtectionPool(_secondPoolAddress, _newCycleParams)
        ).to.be.revertedWith(
          `InvalidCycleDuration(${_poolCycleParams.cycleDuration})`
        );
      });

      it("...should create new cycle for the pool with correct params", async () => {
        await protectionPoolCycleManager
          .connect(deployer)
          .registerProtectionPool(_secondPoolAddress, _poolCycleParams);

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

        const poolCycle = await protectionPoolCycleManager.getCurrentPoolCycle(
          _secondPoolAddress
        );
        expect(poolCycle.params.openCycleDuration).to.equal(
          _poolCycleParams.openCycleDuration
        );
        expect(poolCycle.params.cycleDuration).to.equal(
          _poolCycleParams.cycleDuration
        );
        expect(poolCycle.currentCycleStartTime).to.equal(
          (await ethers.provider.getBlock("latest")).timestamp
        );
      });

      it("...should be able to register multiple pools", async () => {
        // register 3rd pool
        const thirdPoolAddress: string =
          "0xa13c4F4bAea32D953813147FdBB3799CDaB5F641";
        const thirdOpenCycleDuration: BigNumber = BigNumber.from(
          2 * 24 * 60 * 60
        );
        const thirdCycleDuration: BigNumber = BigNumber.from(12 * 24 * 60 * 60);
        const thirdPoolCycleParams: ProtectionPoolCycleParamsStruct = {
          openCycleDuration: thirdOpenCycleDuration,
          cycleDuration: thirdCycleDuration
        };
        await protectionPoolCycleManager
          .connect(deployer)
          .registerProtectionPool(thirdPoolAddress, thirdPoolCycleParams);

        expect(
          await protectionPoolCycleManager.getCurrentCycleIndex(
            thirdPoolAddress
          )
        ).to.equal(0);
        expect(
          await protectionPoolCycleManager.getCurrentCycleState(
            thirdPoolAddress
          )
        ).to.equal(1); // 1 = Open

        const thirdPoolCycle =
          await protectionPoolCycleManager.getCurrentPoolCycle(
            thirdPoolAddress
          );
        expect(thirdPoolCycle.params.openCycleDuration).to.equal(
          thirdOpenCycleDuration
        );
        expect(thirdPoolCycle.params.cycleDuration).to.equal(
          thirdCycleDuration
        );
        expect(thirdPoolCycle.currentCycleStartTime).to.equal(
          (await ethers.provider.getBlock("latest")).timestamp
        );

        // register 4th pool
        const fourthPoolAddress: string =
          "0x3d7b7F12eDB3A0A2b9e9efc3EfD25c7455677746";
        const fourthOpenCycleDuration: BigNumber = BigNumber.from(
          5 * 24 * 60 * 60
        );
        const fourthCycleDuration: BigNumber = BigNumber.from(
          15 * 24 * 60 * 60
        );
        await protectionPoolCycleManager
          .connect(deployer)
          .registerProtectionPool(fourthPoolAddress, {
            openCycleDuration: fourthOpenCycleDuration,
            cycleDuration: fourthCycleDuration
          });

        expect(
          await protectionPoolCycleManager.getCurrentCycleIndex(
            fourthPoolAddress
          )
        ).to.equal(0);
        expect(
          await protectionPoolCycleManager.getCurrentCycleState(
            fourthPoolAddress
          )
        ).to.equal(1); // 1 = Open

        const fourthPoolCycle =
          await protectionPoolCycleManager.getCurrentPoolCycle(
            fourthPoolAddress
          );
        expect(fourthPoolCycle.params.openCycleDuration).to.equal(
          fourthOpenCycleDuration
        );
        expect(fourthPoolCycle.params.cycleDuration).to.equal(
          fourthCycleDuration
        );
        expect(fourthPoolCycle.currentCycleStartTime).to.equal(
          (await ethers.provider.getBlock("latest")).timestamp
        );
      });
    });

    describe("calculateAndSetPoolCycleState", async () => {
      let cycleStartTime: BigNumber;
      before(async () => {
        cycleStartTime = (
          await protectionPoolCycleManager.getCurrentPoolCycle(
            _secondPoolAddress
          )
        ).currentCycleStartTime;
      });

      it("...should have 'None' state for non-registered pool", async () => {
        expect(
          await protectionPoolCycleManager.getCurrentCycleState(
            "0x9E775D89857E9ff1e76923fB45e296d3bf43b31f"
          )
        ).to.equal(0); // 0 = None
      });

      it("...should stay in 'Open' state when less time than openCycleDuration has passed", async () => {
        expect(
          await protectionPoolCycleManager.getCurrentCycleState(
            _secondPoolAddress
          )
        ).to.equal(1); // 1 = Open

        // Move time forward by openCycleDuration - 30 seconds
        await moveForwardTime(_openCycleDuration.sub(30));

        // Verify current time is less than cycleStartTime + openCycleDuration
        const currentTime = BigNumber.from(
          (await ethers.provider.getBlock("latest")).timestamp
        );
        assert(currentTime < cycleStartTime.add(_openCycleDuration));

        await protectionPoolCycleManager.calculateAndSetPoolCycleState(
          _secondPoolAddress
        );

        expect(
          await protectionPoolCycleManager.getCurrentCycleState(
            _secondPoolAddress
          )
        ).to.equal(1); // 1 = Open
        expect(
          await protectionPoolCycleManager.getCurrentCycleIndex(
            _secondPoolAddress
          )
        ).to.equal(0);
      });

      it("...should move to 'Locked' state after openCycleDuration has passed", async () => {
        expect(
          await protectionPoolCycleManager.getCurrentCycleState(
            _secondPoolAddress
          )
        ).to.equal(1); // 1 = Open

        // Move time forward by time left in openCycleDuration
        await moveForwardTime(BigNumber.from(30));

        // Verify current time is greater than cycleStartTime + openCycleDuration
        const currentTime = BigNumber.from(
          (await ethers.provider.getBlock("latest")).timestamp
        );
        assert(currentTime > cycleStartTime.add(_openCycleDuration));

        await protectionPoolCycleManager.calculateAndSetPoolCycleState(
          _secondPoolAddress
        );

        expect(
          await protectionPoolCycleManager.getCurrentCycleState(
            _secondPoolAddress
          )
        ).to.equal(2); // 2 = Locked
        expect(
          await protectionPoolCycleManager.getCurrentCycleIndex(
            _secondPoolAddress
          )
        ).to.equal(0);
      });

      it("...should stay in 'Locked' state when less time than cycleDuration has passed", async () => {
        expect(
          await protectionPoolCycleManager.getCurrentCycleState(
            _secondPoolAddress
          )
        ).to.equal(2); // 2 = Locked

        // Move time forward by cycleDuration - 30 seconds
        const lessThanCycleDuration = _cycleDuration
          .sub(_openCycleDuration)
          .sub(30);
        await moveForwardTime(lessThanCycleDuration);

        // Verify current time is less than cycleStartTime + cycleDuration
        const currentTime = BigNumber.from(
          (await ethers.provider.getBlock("latest")).timestamp
        );
        assert(currentTime < cycleStartTime.add(_cycleDuration));

        await protectionPoolCycleManager.calculateAndSetPoolCycleState(
          _secondPoolAddress
        );

        expect(
          await protectionPoolCycleManager.getCurrentCycleState(
            _secondPoolAddress
          )
        ).to.equal(2); // 2 = Locked
        expect(
          await protectionPoolCycleManager.getCurrentCycleIndex(
            _secondPoolAddress
          )
        ).to.equal(0);
      });

      it("...should create new cycle with 'Open' state after cycleDuration has passed", async () => {
        expect(
          await protectionPoolCycleManager.getCurrentCycleState(
            _secondPoolAddress
          )
        ).to.equal(2); // 2 = Locked

        // Move time forward by time left in cycle
        await moveForwardTime(BigNumber.from(30));

        await protectionPoolCycleManager.calculateAndSetPoolCycleState(
          _secondPoolAddress
        );

        // Verify current time is greater than cycleStartTime + cycleDuration
        const currentTime = BigNumber.from(
          (await ethers.provider.getBlock("latest")).timestamp
        );
        assert(currentTime > cycleStartTime.add(_cycleDuration));

        expect(
          await protectionPoolCycleManager.getCurrentCycleState(
            _secondPoolAddress
          )
        ).to.equal(1); // 1 = Open
        expect(
          await protectionPoolCycleManager.getCurrentCycleIndex(
            _secondPoolAddress
          )
        ).to.equal(1);
      });
    });

    describe("upgrade", () => {
      let upgradedPoolCycleManager: ProtectionPoolCycleManagerV2;

      it("... should revert when upgradeTo is called by non-owner", async () => {
        await expect(
          protectionPoolCycleManager
            .connect(account1)
            .upgradeTo("0xA18173d6cf19e4Cc5a7F63780Fe4738b12E8b781")
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("... should fail upon invalid upgrade", async () => {
        try {
          await upgrades.validateUpgrade(
            protectionPoolCycleManager.address,
            await ethers.getContractFactory(
              "ProtectionPoolCycleManagerV2NotUpgradable"
            ),
            {
              kind: "uups"
            }
          );
        } catch (e: any) {
          expect(e.message).includes(
            "Contract `contracts/test/ProtectionPoolCycleManagerV2.sol:ProtectionPoolCycleManagerV2NotUpgradable` is not upgrade safe"
          );
        }
      });

      it("... should upgrade successfully", async () => {
        const poolCycleManagerV2Factory = await ethers.getContractFactory(
          "ProtectionPoolCycleManagerV2"
        );

        // upgrade to v2
        upgradedPoolCycleManager = (await upgrades.upgradeProxy(
          protectionPoolCycleManager.address,
          poolCycleManagerV2Factory
        )) as ProtectionPoolCycleManagerV2;
      });

      it("... should have same address after upgrade", async () => {
        expect(upgradedPoolCycleManager.address).to.be.equal(
          protectionPoolCycleManager.address
        );
      });

      it("... should be able to call new function in v2", async () => {
        const value = await upgradedPoolCycleManager.getVersion();
        expect(value).to.equal("v2");
      });

      it("... should be able to call existing function in v1", async () => {
        await upgradedPoolCycleManager.calculateAndSetPoolCycleState(
          _poolAddress
        );
      });
    });

    after(async () => {
      protectionPoolCycleManager
        .connect(deployer)
        .setContractFactory(contractFactoryAddress);
    });
  });
};

export { testProtectionPoolCycleManager };
