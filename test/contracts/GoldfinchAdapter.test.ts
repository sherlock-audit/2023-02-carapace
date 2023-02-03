import { expect } from "chai";
import { parseEther } from "ethers/lib/utils";
import { ContractFactory, Signer } from "ethers/lib/ethers";

import { GoldfinchAdapter } from "../../typechain-types/contracts/adapters/GoldfinchAdapter";
import { parseUSDC } from "../utils/usdc";
import { ITranchedPool } from "../../typechain-types/contracts/external/goldfinch/ITranchedPool";
import { ethers, network, upgrades } from "hardhat";
import { BigNumber } from "@ethersproject/bignumber";
import {
  getDaysInSeconds,
  getLatestBlockTimestamp,
  moveForwardTime,
  setNextBlockTimestamp
} from "../utils/time";
import { toBytes32, setStorageAt, getStorageAt } from "../utils/storage";
import { ZERO_ADDRESS } from "../utils/constants";
import { GoldfinchAdapterV2 } from "../../typechain-types/contracts/test/GoldfinchAdapterV2";

const GOLDFINCH_ALMAVEST_BASKET_6_ADDRESS =
  "0x418749e294cabce5a714efccc22a8aade6f9db57";
const BUYER3 = "0x10a590f528eff3d5de18c90da6e03a4acdde3a7d";

