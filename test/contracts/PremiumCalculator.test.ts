import { BigNumber } from "@ethersproject/bignumber";
import { expect } from "chai";
import { parseEther } from "ethers/lib/utils";
import { Signer } from "ethers/lib/ethers";
import { ProtectionPoolParamsStruct } from "../../typechain-types/contracts/interfaces/IProtectionPool";
import { ProtectionPoolCycleParamsStruct } from "../../typechain-types/contracts/interfaces/IProtectionPoolCycleManager";
import { parseUSDC } from "../utils/usdc";

import { PremiumCalculator } from "../../typechain-types/contracts/core/PremiumCalculator";
import { getDaysInSeconds } from "../utils/time";
import { ethers, upgrades } from "hardhat";
import { RiskFactorCalculator } from "../../typechain-types/contracts/libraries/RiskFactorCalculator";
import { PremiumCalculatorV2 } from "../../typechain-types/contracts/test/PremiumCalculatorV2";

const testPremiumCalculator: Function = (
  deployer: Signer,
  account1: Signer,
  premiumCalculator: PremiumCalculator,
  riskFactorCalculator: RiskFactorCalculator
) => {
  describe("PremiumCalculator", () => {
    const _curvature: BigNumber = parseEther("0.05");
    const _leverageRatioFloor: BigNumber = parseEther("0.1");
    const _leverageRatioCeiling: BigNumber = parseEther("0.2");
    const _leverageRatioBuffer: BigNumber = parseEther("0.05");
    const _protectionAmt = parseEther("100000"); // 100k
    const _currentLeverageRatio = parseEther("0.15"); // 15%
    const _protectionBuyerApy = parseEther("0.17"); // 17%
    const _poolCycleParams: ProtectionPoolCycleParamsStruct = {
      openCycleDuration: BigNumber.from(10 * 86400), // 10 days
      cycleDuration: BigNumber.from(30 * 86400) // 30 days
    };
    const _minRequiredCapital = parseUSDC("10000");
    const _poolParams: ProtectionPoolParamsStruct = {
      leverageRatioFloor: _leverageRatioFloor,
      leverageRatioCeiling: _leverageRatioCeiling,
      leverageRatioBuffer: _leverageRatioBuffer,
      minRequiredCapital: _minRequiredCapital,
      curvature: _curvature,
      minCarapaceRiskPremiumPercent: parseEther("0.02"), // 2%
      underlyingRiskPremiumPercent: parseEther("0.1"), // 10%
      minProtectionDurationInSeconds: getDaysInSeconds(10),
      protectionRenewalGracePeriodInSeconds: getDaysInSeconds(10)
    };

    describe("constructor", () => {
      it("...should set deployer as on owner", async () => {
        expect(await premiumCalculator.owner()).to.equal(
          await deployer.getAddress()
        );
      });

      it("... should revert when initialize is called 2nd time", async () => {
        await expect(premiumCalculator.initialize()).to.be.revertedWith(
          "Initializable: contract is already initialized"
        );
      });
    });

    describe("calculatePremium", () => {
      const _totalCapital = parseUSDC("15000");

      it("... calculates correct premium amount for a period of 180 days", async () => {
        const _protectionDurationInSeconds = getDaysInSeconds(180);
        const premiumAndMinPremiumFlag =
          await premiumCalculator.calculatePremium(
            _protectionDurationInSeconds,
            _protectionAmt,
            _protectionBuyerApy,
            _currentLeverageRatio,
            _totalCapital,
            _poolParams
          );

        expect(premiumAndMinPremiumFlag[0])
          .to.be.gt(parseEther("3271.8265"))
          .and.lt(parseEther("3271.8266"));
      });

      it("... calculates correct premium amount for a period of 365 days", async () => {
        const _protectionDurationInSeconds = getDaysInSeconds(365);

        const premiumAndMinPremiumFlag =
          await premiumCalculator.calculatePremium(
            _protectionDurationInSeconds,
            _protectionAmt,
            _protectionBuyerApy,
            _currentLeverageRatio,
            _totalCapital,
            _poolParams
          );

        expect(premiumAndMinPremiumFlag[0])
          .to.be.gt(parseEther("6572.8151"))
          .and.lt(parseEther("6572.8152"));
      });

      it("... calculates premium amount without overflow/underflow for a range of leverage ratio from 0.1 to 0.2", async () => {
        const _protectionDurationInSeconds = getDaysInSeconds(365 * 2); // 2 years

        let leverageRatio = _leverageRatioFloor;
        let protectionAmount = _protectionAmt;
        let protectionBuyerApy = parseEther("0.1");
        while (leverageRatio.lte(_leverageRatioCeiling)) {
          await premiumCalculator.calculatePremium(
            _protectionDurationInSeconds,
            protectionAmount,
            protectionBuyerApy,
            leverageRatio,
            _totalCapital,
            _poolParams
          );
          leverageRatio = leverageRatio.add(parseEther("0.005"));
          protectionAmount = protectionAmount.add(_protectionAmt);
          protectionBuyerApy = protectionBuyerApy.add(parseEther("0.01"));
        }
      });
    });

    describe("calculatePremium with min carapace premium rate", () => {
      it("... calculates correct premium amount when leverage ratio is less than floor", async () => {
        const _totalCapital = parseUSDC("500000");
        const _protectionDurationInSeconds = getDaysInSeconds(180);

        const premiumAndMinPremiumFlag =
          await premiumCalculator.calculatePremium(
            _protectionDurationInSeconds,
            _protectionAmt,
            _protectionBuyerApy,
            _leverageRatioFloor.sub(parseEther("0.05")), // leverage ratio(0.05) is less than floor
            _totalCapital,
            _poolParams
          );

        expect(premiumAndMinPremiumFlag[0])
          .to.be.gt(parseEther("2837.8052"))
          .and.lt(parseEther("2837.8053"));
      });

      it("... calculates correct premium amount when leverage ratio is higher than ceiling", async () => {
        const _totalCapital = parseUSDC("15000");
        const _protectionDurationInSeconds = getDaysInSeconds(180);

        const premiumAndMinPremiumFlag =
          await premiumCalculator.calculatePremium(
            _protectionDurationInSeconds,
            _protectionAmt,
            _protectionBuyerApy,
            _leverageRatioCeiling.add(parseEther("0.05")), // leverage ratio(0.25) is higher than ceiling
            _totalCapital,
            _poolParams
          );

        expect(premiumAndMinPremiumFlag[0])
          .to.be.gt(parseEther("2837.8052"))
          .and.lt(parseEther("2837.8053"));
      });

      it("... calculates correct premium amount when total capital is lower than min required capital", async () => {
        const _totalCapital = _minRequiredCapital.sub(parseUSDC("1"));
        const _protectionDurationInSeconds = getDaysInSeconds(180);

        const premiumAndMinPremiumFlag =
          await premiumCalculator.calculatePremium(
            _protectionDurationInSeconds,
            _protectionAmt,
            _protectionBuyerApy,
            0,
            _totalCapital,
            _poolParams
          );

        expect(premiumAndMinPremiumFlag[0])
          .to.be.gt(parseEther("2837.8052"))
          .and.lt(parseEther("2837.8053"));
      });

      it("... calculates correct premium amount when total protection is lower than min required protection", async () => {
        const _totalCapital = _minRequiredCapital.add(parseUSDC("1"));
        const _protectionDurationInSeconds = getDaysInSeconds(180);

        const premiumAndMinPremiumFlag =
          await premiumCalculator.calculatePremium(
            _protectionDurationInSeconds,
            _protectionAmt,
            _protectionBuyerApy,
            0,
            _totalCapital,
            _poolParams
          );

        expect(premiumAndMinPremiumFlag[0])
          .to.be.gt(parseEther("2837.8052"))
          .and.lt(parseEther("2837.8053"));
      });
    });

    describe("upgrade", () => {
      let upgradedPremiumCalculator: PremiumCalculatorV2;

      it("... should revert when upgradeTo is called by non-owner", async () => {
        await expect(
          premiumCalculator
            .connect(account1)
            .upgradeTo("0xA18173d6cf19e4Cc5a7F63780Fe4738b12E8b781")
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("... should upgrade successfully", async () => {
        const premiumCalculatorV2Factory = await ethers.getContractFactory(
          "PremiumCalculatorV2",
          {
            signer: deployer,
            libraries: {
              RiskFactorCalculator: riskFactorCalculator.address
            }
          }
        );

        // upgrade to v2
        upgradedPremiumCalculator = (await upgrades.upgradeProxy(
          premiumCalculator.address,
          premiumCalculatorV2Factory,
          {
            unsafeAllowLinkedLibraries: true
          }
        )) as PremiumCalculatorV2;
      });

      it("... should have same address after upgrade", async () => {
        expect(upgradedPremiumCalculator.address).to.be.equal(
          premiumCalculator.address
        );
      });

      it("... should be able to call new function in v2", async () => {
        const value = await upgradedPremiumCalculator.calculatePremiumV2(2);
        expect(value).to.equal(BigNumber.from(4));
      });

      it("... should be able to call existing function in v1", async () => {
        const _protectionDurationInSeconds = getDaysInSeconds(180);
        const premiumAndMinPremiumFlag =
          await premiumCalculator.calculatePremium(
            _protectionDurationInSeconds,
            _protectionAmt,
            _protectionBuyerApy,
            _currentLeverageRatio,
            parseUSDC("15000"),
            _poolParams
          );

        expect(premiumAndMinPremiumFlag[0])
          .to.be.gt(parseEther("3271.8265"))
          .and.lt(parseEther("3271.8266"));
      });
    });
  });
};

export { testPremiumCalculator };
