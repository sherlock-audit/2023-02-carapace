import { BigNumber } from "@ethersproject/bignumber";
import { expect } from "chai";
import { parseEther, formatEther } from "ethers/lib/utils";
import { AccruedPremiumCalculator } from "../../typechain-types/contracts/libraries/AccruedPremiumCalculator";

const testAccruedPremiumCalculator: Function = (
  accruedPremiumCalculator: AccruedPremiumCalculator
) => {
  describe("AccruedPremiumCalculator", () => {
    const _curvature: BigNumber = parseEther("0.05");
    const _leverageRatioFloor: BigNumber = parseEther("0.1");
    const _leverageRatioCeiling: BigNumber = parseEther("0.2");
    const _leverageRatioBuffer: BigNumber = parseEther("0.05");
    const _protectionAmt = 1000000; // 1M
    const _annualPremiumRate = 0.04; // 4% annual rate
    const _protection_duration_in_days = 180;
    const _protectionDurationInDaysScaled = parseEther(
      _protection_duration_in_days.toString()
    );
    const _premiumPerDay = (_annualPremiumRate * _protectionAmt) / 365;
    const _totalPremium = parseEther(
      (_premiumPerDay * _protection_duration_in_days).toString()
    );
    const _currentLeverageRatio = parseEther("0.14");
    let _minPremium = parseEther("0");
    let K: BigNumber;
    let lambda: BigNumber;

    describe("without min premium specified", () => {
      before(async () => {
        const KAndLambda = await accruedPremiumCalculator.calculateKAndLambda(
          _totalPremium,
          _protectionDurationInDaysScaled,
          _currentLeverageRatio,
          _leverageRatioFloor,
          _leverageRatioCeiling,
          _leverageRatioBuffer,
          _curvature,
          _minPremium
        );
        K = KAndLambda[0];
        lambda = KAndLambda[1];
      });

      describe("calculateKAndLambda", () => {
        it("... calculates correct K and lambda", async () => {
          expect(K).to.be.gt(parseEther("664888.36124"));
          expect(K).to.be.lt(parseEther("664888.36125"));

          expect(lambda).to.be.gt(parseEther("0.00016731"));
          expect(lambda).to.be.lt(parseEther("0.00016732"));
        });

        it("... calculates K & lambda without underflow/overflow for range 0.1 to 0.2", async () => {
          let leverageRatio = _leverageRatioFloor;
          while (leverageRatio.lte(_leverageRatioCeiling)) {
            await accruedPremiumCalculator.calculateKAndLambda(
              _totalPremium,
              _protectionDurationInDaysScaled,
              leverageRatio,
              _leverageRatioFloor,
              _leverageRatioCeiling,
              _leverageRatioBuffer,
              _curvature,
              0
            );
            leverageRatio = leverageRatio.add(parseEther("0.005"));
          }
          expect(true).to.be.true;
        });
      });

      describe("calculateAccruedPremium", () => {
        it("... calculates correct accrued premium for a period from day 0 to day 180", async () => {
          const accruedPremium =
            await accruedPremiumCalculator.calculateAccruedPremium(
              0 * 86400, // start time
              180 * 86400, // end time
              K,
              lambda
            );

          // accrued premium for a period from day 0 to day 180 should match to total premium
          expect(accruedPremium).to.equal(_totalPremium);
        });

        it("... calculates correct accrued premium for a period from day 0 to day 1", async () => {
          // accrued premium for a period from day 0 to day 1
          const accruedPremium =
            await accruedPremiumCalculator.calculateAccruedPremium(
              0 * 86400, // start time
              1 * 86400, // end time
              K,
              lambda
            );

          expect(accruedPremium).to.be.gt(parseEther("111.238274"));
          expect(accruedPremium).to.be.lt(parseEther("111.238275"));
        });

        it("... calculates correct accrued premium for a period from day 8 to day 10", async () => {
          // accrued premium for a period from day 0 to day 1
          const accruedPremium =
            await accruedPremiumCalculator.calculateAccruedPremium(
              8 * 86400, // start time
              10 * 86400, // end time
              K,
              lambda
            );

          expect(accruedPremium).to.be.gt(parseEther("222.160368"));
          expect(accruedPremium).to.be.lt(parseEther("222.160369"));
        });

        it("... calculates correct accrued premium for a period from second 100 to second 200", async () => {
          const accruedPremium =
            await accruedPremiumCalculator.calculateAccruedPremium(
              100, // start time
              200, // end time
              K,
              lambda
            );

          console.log("Accrued premium = ", formatEther(accruedPremium));
          expect(accruedPremium).to.be.gt(parseEther("0.12875"));
          expect(accruedPremium).to.be.lt(parseEther("0.12876"));
        });
      });
    });

    describe("with min premium specified", () => {
      before(async () => {
        _minPremium = parseEther("0.02");
        const KAndLambda = await accruedPremiumCalculator.calculateKAndLambda(
          _totalPremium,
          _protectionDurationInDaysScaled,
          _currentLeverageRatio,
          _leverageRatioFloor,
          _leverageRatioCeiling,
          _leverageRatioBuffer,
          _curvature,
          _minPremium
        );
        K = KAndLambda[0];
        lambda = KAndLambda[1];
      });

      describe("calculateKAndLambda", () => {
        it("... calculates correct K and lambda", async () => {
          expect(K).to.be.gt(parseEther("986301.36986"));
          expect(K).to.be.lt(parseEther("986301.36987"));

          expect(lambda).to.be.gt(parseEther("0.00011223"));
          expect(lambda).to.be.lt(parseEther("0.00011224"));
        });

        it("... calculates K & lambda without underflow/overflow for range 0.1 to 0.2", async () => {
          let leverageRatio = _leverageRatioFloor;
          while (leverageRatio.lte(_leverageRatioCeiling)) {
            await accruedPremiumCalculator.calculateKAndLambda(
              _totalPremium,
              _protectionDurationInDaysScaled,
              leverageRatio,
              _leverageRatioFloor,
              _leverageRatioCeiling,
              _leverageRatioBuffer,
              _curvature,
              _minPremium
            );
            leverageRatio = leverageRatio.add(parseEther("0.005"));
          }
          expect(true).to.be.true;
        });
      });

      describe("calculateAccruedPremium", () => {
        it("... calculates correct accrued premium for a period from day 0 to day 180", async () => {
          const accruedPremium =
            await accruedPremiumCalculator.calculateAccruedPremium(
              0 * 86400, // start time
              180 * 86400, // end time
              K,
              lambda
            );

          // accrued premium for a period from day 0 to day 180 should match to total premium
          expect(accruedPremium).to.equal(_totalPremium);
        });

        it("... calculates correct accrued premium for a period from day 0 to day 1", async () => {
          // accrued premium for a period from day 0 to day 1
          const accruedPremium =
            await accruedPremiumCalculator.calculateAccruedPremium(
              0 * 86400, // start time
              1 * 86400, // end time
              K,
              lambda
            );

          expect(accruedPremium).to.be.gt(parseEther("110.693554"));
          expect(accruedPremium).to.be.lt(parseEther("110.693555"));
        });

        it("... calculates correct accrued premium for a period from day 9 to day 13", async () => {
          // accrued premium for a period from day 0 to day 1
          const accruedPremium =
            await accruedPremiumCalculator.calculateAccruedPremium(
              9 * 86400, // start time
              13 * 86400, // end time
              K,
              lambda
            );

          expect(accruedPremium).to.be.gt(parseEther("442.252721"));
          expect(accruedPremium).to.be.lt(parseEther("442.252722"));
        });

        it("... calculates correct accrued premium for a period from second 101 to second 221", async () => {
          const accruedPremium =
            await accruedPremiumCalculator.calculateAccruedPremium(
              101, // start time
              221, // end time
              K,
              lambda
            );

          console.log("Accrued premium = ", formatEther(accruedPremium));
          expect(accruedPremium).to.be.gt(parseEther("0.153749"));
          expect(accruedPremium).to.be.lt(parseEther("0.153750"));
        });
      });
    });
  });
};

export { testAccruedPremiumCalculator };
