import { BigNumber } from "@ethersproject/bignumber";
import { expect } from "chai";
import { parseEther, formatEther } from "ethers/lib/utils";
import { RiskFactorCalculator } from "../../typechain-types/contracts/libraries/RiskFactorCalculator";

const testRiskFactorCalculator: Function = (
  riskFactorCalculator: RiskFactorCalculator
) => {
  describe("RiskFactorCalculator", () => {
    const _curvature: BigNumber = parseEther("0.05");
    const _leverageRatioFloor: BigNumber = parseEther("0.1");
    const _leverageRatioCeiling: BigNumber = parseEther("0.2");
    const _leverageRatioBuffer: BigNumber = parseEther("0.05");
    const _currentLeverageRatio = parseEther("0.14");

    describe("calculateRiskFactor", () => {
      it("... calculates correct risk factor", async () => {
        const riskFactor = await riskFactorCalculator.calculateRiskFactor(
          _currentLeverageRatio,
          _leverageRatioFloor,
          _leverageRatioCeiling,
          _leverageRatioBuffer,
          _curvature
        );
        expect(riskFactor).to.be.eq(parseEther("0.061111111111111111"));
      });

      it("... calculates risk factor without underflow/overflow for range 0.05 to 0.25", async () => {
        const step = parseEther("0.005");
        let leverageRatio = _leverageRatioFloor;
        while (leverageRatio.lte(_leverageRatioCeiling)) {
          await riskFactorCalculator.calculateRiskFactor(
            leverageRatio,
            _leverageRatioFloor,
            _leverageRatioCeiling,
            _leverageRatioBuffer,
            _curvature
          );
          leverageRatio = leverageRatio.add(step);
        }
        expect(true).to.be.true;
      });
    });

    describe("calculateRiskFactorUsingMinPremium", () => {
      it("...calculates the risk factor correctly", async () => {
        const riskFactor =
          await riskFactorCalculator.calculateRiskFactorUsingMinPremium(
            parseEther("0.02"),
            parseEther("30.5")
          );
        console.log("riskFactor: " + formatEther(riskFactor));
        expect(riskFactor)
          .to.be.gt(parseEther("0.241929"))
          .and.lt(parseEther("0.241930"));
      });

      it("...calculates the risk factor without underflow/overflow for a range of min premium & durations", async () => {
        let minPremium = parseEther("0.02");
        let durationInDays = parseEther("30.5");
        while (minPremium.lte(parseEther("0.3"))) {
          await riskFactorCalculator.calculateRiskFactorUsingMinPremium(
            minPremium,
            durationInDays
          );
          minPremium = minPremium.add(parseEther("0.005"));
          durationInDays = durationInDays.add(parseEther("30"));
        }
      });
    });
  });
};

export { testRiskFactorCalculator };