const testGoldfinchAdapter: Function = (
  deployer: Signer,
  account1: Signer,
  goldfinchAdapterImplementation: GoldfinchAdapter,
  goldfinchAdapter: GoldfinchAdapter
) => {
  describe("GoldfinchAdapter", () => {
    let _snapshotId: string;

    before(async () => {
      _snapshotId = await network.provider.send("evm_snapshot", []);
    });

    after(async () => {
      // Some specs move time forward, revert the state to the snapshot
      expect(await network.provider.send("evm_revert", [_snapshotId])).to.eq(
        true
      );
    });

    describe("implementation", async () => {
      it("...should NOT have an owner on construction", async () => {
        expect(await goldfinchAdapterImplementation.owner()).to.equal(
          ZERO_ADDRESS
        );
      });

      it("...should disable initialize after construction", async () => {
        await expect(
          goldfinchAdapterImplementation.initialize(ZERO_ADDRESS)
        ).to.be.revertedWith("Initializable: contract is already initialized");
      });

      it("...should be valid implementation", async () => {
        await upgrades.validateImplementation(
          await ethers.getContractFactory("GoldfinchAdapter"),
          {
            kind: "uups"
          }
        );
      });
    });

    describe("constructor", () => {
      it("...should set deployer as on owner", async () => {
        expect(await goldfinchAdapter.owner()).to.equal(
          await deployer.getAddress()
        );
      });

      it("... should revert when initialize is called 2nd time", async () => {
        await expect(
          goldfinchAdapter.initialize(ZERO_ADDRESS)
        ).to.be.revertedWith("Initializable: contract is already initialized");
      });
    });

    describe("isLendingPoolLate", () => {
      it("...should return false for a pool current payment", async () => {
        expect(
          await goldfinchAdapter.isLendingPoolLate(
            "0x759f097f3153f5d62ff1c2d82ba78b6350f223e3"
          )
        ).to.be.false;
      });

      it("...should return true for a pool with late payment", async () => {
        // see: https://app.goldfinch.finance/pools/0x00c27fc71b159a346e179b4a1608a0865e8a7470
        expect(
          await goldfinchAdapter.isLendingPoolLate(
            "0x00c27fc71b159a346e179b4a1608a0865e8a7470"
          )
        ).to.be.true;
      });
    });

    describe("isLendingPoolExpired", () => {
      it("...should return true for a pool with balance = 0", async () => {
        // see: https://app.goldfinch.finance/pools/0xf74ea34ac88862b7ff419e60e476be2651433e68
        expect(
          await goldfinchAdapter.isLendingPoolExpired(
            "0xf74ea34ac88862b7ff419e60e476be2651433e68"
          )
        ).to.be.true;
      });

      it("...should return true for a pool with term ended", async () => {
        /// slot 460 represents the termEnd
        // pool: 0xc9bdd0d3b80cc6efe79a82d850f44ec9b55387ae;
        // creditline: https://etherscan.io/address/0x7666dE84357dB649D973232834d6456AF3fA61BC#readContract
        const termEndSlot = 460;
        const lendingPool = "0xc9bdd0d3b80cc6efe79a82d850f44ec9b55387ae";
        const tranchedPool = (await ethers.getContractAt(
          "ITranchedPool",
          lendingPool
        )) as ITranchedPool;
        const creditLine = await tranchedPool.creditLine();

        expect(creditLine).to.equal(
          "0x7666dE84357dB649D973232834d6456AF3fA61BC"
        );
        expect(await getStorageAt(creditLine, termEndSlot)).to.eq(
          "0x00000000000000000000000000000000000000000000000000000000673127ab"
        );

        const termEndInPast = (await getLatestBlockTimestamp()) - 2;
        await setStorageAt(
          creditLine,
          termEndSlot,
          toBytes32(BigNumber.from(termEndInPast)).toString()
        );
        expect(await goldfinchAdapter.isLendingPoolExpired(lendingPool)).to.be
          .true;
      });
    });

    describe("getLendingPoolTermEndTimestamp", () => {
      it("...should return the correct term end timestamp", async () => {
        const termEndTimestamp =
          await goldfinchAdapter.getLendingPoolTermEndTimestamp(
            GOLDFINCH_ALMAVEST_BASKET_6_ADDRESS
          );
        // creditLine: https://etherscan.io/address/0x0099f9b99956a495e6c59d9105193ea46abe2d56#readContract#F27
        expect(termEndTimestamp).to.eq(1740068036);
      });
    });

    describe("calculateProtectionBuyerAPR", () => {
      it("...should return the correct interest rate", async () => {
        // see USDC APY: https://app.goldfinch.finance/pools/0x418749e294cabce5a714efccc22a8aade6f9db57
        expect(
          await goldfinchAdapter.calculateProtectionBuyerAPR(
            GOLDFINCH_ALMAVEST_BASKET_6_ADDRESS
          )
        ).to.eq(parseEther("0.17"));

        // see USDC APY: https://app.goldfinch.finance/pools/0x00c27fc71b159a346e179b4a1608a0865e8a7470
        expect(
          await goldfinchAdapter.calculateProtectionBuyerAPR(
            "0x00c27fc71b159a346e179b4a1608a0865e8a7470"
          )
        ).to.eq(parseEther("0.187"));
      });
    });

    describe("calculateRemainingPrincipal", () => {
      const LENDER = "0x008c84421da5527f462886cec43d2717b686a7e4";
      const LENDING_POOL = "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf";

      it("...should return the correct remaining principal", async () => {
        // token info: pool,                           tranche, principal,    principalRedeemed, interestRedeemed
        // 0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf, 2,       420000000000, 223154992,         35191845008
        expect(
          await goldfinchAdapter.calculateRemainingPrincipal(
            LENDING_POOL,
            LENDER,
            590
          )
        ).to.eq(parseUSDC("419776.845008"));
      });

      it("...should return the 0 remaining principal for non-owner", async () => {
        // lender doesn't own the NFT
        expect(
          await goldfinchAdapter.calculateRemainingPrincipal(
            LENDING_POOL,
            LENDER,
            591
          )
        ).to.eq(0);
      });

      it("...should return 0 when the buyer owns the NFT for different pool", async () => {
        expect(
          await goldfinchAdapter.calculateRemainingPrincipal(
            GOLDFINCH_ALMAVEST_BASKET_6_ADDRESS,
            BUYER3,
            142
          )
        ).to.eq(0);
      });
    });

    describe("isLendingPoolLateWithinGracePeriod", () => {
      it("...should return false when payment is not late", async () => {
        // Payment is not late, so should return false
        expect(
          await goldfinchAdapter.isLendingPoolLateWithinGracePeriod(
            "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf",
            1
          )
        ).to.eq(false);

        // Move time forward by 30 days from last payment timestamp
        const lastPaymentTimestamp =
          await goldfinchAdapter.getLatestPaymentTimestamp(
            "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf"
          );
        await setNextBlockTimestamp(
          lastPaymentTimestamp.add(getDaysInSeconds(30))
        );

        // This means, payment is still not late and should return false
        expect(
          await goldfinchAdapter.isLendingPoolLateWithinGracePeriod(
            "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf",
            1
          )
        ).to.eq(false);
      });

      it("...should return true when payment is late but within grace period", async () => {
        // Move time forward by 1 second
        await moveForwardTime(BigNumber.from(1));

        // Payment is late, so should return true
        expect(
          await goldfinchAdapter.isLendingPoolLate(
            "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf"
          )
        ).to.eq(true);

        // Lending pool is late but within grace period, so should return true
        expect(
          await goldfinchAdapter.isLendingPoolLateWithinGracePeriod(
            "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf",
            1
          )
        ).to.eq(true);
      });

      it("...should return false when payment is late and after grace period", async () => {
        // Move time forward by a day
        await moveForwardTime(getDaysInSeconds(1));

        // Payment is late, so should return true
        expect(
          await goldfinchAdapter.isLendingPoolLate(
            "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf"
          )
        ).to.eq(true);

        // Lending pool is late and after grace period, so should return false
        expect(
          await goldfinchAdapter.isLendingPoolLateWithinGracePeriod(
            "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf",
            1
          )
        ).to.eq(false);
      });

      it("...should return false when payment is late and after grace period", async () => {
        // Move time forward by a day
        await moveForwardTime(getDaysInSeconds(1));

        // Payment is late, so should return true
        expect(
          await goldfinchAdapter.isLendingPoolLate(
            "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf"
          )
        ).to.eq(true);

        // Lending pool is late and within longer grace period, so should return true
        expect(
          await goldfinchAdapter.isLendingPoolLateWithinGracePeriod(
            "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf",
            1
          )
        ).to.eq(false);
      });

      it("...should return true when payment is late and within longer grace period", async () => {
        // Lending pool is late and within longer grace period, so should return true
        // Total time elapsed since last payment = 30 days + 2 days + 1 second
        expect(
          await goldfinchAdapter.isLendingPoolLateWithinGracePeriod(
            "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf",
            3
          )
        ).to.eq(true);
      });

      it("...should return false when payment is late and after longer grace period", async () => {
        // Move time forward by another 2 days
        await moveForwardTime(getDaysInSeconds(2));

        // Total time elapsed since last payment = 30 days + 4 days + 1 second
        // Lending pool is late and after grace period of 4 days, so should return false
        expect(
          await goldfinchAdapter.isLendingPoolLateWithinGracePeriod(
            "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf",
            4
          )
        ).to.eq(false);

        // Lending pool is late but longer grace period of 5 days, so should return true
        expect(
          await goldfinchAdapter.isLendingPoolLateWithinGracePeriod(
            "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf",
            5
          )
        ).to.eq(true);
      });
    });

    describe("getPaymentPeriodInDays", () => {
      it("...should return the correct payment period", async () => {
        expect(
          await goldfinchAdapter.getPaymentPeriodInDays(
            "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf"
          )
        ).to.eq(BigNumber.from(30));
      });
    });

    describe("upgrade", () => {
      let upgradedGoldfinchAdapter: GoldfinchAdapterV2;
      let goldfinchAdapterV2ImplementationAddress: string;
      let goldfinchAdapterV2Factory: ContractFactory;

      before(async () => {
        goldfinchAdapterV2Factory = await ethers.getContractFactory(
          "GoldfinchAdapterV2"
        );

        // Forces the import of an existing proxy deployment to be used with hardhat upgrades plugin
        // because the proxy was deployed by ContractFactory and noy using the hardhat upgrades plugin
        await upgrades.forceImport(
          goldfinchAdapter.address,
          await ethers.getContractFactory("GoldfinchAdapter")
        );
      });

      it("...should revert when upgradeTo is called by non-owner", async () => {
        await expect(
          goldfinchAdapter
            .connect(account1)
            .upgradeTo("0xA18173d6cf19e4Cc5a7F63780Fe4738b12E8b781")
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("...should fail upon invalid upgrade", async () => {
        try {
          await upgrades.validateUpgrade(
            goldfinchAdapter.address,
            await ethers.getContractFactory("GoldfinchAdapterNotUpgradable"),
            {
              kind: "uups"
            }
          );
        } catch (e: any) {
          expect(e.message).includes(
            "Contract `contracts/test/GoldfinchAdapterV2.sol:GoldfinchAdapterNotUpgradable` is not upgrade safe"
          );
        }
      });

      it("...should be valid upgrade", async () => {
        await upgrades.validateUpgrade(
          goldfinchAdapter.address,
          goldfinchAdapterV2Factory,
          {
            kind: "uups"
          }
        );
      });

      it("...should upgrade successfully", async () => {
        const goldfinchAdapterV2Impl = await goldfinchAdapterV2Factory.deploy();
        await goldfinchAdapterV2Impl.deployed();
        goldfinchAdapterV2ImplementationAddress =
          goldfinchAdapterV2Impl.address;

        await goldfinchAdapter
          .connect(deployer)
          .upgradeTo(goldfinchAdapterV2Impl.address);

        // upgrade to v2
        upgradedGoldfinchAdapter = goldfinchAdapterV2Factory.attach(
          goldfinchAdapter.address
        ) as GoldfinchAdapterV2;
      });

      it("...should have new implementation address after upgrade", async () => {
        expect(
          await upgrades.erc1967.getImplementationAddress(
            upgradedGoldfinchAdapter.address
          )
        ).to.be.equal(goldfinchAdapterV2ImplementationAddress);
      });

      it("...should be able to call new function in v2", async () => {
        const value = await upgradedGoldfinchAdapter.getVersion();
        expect(value).to.equal("v2");
      });

      it("...should be able to call existing function in v1", async () => {
        const value = await upgradedGoldfinchAdapter.getPaymentPeriodInDays(
          "0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf"
        );
        expect(value).to.equal(30);
      });
    });
  });
};

export { testGoldfinchAdapter };
