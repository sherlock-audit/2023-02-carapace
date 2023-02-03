import { BigNumber } from "@ethersproject/bignumber";
import { expect } from "chai";
import { Contract, Signer, ContractFactory } from "ethers";
import { ethers, network, upgrades } from "hardhat";
import { parseEther } from "ethers/lib/utils";
import {
  ProtectionPool,
  ProtectionInfoStructOutput
} from "../../typechain-types/contracts/core/pool/ProtectionPool";
import { ProtectionPoolInfoStructOutput } from "../../typechain-types/contracts/interfaces/IProtectionPool";
import { ReferenceLendingPools } from "../../typechain-types/contracts/core/pool/ReferenceLendingPools";
import { ProtectionPurchaseParamsStruct } from "../../typechain-types/contracts/interfaces/IReferenceLendingPools";
import { ProtectionPoolCycleManager } from "../../typechain-types/contracts/core/ProtectionPoolCycleManager";
import {
  getDaysInSeconds,
  getLatestBlockTimestamp,
  moveForwardTimeByDays,
  setNextBlockTimestamp
} from "../utils/time";
import {
  parseUSDC,
  getUsdcContract,
  impersonateCircle,
  transferAndApproveUsdc
} from "../utils/usdc";
import { ITranchedPool } from "../../typechain-types/contracts/external/goldfinch/ITranchedPool";
import { payToLendingPool, payToLendingPoolAddress } from "../utils/goldfinch";
import { DefaultStateManager } from "../../typechain-types/contracts/core/DefaultStateManager";
import { ZERO_ADDRESS } from "../utils/constants";
import { getGoldfinchLender1 } from "../utils/goldfinch";
import { ProtectionPoolV2 } from "../../typechain-types/contracts/test/ProtectionPoolV2";

const testProtectionPool: Function = (
  deployer: Signer,
  owner: Signer,
  buyer: Signer,
  seller: Signer,
  account4: Signer,
  protectionPool: ProtectionPool,
  protectionPoolImplementation: ProtectionPool,
  referenceLendingPools: ReferenceLendingPools,
  protectionPoolCycleManager: ProtectionPoolCycleManager,
  defaultStateManager: DefaultStateManager,
  getPoolContractFactory: Function
) => {
  describe("ProtectionPool", () => {
    const PROTECTION_BUYER1_ADDRESS =
      "0x008c84421da5527f462886cec43d2717b686a7e4";

    const _newFloor: BigNumber = parseEther("0.4");
    const _newCeiling: BigNumber = parseEther("1.1");
    let deployerAddress: string;
    let sellerAddress: string;
    let account4Address: string;
    let buyerAddress: string;
    let ownerAddress: string;
    let USDC: Contract;
    let poolInfo: ProtectionPoolInfoStructOutput;
    let before1stDepositSnapshotId: string;
    let snapshotId2: string;
    let _protectionBuyer1: Signer;
    let _protectionBuyer2: Signer;
    let _protectionBuyer3: Signer;
    let _protectionBuyer4: Signer;
    let _circleAccount: Signer;
    let _goldfinchLendingPools: string[];
    let _lendingPool1: string;
    let _lendingPool2: string;

    const calculateTotalSellerDeposit = async () => {
      // seller deposit should total sToken underlying - premium accrued
      const [
        _totalSTokenUnderlying,
        _totalProtection,
        _totalPremium,
        _totalPremiumAccrued
      ] = await protectionPool.getPoolDetails();
      return _totalSTokenUnderlying.sub(_totalPremiumAccrued);
    };

    const depositAndRequestWithdrawal = async (
      _account: Signer,
      _accountAddress: string,
      _depositAmount: BigNumber,
      _withdrawalAmount: BigNumber
    ) => {
      await USDC.connect(_account).approve(
        protectionPool.address,
        _depositAmount
      );

      await protectionPool
        .connect(_account)
        .depositAndRequestWithdrawal(_depositAmount, _withdrawalAmount);
    };

    const verifyWithdrawal = async (
      _account: Signer,
      _sTokenWithdrawalAmt: BigNumber
    ) => {
      const accountAddress = await _account.getAddress();
      const sTokenBalanceBefore = await protectionPool.balanceOf(
        accountAddress
      );
      const usdcBalanceBefore = await USDC.balanceOf(accountAddress);
      const poolUsdcBalanceBefore = await USDC.balanceOf(
        protectionPool.address
      );
      const poolTotalSTokenUnderlyingBefore = (
        await protectionPool.getPoolDetails()
      )[0];

      const expectedUsdcWithdrawalAmt =
        await protectionPool.convertToUnderlying(_sTokenWithdrawalAmt);

      // withdraw sTokens
      await expect(
        protectionPool
          .connect(_account)
          .withdraw(_sTokenWithdrawalAmt, accountAddress)
      )
        .to.emit(protectionPool, "WithdrawalMade")
        .withArgs(accountAddress, _sTokenWithdrawalAmt, accountAddress);

      const sTokenBalanceAfter = await protectionPool.balanceOf(accountAddress);
      expect(sTokenBalanceBefore.sub(sTokenBalanceAfter)).to.eq(
        _sTokenWithdrawalAmt
      );

      const usdcBalanceAfter = await USDC.balanceOf(accountAddress);
      expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.be.eq(
        expectedUsdcWithdrawalAmt
      );

      const poolUsdcBalanceAfter = await USDC.balanceOf(protectionPool.address);
      expect(poolUsdcBalanceBefore.sub(poolUsdcBalanceAfter)).to.eq(
        expectedUsdcWithdrawalAmt
      );

      const poolTotalSTokenUnderlyingAfter = (
        await protectionPool.getPoolDetails()
      )[0];
      expect(
        poolTotalSTokenUnderlyingBefore.sub(poolTotalSTokenUnderlyingAfter)
      ).to.eq(expectedUsdcWithdrawalAmt);
    };

    const transferAndApproveUsdcToPool = async (
      _buyer: Signer,
      _amount: BigNumber
    ) => {
      await transferAndApproveUsdc(_buyer, _amount, protectionPool.address);
    };

    const verifyPoolState = async (
      expectedCycleIndex: number,
      expectedState: number
    ) => {
      await protectionPoolCycleManager.calculateAndSetPoolCycleState(
        protectionPool.address
      );
      const currentPoolCycle =
        await protectionPoolCycleManager.getCurrentPoolCycle(
          protectionPool.address
        );
      expect(currentPoolCycle.currentCycleIndex).to.equal(expectedCycleIndex);
      expect(currentPoolCycle.currentCycleState).to.eq(expectedState);
    };

    const getActiveProtections = async () => {
      const allProtections = await protectionPool.getAllProtections();
      return allProtections.filter((p: any) => p.expired === false);
    };

    const depositAndVerify = async (
      _account: Signer,
      _depositAmount: string
    ) => {
      const _underlyingAmount: BigNumber = parseUSDC(_depositAmount);
      const _accountAddress = await _account.getAddress();
      let _totalSTokenUnderlyingBefore = (
        await protectionPool.getPoolDetails()
      )[0];
      let _poolUsdcBalanceBefore = await USDC.balanceOf(protectionPool.address);
      let _sTokenBalanceBefore = await protectionPool.balanceOf(
        _accountAddress
      );

      await transferAndApproveUsdcToPool(_account, _underlyingAmount);
      await expect(
        protectionPool
          .connect(_account)
          .deposit(_underlyingAmount, _accountAddress)
      )
        .to.emit(protectionPool, "ProtectionSold")
        .withArgs(_accountAddress, _underlyingAmount);

      // Seller should receive same sTokens shares as the deposit because of no premium accrued
      let _sTokenBalanceAfter = await protectionPool.balanceOf(_accountAddress);
      const _sTokenReceived = _sTokenBalanceAfter.sub(_sTokenBalanceBefore);
      expect(_sTokenReceived).to.eq(parseEther(_depositAmount));

      // Verify the pool's total sToken underlying is updated correctly
      let _totalSTokenUnderlyingAfter = (
        await protectionPool.getPoolDetails()
      )[0];
      expect(
        _totalSTokenUnderlyingAfter.sub(_totalSTokenUnderlyingBefore)
      ).to.eq(_underlyingAmount);

      // Verify the pool's USDC balance is updated correctly
      let _poolUsdcBalanceAfter = await USDC.balanceOf(protectionPool.address);
      expect(_poolUsdcBalanceAfter.sub(_poolUsdcBalanceBefore)).to.eq(
        _underlyingAmount
      );

      // Seller should receive same USDC amt as deposited because no premium accrued
      expect(
        await protectionPool.convertToUnderlying(_sTokenReceived)
      ).to.be.eq(_underlyingAmount);
    };

    const verifyMaxAllowedProtectionDuration = async () => {
      const currentTimestamp = await getLatestBlockTimestamp();
      const currentPoolCycle =
        await protectionPoolCycleManager.getCurrentPoolCycle(
          protectionPool.address
        );

      // max duration = next cycle's end timestamp - currentTimestamp
      expect(
        await protectionPool.calculateMaxAllowedProtectionDuration()
      ).to.eq(
        currentPoolCycle.currentCycleStartTime
          .add(currentPoolCycle.params.cycleDuration.mul(2))
          .sub(currentTimestamp)
      );
    };

    before("setup", async () => {
      deployerAddress = await deployer.getAddress();
      sellerAddress = await seller.getAddress();
      buyerAddress = await buyer.getAddress();
      ownerAddress = await owner.getAddress();
      account4Address = await account4.getAddress();
      poolInfo = await protectionPool.getPoolInfo();
      USDC = getUsdcContract(deployer);

      // Impersonate CIRCLE account and transfer some USDC to test accounts
      _circleAccount = await impersonateCircle();
      USDC.connect(_circleAccount).transfer(
        deployerAddress,
        parseUSDC("1000000")
      );
      USDC.connect(_circleAccount).transfer(ownerAddress, parseUSDC("20000"));
      USDC.connect(_circleAccount).transfer(sellerAddress, parseUSDC("20000"));
      USDC.connect(_circleAccount).transfer(
        account4Address,
        parseUSDC("20000")
      );

      // 420K principal for token 590
      _protectionBuyer1 = await getGoldfinchLender1();

      USDC.connect(_circleAccount).transfer(
        PROTECTION_BUYER1_ADDRESS,
        parseUSDC("1000000")
      );

      // these lending pools have been already added to referenceLendingPools instance
      // Lending pool details: https://app.goldfinch.finance/pools/0xd09a57127bc40d680be7cb061c2a6629fe71abef
      // Lending pool tokens: https://lark.market/?attributes%5BPool+Address%5D=0xd09a57127bc40d680be7cb061c2a6629fe71abef
      _goldfinchLendingPools = await referenceLendingPools.getLendingPools();
      _lendingPool1 = _goldfinchLendingPools[0];
      _lendingPool2 = _goldfinchLendingPools[1];
    });

    describe("Implementation", async () => {
      describe("constructor", async () => {
        it("...should NOT have an owner on construction", async () => {
          expect(await protectionPoolImplementation.owner()).to.equal(
            ZERO_ADDRESS
          );
        });

        it("...should disable initialize after construction", async () => {
          await expect(
            protectionPoolImplementation.initialize(
              ZERO_ADDRESS,
              poolInfo,
              ZERO_ADDRESS,
              ZERO_ADDRESS,
              ZERO_ADDRESS,
              "",
              ""
            )
          ).to.be.revertedWith(
            "Initializable: contract is already initialized"
          );
        });

        it("...should be valid implementation", async () => {
          await upgrades.validateImplementation(
            await getPoolContractFactory(),
            {
              kind: "uups",
              unsafeAllowLinkedLibraries: true
            }
          );
        });
      });
    });

    describe("constructor", () => {
      it("...and implementation are different instances", async () => {
        expect(protectionPool.address).to.not.equal(
          protectionPoolImplementation.address
        );
      });

      it("...should set the correct owner on construction", async () => {
        const owner: string = await protectionPool.owner();
        expect(owner).to.equal(deployerAddress);
      });

      it("...should disable initialize after construction", async () => {
        await expect(
          protectionPool.initialize(
            ZERO_ADDRESS,
            poolInfo,
            ZERO_ADDRESS,
            ZERO_ADDRESS,
            ZERO_ADDRESS,
            "",
            ""
          )
        ).to.be.revertedWith("Initializable: contract is already initialized");
      });

      it("...set the SToken name", async () => {
        const _name: string = await protectionPool.name();
        expect(_name).to.eq("sToken11");
      });

      it("...set the SToken symbol", async () => {
        const _symbol: string = await protectionPool.symbol();
        expect(_symbol).to.eq("sT11");
      });

      it("...set the leverage ratio floor", async () => {
        expect(poolInfo.params.leverageRatioFloor).to.eq(parseEther("0.5"));
      });

      it("...set the leverage ratio ceiling", async () => {
        expect(poolInfo.params.leverageRatioCeiling).to.eq(parseEther("1"));
      });

      it("...set the leverage ratio buffer", async () => {
        expect(poolInfo.params.leverageRatioBuffer).to.eq(parseEther("0.05"));
      });

      it("...set the min required capital", async () => {
        expect(poolInfo.params.minRequiredCapital).to.eq(parseUSDC("100000"));
      });

      it("...set the curvature", async () => {
        expect(poolInfo.params.curvature).to.eq(parseEther("0.05"));
      });

      it("...set the minCarapaceRiskPremiumPercent", async () => {
        expect(poolInfo.params.minCarapaceRiskPremiumPercent).to.eq(
          parseEther("0.02")
        );
      });

      it("...set the underlyingRiskPremiumPercent", async () => {
        expect(poolInfo.params.underlyingRiskPremiumPercent).to.eq(
          parseEther("0.1")
        );
      });

      it("...set the underlying token", async () => {
        expect(poolInfo.underlyingToken.toString()).to.eq(USDC.address);
      });

      it("...set the reference loans", async () => {
        expect(poolInfo.referenceLendingPools.toString()).to.eq(
          referenceLendingPools.address
        );
      });

      it("...set the protectionRenewalGracePeriodInSeconds", async () => {
        expect(poolInfo.params.protectionRenewalGracePeriodInSeconds).to.eq(
          getDaysInSeconds(14)
        );
      });

      it("...set the pool state to be DepositOnly", async () => {
        expect((await protectionPool.getPoolInfo()).currentPhase).to.eq(0); // 0 = Deposit Only
      });

      it("...getAllProtections should return empty array", async () => {
        expect((await protectionPool.getAllProtections()).length).to.eq(0);
      });
    });

    describe("calculateLeverageRatio without any protection buyers or sellers", () => {
      it("...should return 0 when pool has no protection sold", async () => {
        expect(await protectionPool.calculateLeverageRatio()).to.equal(0);
      });
    });

    describe("calculateMaxAllowedProtectionAmount", () => {
      let buyer: Signer;

      before(async () => {
        buyer = await ethers.getImpersonatedSigner(
          "0xcb726f13479963934e91b6f34b6e87ec69c21bb9"
        );
      });

      it("...should return the correct remaining principal", async () => {
        expect(
          await protectionPool
            .connect(buyer)
            .calculateMaxAllowedProtectionAmount(_lendingPool2, 615)
        ).to.eq(parseUSDC("35000"));
      });

      it("...should return the 0 remaining principal for non-owner", async () => {
        // lender doesn't own the NFT
        expect(
          await protectionPool
            .connect(buyer)
            .calculateMaxAllowedProtectionAmount(_lendingPool2, 590)
        ).to.eq(0);
      });

      it("...should return 0 when the buyer owns the NFT for different pool", async () => {
        // see: https://lark.market/tokenDetail?tokenId=142
        // Buyer owns this token, but pool for this token is 0x57686612c601cb5213b01aa8e80afeb24bbd01df

        expect(
          await protectionPool
            .connect(buyer)
            .calculateMaxAllowedProtectionAmount(_lendingPool1, 142)
        ).to.be.eq(0);
      });
    });

    describe("...1st pool cycle", async () => {
      const currentPoolCycleIndex = 0;

      describe("calculateMaxAllowedProtectionDuration", () => {
        it("...should return correct duration", async () => {
          await verifyMaxAllowedProtectionDuration();
        });
      });

      describe("...deposit", async () => {
        const _depositAmount = "40000";
        const _underlyingAmount: BigNumber = parseUSDC(_depositAmount);

        it("...approve 0 USDC to be transferred by the Pool contract", async () => {
          expect(await USDC.approve(protectionPool.address, BigNumber.from(0)))
            .to.emit(USDC, "Approval")
            .withArgs(
              deployerAddress,
              protectionPool.address,
              BigNumber.from(0)
            );
          const _allowanceAmount: number = await USDC.allowance(
            deployerAddress,
            protectionPool.address
          );
          expect(_allowanceAmount.toString()).to.eq(
            BigNumber.from(0).toString()
          );
        });

        it("...fails if pool is paused", async () => {
          before1stDepositSnapshotId = await network.provider.send(
            "evm_snapshot",
            []
          );
          expect(
            await protectionPoolCycleManager.getCurrentCycleState(
              protectionPool.address
            )
          ).to.equal(1); // 1 = Open

          // pause the pool
          await protectionPool.connect(deployer).pause();
          expect(await protectionPool.paused()).to.be.true;
          await expect(
            protectionPool.deposit(_underlyingAmount, deployerAddress)
          ).to.be.revertedWith("Pausable: paused");
        });

        it("...unpause the Pool contract", async () => {
          await protectionPool.unpause();
          expect(await protectionPool.paused()).to.be.false;
        });

        it("...fail if USDC is not approved", async () => {
          await expect(
            protectionPool.deposit(_underlyingAmount, deployerAddress)
          ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
        });

        it("...approve deposit amount to be transferred by deployer to the Pool contract", async () => {
          const _approvalAmt = _underlyingAmount;
          await expect(USDC.approve(protectionPool.address, _approvalAmt))
            .to.emit(USDC, "Approval")
            .withArgs(deployerAddress, protectionPool.address, _approvalAmt);

          expect(
            await USDC.allowance(deployerAddress, protectionPool.address)
          ).to.eq(_approvalAmt);
        });

        it("...fail if an SToken receiver is a zero address", async () => {
          await expect(
            protectionPool.deposit(_underlyingAmount, ZERO_ADDRESS)
          ).to.be.revertedWith("ERC20: mint to the zero address");
        });

        it("...1st deposit is successful", async () => {
          await depositAndVerify(deployer, _depositAmount);
        });

        it("...premium should not have accrued", async () => {
          expect((await protectionPool.getPoolDetails())[3]).to.be.eq(0);
        });

        it("...should have correct total seller deposit after 1st deposit", async () => {
          expect(await calculateTotalSellerDeposit()).to.eq(_underlyingAmount);
        });

        it("...movePoolPhase should not move to BuyProtectionOnly state when pool does NOT have min capital required", async () => {
          await expect(
            protectionPool.connect(deployer).movePoolPhase()
          ).to.not.emit(protectionPool, "ProtectionPoolPhaseUpdated");

          expect((await protectionPool.getPoolInfo()).currentPhase).to.eq(0); // 0 = Deposit Only
        });

        it("...2nd deposit by seller is successful", async () => {
          await depositAndVerify(seller, _depositAmount);
        });

        it("...should have correct total seller deposit after 2nd deposit", async () => {
          expect(await calculateTotalSellerDeposit()).to.eq(
            _underlyingAmount.mul(2)
          );
        });

        it("...3rd deposit by account 4 is successful", async () => {
          await depositAndVerify(account4, _depositAmount);
        });

        it("...should have correct total seller deposit after 3rd deposit", async () => {
          expect(await calculateTotalSellerDeposit()).to.eq(
            _underlyingAmount.mul(3)
          );
        });
      });

      describe("...buyProtection when pool is in DepositOnly phase", () => {
        it("...should fail", async () => {
          await expect(
            protectionPool.connect(_protectionBuyer1).buyProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 590,
                protectionAmount: parseUSDC("101"),
                protectionDurationInSeconds: getDaysInSeconds(30)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith(`ProtectionPoolInOpenToSellersPhase()`);
        });
      });

      describe("...movePoolPhase after deposits", () => {
        it("...should fail if caller is not owner", async () => {
          await expect(
            protectionPool.connect(account4).movePoolPhase()
          ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("...should succeed if caller is owner and pool has min capital required", async () => {
          await expect(protectionPool.connect(deployer).movePoolPhase())
            .to.emit(protectionPool, "ProtectionPoolPhaseUpdated")
            .withArgs(1); // 1 = BuyProtectionOnly

          expect((await protectionPool.getPoolInfo()).currentPhase).to.eq(1);
        });
      });

      describe("calculateLeverageRatio after deposits", () => {
        it("...should return 0 when pool has no protection sellers", async () => {
          expect(await protectionPool.calculateLeverageRatio()).to.equal(0);
        });
      });

      describe("Deposit after pool is in BuyProtectionOnly phase", () => {
        it("...should fail", async () => {
          await expect(
            protectionPool.deposit(parseUSDC("1001"), deployerAddress)
          ).to.be.revertedWith(`PoolInOpenToBuyersPhase()`);
        });
      });

      describe("...renewProtection before any protection", () => {
        it("...should fail", async () => {
          await expect(
            protectionPool.connect(_protectionBuyer1).renewProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 590,
                protectionAmount: parseUSDC("101"),
                protectionDurationInSeconds: getDaysInSeconds(30)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("NoExpiredProtectionToRenew");
        });
      });

      describe("buyProtection", () => {
        let _purchaseParams: ProtectionPurchaseParamsStruct;

        it("...fails if the lending pool is not supported/added", async () => {
          const _notSupportedLendingPool =
            "0xC13465CE9Ae3Aa184eB536F04FDc3f54D2dEf277";
          await expect(
            protectionPool.connect(deployer).buyProtection(
              {
                lendingPoolAddress: _notSupportedLendingPool,
                nftLpTokenId: 91,
                protectionAmount: parseUSDC("100"),
                protectionDurationInSeconds: getDaysInSeconds(30)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith(
            `LendingPoolNotSupported("${_notSupportedLendingPool}")`
          );
        });

        it("...pause the pool contract", async () => {
          await protectionPool.pause();
          expect(await protectionPool.paused()).to.be.true;
        });

        it("...fails if the pool contract is paused", async () => {
          await expect(
            protectionPool.connect(_protectionBuyer1).buyProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 583,
                protectionAmount: parseUSDC("101"),
                protectionDurationInSeconds: getDaysInSeconds(10)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("Pausable: paused");
        });

        it("...unpause the pool contract", async () => {
          await protectionPool.unpause();
          expect(await protectionPool.paused()).to.be.false;
        });

        it("...buyer should NOT have any active protection", async () => {
          expect(
            (
              await protectionPool.getActiveProtections(
                PROTECTION_BUYER1_ADDRESS
              )
            ).length
          ).to.eq(0);
        });

        it("...fail if USDC is not approved", async () => {
          await expect(
            protectionPool.connect(_protectionBuyer1).buyProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 590,
                protectionAmount: parseUSDC("101"),
                protectionDurationInSeconds: getDaysInSeconds(30)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
        });

        it("...approve 2500 USDC premium from protection buyer to the Pool contract", async () => {
          const _approvedAmt = parseUSDC("2500");
          expect(
            await USDC.connect(_protectionBuyer1).approve(
              protectionPool.address,
              _approvedAmt
            )
          )
            .to.emit(USDC, "Approval")
            .withArgs(
              PROTECTION_BUYER1_ADDRESS,
              protectionPool.address,
              _approvedAmt
            );

          const _allowanceAmount: number = await USDC.allowance(
            PROTECTION_BUYER1_ADDRESS,
            protectionPool.address
          );
          expect(_allowanceAmount).to.eq(_approvedAmt);
        });

        it("...fails when lending pool is not supported", async () => {
          await expect(
            protectionPool.connect(_protectionBuyer1).buyProtection(
              {
                lendingPoolAddress:
                  "0x759f097f3153f5d62ff1c2d82ba78b6350f223e3",
                nftLpTokenId: 590,
                protectionAmount: parseUSDC("101"),
                protectionDurationInSeconds: getDaysInSeconds(30)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith(
            `LendingPoolNotSupported("0x759f097f3153f5d62FF1C2D82bA78B6350F223e3")`
          );
        });

        it("...fails when buyer doesn't own lending NFT", async () => {
          await expect(
            protectionPool.connect(_protectionBuyer1).buyProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 591,
                protectionAmount: parseUSDC("101"),
                protectionDurationInSeconds: getDaysInSeconds(30)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("ProtectionPurchaseNotAllowed");
        });

        it("...fails when protection amount is higher than buyer's loan principal", async () => {
          await expect(
            protectionPool.connect(_protectionBuyer1).buyProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 590,
                protectionAmount: parseUSDC("500000"),
                protectionDurationInSeconds: getDaysInSeconds(30)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("ProtectionPurchaseNotAllowed");
        });

        it("...fails when protection expiry is after next pool cycle's end", async () => {
          // we are at day 1 of in cycle 1(30 days), so max possible expiry is 59 days from now
          await expect(
            protectionPool.connect(_protectionBuyer1).buyProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 590,
                protectionAmount: parseUSDC("50000"),
                protectionDurationInSeconds: getDaysInSeconds(60)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("ProtectionDurationTooLong");
        });

        it("...fails when  premium is higher than specified max protection premium amount", async () => {
          await expect(
            protectionPool.connect(_protectionBuyer1).buyProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 590,
                protectionAmount: parseUSDC("100000"),
                protectionDurationInSeconds: getDaysInSeconds(40)
              },
              parseUSDC("2181")
            )
          ).to.be.revertedWith("PremiumExceedsMaxPremiumAmount"); // actual premium: 2186.178950
        });

        it("...1st buy protection is successful", async () => {
          const _initialBuyerAccountId: BigNumber = BigNumber.from(1);
          const _initialPremiumAmountOfAccount: BigNumber = BigNumber.from(0);
          const _premiumTotalOfLendingPoolIdBefore: BigNumber = (
            await protectionPool.getLendingPoolDetail(_lendingPool2)
          )[0];
          const _premiumTotalBefore: BigNumber = (
            await protectionPool.getPoolDetails()
          )[2];
          const _expectedPremiumAmount = parseUSDC("2186.178950");

          const _protectionAmount = parseUSDC("100000"); // 100,000 USDC
          _purchaseParams = {
            lendingPoolAddress: _lendingPool2,
            nftLpTokenId: 590,
            protectionAmount: _protectionAmount,
            protectionDurationInSeconds: getDaysInSeconds(40)
          };

          const _poolUsdcBalanceBefore = await USDC.balanceOf(
            protectionPool.address
          );

          expect(
            await protectionPool
              .connect(_protectionBuyer1)
              .buyProtection(_purchaseParams, parseUSDC("10000"))
          )
            .emit(protectionPool, "PremiumAccrued")
            .to.emit(protectionPool, "BuyerAccountCreated")
            .withArgs(PROTECTION_BUYER1_ADDRESS, _initialBuyerAccountId)
            .to.emit(protectionPool, "CoverageBought")
            .withArgs(
              PROTECTION_BUYER1_ADDRESS,
              _lendingPool2,
              _protectionAmount
            );

          const _premiumAmountOfAccountAfter: BigNumber =
            await protectionPool.getTotalPremiumPaidForLendingPool(
              PROTECTION_BUYER1_ADDRESS,
              _lendingPool2
            );
          const _premiumTotalOfLendingPoolIdAfter: BigNumber = (
            await protectionPool.getLendingPoolDetail(_lendingPool2)
          )[1];
          const _premiumTotalAfter: BigNumber = (
            await protectionPool.getPoolDetails()
          )[2];
          expect(
            _premiumAmountOfAccountAfter.sub(_initialPremiumAmountOfAccount)
          ).to.eq(_expectedPremiumAmount);

          expect(_premiumTotalBefore.add(_expectedPremiumAmount)).to.eq(
            _premiumTotalAfter
          );
          expect(
            _premiumTotalOfLendingPoolIdBefore.add(_expectedPremiumAmount)
          ).to.eq(_premiumTotalOfLendingPoolIdAfter);
          expect((await protectionPool.getPoolDetails())[1]).to.eq(
            _protectionAmount
          );

          const _poolUsdcBalanceAfter = await USDC.balanceOf(
            protectionPool.address
          );
          expect(_poolUsdcBalanceAfter.sub(_poolUsdcBalanceBefore)).to.eq(
            _expectedPremiumAmount
          );
        });

        it("...buyer should have 1 active protection", async () => {
          expect(
            (
              await protectionPool.getActiveProtections(
                PROTECTION_BUYER1_ADDRESS
              )
            ).length
          ).to.eq(1);
        });
      });

      describe("calculateLeverageRatio after 3 deposits & 1 protection", () => {
        it("...should return correct leverage ratio", async () => {
          // 120K / 100K = 1.2
          expect(await protectionPool.calculateLeverageRatio()).to.eq(
            parseEther("1.2")
          );
        });
      });

      describe("calculateProtectionPremium after 3 deposits & 1 protection", () => {
        it("...should return correct protection premium", async () => {
          const [_premiumAmount, _isMinPremium] =
            await protectionPool.calculateProtectionPremium({
              lendingPoolAddress: _lendingPool2,
              nftLpTokenId: 590,
              protectionAmount: parseUSDC("100000"),
              protectionDurationInSeconds: getDaysInSeconds(40)
            });

          expect(_premiumAmount).to.eq(parseUSDC("2186.17895"));

          // leverage ratio is out of range, so min premium rate should be used
          expect(await protectionPool.calculateLeverageRatio()).to.be.gt(
            poolInfo.params.leverageRatioCeiling
          );
          expect(_isMinPremium).to.be.true;
        });
      });

      describe("...movePoolPhase + protection purchases", () => {
        before(async () => {
          // Impersonate accounts with lending pool positions
          _protectionBuyer2 = await ethers.getImpersonatedSigner(
            "0xcb726f13479963934e91b6f34b6e87ec69c21bb9"
          );
          _protectionBuyer3 = await ethers.getImpersonatedSigner(
            "0x5cd8c821c080b7340df6969252a979ed416a4e3f"
          );
          _protectionBuyer4 = await ethers.getImpersonatedSigner(
            "0x4902b20bb3b8e7776cbcdcb6e3397e7f6b4e449e"
          );

          // Transfer USDC to buyers from circle account
          // and approve premium to pool from these buyer accounts
          const _premiumAmount = parseUSDC("2000");
          for (const _buyer of [
            _protectionBuyer2,
            _protectionBuyer3,
            _protectionBuyer4
          ]) {
            await transferAndApproveUsdcToPool(_buyer, _premiumAmount);
          }
        });

        it("...should fail if caller is not owner", async () => {
          await expect(
            protectionPool.connect(seller).movePoolPhase()
          ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("...should not move to Open phase when leverage ratio is NOT below ceiling", async () => {
          expect((await protectionPool.getPoolInfo()).currentPhase).to.eq(1); // 1 = BuyProtectionOnly
          expect(await protectionPool.calculateLeverageRatio()).to.be.gt(
            poolInfo.params.leverageRatioCeiling
          );

          await expect(
            protectionPool.connect(deployer).movePoolPhase()
          ).to.not.emit(protectionPool, "ProtectionPoolPhaseUpdated");

          expect((await protectionPool.getPoolInfo()).currentPhase).to.eq(1); // 1 = BuyProtectionOnly
        });

        it("...add 2nd & 3rd protections", async () => {
          // Add bunch of protections
          // protection 2: buyer 2 has principal of 35K USDC with token id: 615
          await protectionPool.connect(_protectionBuyer2).buyProtection(
            {
              lendingPoolAddress: _lendingPool2,
              nftLpTokenId: 615,
              protectionAmount: parseUSDC("20000"),
              protectionDurationInSeconds: getDaysInSeconds(11)
            },
            parseUSDC("10000")
          );
          expect(
            (
              await protectionPool.getActiveProtections(
                await _protectionBuyer2.getAddress()
              )
            ).length
          ).to.be.eq(1);

          // protection 3: buyer 3 has principal of 63K USDC with token id: 579
          await protectionPool.connect(_protectionBuyer3).buyProtection(
            {
              lendingPoolAddress: _lendingPool2,
              nftLpTokenId: 579,
              protectionAmount: parseUSDC("30000"),
              protectionDurationInSeconds: getDaysInSeconds(30)
            },
            parseUSDC("10000")
          );
          expect(
            (
              await protectionPool.getActiveProtections(
                await _protectionBuyer3.getAddress()
              )
            ).length
          ).to.be.eq(1);

          expect((await protectionPool.getAllProtections()).length).to.be.eq(3);
          expect((await getActiveProtections()).length).to.eq(3);

          // 200K USDC = 100K + 20K + 30K
          expect((await protectionPool.getPoolDetails())[1]).to.eq(
            parseUSDC("150000")
          );
        });

        it("...should return correct leverage ratio", async () => {
          // 120K / 150K = 0.8
          expect(await protectionPool.calculateLeverageRatio()).to.eq(
            parseEther("0.8")
          );
        });

        it("...should succeed if caller is owner and leverage ratio is below ceiling", async () => {
          expect(await protectionPool.calculateLeverageRatio()).to.be.lt(
            poolInfo.params.leverageRatioCeiling
          );
          await expect(protectionPool.connect(deployer).movePoolPhase())
            .to.emit(protectionPool, "ProtectionPoolPhaseUpdated")
            .withArgs(2); // 2 = Open

          expect((await protectionPool.getPoolInfo()).currentPhase).to.eq(2);
        });

        // this unit test is successful but hardhat is failing to generate stacktrace to verify the revert reason
        xit("...4th deposit should fail because of LR breaching ceiling", async () => {
          const _depositAmt = parseUSDC("50000");
          await transferAndApproveUsdcToPool(deployer, _depositAmt);

          // LR = 170K / 150K = 1.13 > 1 (ceiling)
          await expect(
            protectionPool
              .connect(deployer)
              .deposit(_depositAmt, deployerAddress)
          ).to.be.revertedWith(`PoolLeverageRatioTooHigh(1133333333333333333)`);
        });

        it("...add 4th protection", async () => {
          // protection 4: buyer 4 has principal of 158K USDC with token id: 645 in pool
          await protectionPool.connect(_protectionBuyer4).buyProtection(
            {
              lendingPoolAddress: _goldfinchLendingPools[0],
              nftLpTokenId: 645,
              protectionAmount: parseUSDC("50000"),
              protectionDurationInSeconds: getDaysInSeconds(35)
            },
            parseUSDC("10000")
          );
          expect(
            (
              await protectionPool.getActiveProtections(
                await _protectionBuyer4.getAddress()
              )
            ).length
          ).to.be.eq(1);

          expect((await protectionPool.getAllProtections()).length).to.be.eq(4);
          expect((await getActiveProtections()).length).to.eq(4);

          // 200K USDC = 100K + 20K + 30K + 50K
          expect((await protectionPool.getPoolDetails())[1]).to.eq(
            parseUSDC("200000")
          );
        });

        it("...should return correct leverage ratio after 4th protection purchase", async () => {
          // 120K / 200K = 0.6
          expect(await protectionPool.calculateLeverageRatio()).to.eq(
            parseEther("0.6")
          );
        });

        it("...4th deposit should succeed as LR is within range", async () => {
          const _depositAmt = "20000";
          const _underlyingDepositAmt = parseUSDC(_depositAmt);
          await transferAndApproveUsdcToPool(account4, _underlyingDepositAmt);

          // LR = 140K / 200K = 0.7 < 1 (ceiling)
          await depositAndVerify(account4, _depositAmt);
        });
      });

      describe("calculateProtectionPremium with leverage ration within range", () => {
        it("...should return correct protection premium", async () => {
          const [_premiumAmount, _isMinPremium] =
            await protectionPool.calculateProtectionPremium({
              lendingPoolAddress: _lendingPool2,
              nftLpTokenId: 590,
              protectionAmount: parseUSDC("100000"),
              protectionDurationInSeconds: getDaysInSeconds(40)
            });
          expect(_premiumAmount).to.eq(parseUSDC("2186.17895"));

          // leverage ratio is out of range, so min premium rate should be used
          expect(await protectionPool.calculateLeverageRatio())
            .to.be.lt(poolInfo.params.leverageRatioCeiling)
            .and.gt(poolInfo.params.leverageRatioFloor);
          expect(_isMinPremium).to.be.false;
        });
      });

      const verifyTotalRequestedWithdrawal = async (
        _expectedTotalWithdrawal: BigNumber,
        _withdrawalCycleIndex: number
      ) => {
        expect(
          await protectionPool.getTotalRequestedWithdrawalAmount(
            _withdrawalCycleIndex
          )
        ).to.eq(_expectedTotalWithdrawal);
      };

      const verifyRequestedWithdrawal = async (
        _account: Signer,
        _expectedWithdrawal: BigNumber,
        _withdrawalCycleIndex: number
      ) => {
        expect(
          await protectionPool
            .connect(_account)
            .getRequestedWithdrawalAmount(_withdrawalCycleIndex)
        ).to.eq(_expectedWithdrawal);
      };

      describe("...requestWithdrawal", async () => {
        const WITHDRAWAL_CYCLE_INDEX = 2; // current pool cycle index + 2
        const _requestedTokenAmt1 = parseEther("11");
        const _requestedTokenAmt2 = parseEther("5");

        it("...fail when pool is paused", async () => {
          await protectionPool.connect(deployer).pause();
          expect(await protectionPool.paused()).to.be.true;
          const _tokenAmt = parseEther("1");
          await expect(
            protectionPool.requestWithdrawal(_tokenAmt)
          ).to.be.revertedWith("Pausable: paused");
        });

        it("...unpause the pool", async () => {
          await protectionPool.connect(deployer).unpause();
          expect(await protectionPool.paused()).to.be.false;
        });

        it("...fail when an user has zero balance", async () => {
          const _tokenAmt = parseEther("0.001");
          await expect(
            protectionPool.connect(buyer).requestWithdrawal(_tokenAmt)
          ).to.be.revertedWith(
            `InsufficientSTokenBalance("${buyerAddress}", 0)`
          );
        });

        it("...fail when withdrawal amount is higher than token balance", async () => {
          const _tokenBalance = await protectionPool.balanceOf(sellerAddress);
          const _tokenAmt = _tokenBalance.add(1);
          await expect(
            protectionPool.connect(seller).requestWithdrawal(_tokenAmt)
          ).to.be.revertedWith(
            `InsufficientSTokenBalance("${sellerAddress}", ${_tokenBalance})`
          );
        });

        it("...1st request is successful", async () => {
          await expect(
            protectionPool
              .connect(seller)
              .requestWithdrawal(_requestedTokenAmt1)
          )
            .to.emit(protectionPool, "WithdrawalRequested")
            .withArgs(
              sellerAddress,
              _requestedTokenAmt1,
              WITHDRAWAL_CYCLE_INDEX
            );

          await verifyRequestedWithdrawal(
            seller,
            _requestedTokenAmt1,
            WITHDRAWAL_CYCLE_INDEX
          );

          // withdrawal cycle's total sToken requested amount should be same as the requested amount
          await verifyTotalRequestedWithdrawal(
            _requestedTokenAmt1,
            WITHDRAWAL_CYCLE_INDEX
          );
        });

        it("...2nd request by same user should update existing request", async () => {
          await expect(
            protectionPool
              .connect(seller)
              .requestWithdrawal(_requestedTokenAmt2)
          )
            .to.emit(protectionPool, "WithdrawalRequested")
            .withArgs(
              sellerAddress,
              _requestedTokenAmt2,
              WITHDRAWAL_CYCLE_INDEX
            );

          await verifyRequestedWithdrawal(
            seller,
            _requestedTokenAmt2,
            WITHDRAWAL_CYCLE_INDEX
          );

          // withdrawal cycle's total sToken requested amount should be same as the new requested amount
          await verifyTotalRequestedWithdrawal(
            _requestedTokenAmt2,
            WITHDRAWAL_CYCLE_INDEX
          );
        });

        it("...fail when amount in updating request is higher than token balance", async () => {
          const _tokenBalance = await protectionPool.balanceOf(sellerAddress);
          const _tokenAmt = _tokenBalance.add(1);
          await expect(
            protectionPool.connect(seller).requestWithdrawal(_tokenAmt)
          ).to.be.revertedWith(
            `InsufficientSTokenBalance("${sellerAddress}", ${_tokenBalance})`
          );
        });

        it("...2nd withdrawal request by another user is successful", async () => {
          const _tokenBalance = await protectionPool.balanceOf(account4Address);
          await expect(
            protectionPool.connect(account4).requestWithdrawal(_tokenBalance)
          )
            .to.emit(protectionPool, "WithdrawalRequested")
            .withArgs(account4Address, _tokenBalance, WITHDRAWAL_CYCLE_INDEX);

          await verifyRequestedWithdrawal(
            account4,
            _tokenBalance,
            WITHDRAWAL_CYCLE_INDEX
          );
          await verifyTotalRequestedWithdrawal(
            _requestedTokenAmt2.add(_tokenBalance),
            WITHDRAWAL_CYCLE_INDEX
          );
        });
      });

      describe("...depositAndRequestWithdrawal", async () => {
        const WITHDRAWAL_CYCLE_INDEX = 2; // current pool cycle index + 2
        const _depositAmt = parseUSDC("11");
        const _withdrawalSTokenAmt1 = parseEther("11"); // same as deposit amount
        const _withdrawalSTokenAmt2 = parseEther("21");

        let newUser: Signer;
        let newUserAddress: string;

        before(async () => {
          newUser = (await ethers.getSigners())[5];
          newUserAddress = await newUser.getAddress();
        });

        it("...fail when pool is paused", async () => {
          await protectionPool.connect(deployer).pause();
          expect(await protectionPool.paused()).to.be.true;

          await expect(
            protectionPool.depositAndRequestWithdrawal(
              parseUSDC("1"),
              parseEther("1")
            )
          ).to.be.revertedWith("Pausable: paused");
        });

        it("...unpause the pool", async () => {
          await protectionPool.connect(deployer).unpause();
          expect(await protectionPool.paused()).to.be.false;
        });

        it("...fails when an user requests more than deposit", async () => {
          const _tokenBalance = await protectionPool.balanceOf(newUserAddress);
          expect(_tokenBalance).to.be.equal(0);

          const _depositAmt = parseUSDC("11");
          const _withdrawalSTokenAmt = parseEther("21");
          await transferAndApproveUsdcToPool(newUser, _depositAmt);

          await expect(
            protectionPool
              .connect(newUser)
              .depositAndRequestWithdrawal(_depositAmt, _withdrawalSTokenAmt)
          ).to.be.revertedWith(
            `InsufficientSTokenBalance("${await newUser.getAddress()}", ${parseEther(
              "11"
            )})`
          );
        });

        it("...fails when withdrawal amount is higher than token balance + deposit", async () => {
          const _sTokenBalance = await protectionPool.balanceOf(sellerAddress);
          const _depositAmt = parseUSDC("10");
          await transferAndApproveUsdcToPool(seller, _depositAmt);

          // withdrawal amount is balance + 10 + 1 (additional 1 to fail)
          const _withdrawalSTokenAmt = _sTokenBalance.add(parseEther("11"));

          await expect(
            protectionPool
              .connect(seller)
              .depositAndRequestWithdrawal(_depositAmt, _withdrawalSTokenAmt)
          ).to.be.revertedWith(
            `InsufficientSTokenBalance("${sellerAddress}", ${_sTokenBalance.add(
              parseEther("10")
            )})`
          );
        });

        it("... is successful when deposit and withdrawal is same", async () => {
          await transferAndApproveUsdcToPool(newUser, _depositAmt);

          const _totalRequestedWithdrawalBefore =
            await protectionPool.getTotalRequestedWithdrawalAmount(
              WITHDRAWAL_CYCLE_INDEX
            );

          await expect(
            protectionPool
              .connect(newUser)
              .depositAndRequestWithdrawal(_depositAmt, _withdrawalSTokenAmt1)
          )
            .to.emit(protectionPool, "ProtectionSold")
            .withArgs(newUserAddress, _depositAmt)
            .to.emit(protectionPool, "WithdrawalRequested")
            .withArgs(
              newUserAddress,
              _withdrawalSTokenAmt1,
              WITHDRAWAL_CYCLE_INDEX
            );

          await verifyRequestedWithdrawal(
            newUser,
            _withdrawalSTokenAmt1,
            WITHDRAWAL_CYCLE_INDEX
          );

          // withdrawal cycle's total sToken requested amount should be increased by the requested amount
          await verifyTotalRequestedWithdrawal(
            _totalRequestedWithdrawalBefore.add(_withdrawalSTokenAmt1),
            WITHDRAWAL_CYCLE_INDEX
          );
        });

        it("...2nd request by same user should update existing request", async () => {
          await transferAndApproveUsdcToPool(newUser, _depositAmt);

          const _totalRequestedWithdrawalBefore =
            await protectionPool.getTotalRequestedWithdrawalAmount(
              WITHDRAWAL_CYCLE_INDEX
            );

          await protectionPool
            .connect(newUser)
            .depositAndRequestWithdrawal(_depositAmt, _withdrawalSTokenAmt2);

          await verifyRequestedWithdrawal(
            newUser,
            _withdrawalSTokenAmt2,
            WITHDRAWAL_CYCLE_INDEX
          );

          // withdrawal cycle's total sToken requested amount should be increased by the requested amount
          await verifyTotalRequestedWithdrawal(
            _totalRequestedWithdrawalBefore.add(
              _withdrawalSTokenAmt2.sub(_withdrawalSTokenAmt1)
            ),
            WITHDRAWAL_CYCLE_INDEX
          );
        });

        it("...fail when amount in updating request is higher than token balance + deposit", async () => {
          const _tokenBalance = await protectionPool.balanceOf(newUserAddress);
          const _withdrawalSTokenAmt3 = _tokenBalance.add(parseEther("25"));
          await transferAndApproveUsdcToPool(newUser, _depositAmt);

          await expect(
            protectionPool
              .connect(newUser)
              .depositAndRequestWithdrawal(_depositAmt, _withdrawalSTokenAmt3)
          ).to.be.revertedWith(
            `InsufficientSTokenBalance("${newUserAddress}", ${_tokenBalance.add(
              parseEther("11")
            )})`
          );
        });
      });

      describe("...withdraw", async () => {
        it("...fails when pool is paused", async () => {
          await protectionPool.connect(deployer).pause();
          expect(await protectionPool.paused()).to.be.true;
          await expect(
            protectionPool.withdraw(parseEther("1"), deployerAddress)
          ).to.be.revertedWith("Pausable: paused");
        });

        it("...unpause the pool", async () => {
          await protectionPool.connect(deployer).unpause();
          expect(await protectionPool.paused()).to.be.false;
        });

        it("...fails because there was no previous cycle", async () => {
          const currentPoolCycle =
            await protectionPoolCycleManager.getCurrentPoolCycle(
              protectionPool.address
            );
          await expect(
            protectionPool.withdraw(parseEther("1"), deployerAddress)
          ).to.be.revertedWith(
            `NoWithdrawalRequested("${deployerAddress}", ${currentPoolCycle.currentCycleIndex})`
          );
        });
      });

      describe("pause", () => {
        it("...should allow the owner to pause contract", async () => {
          await expect(
            protectionPool.connect(owner).pause()
          ).to.be.revertedWith("Ownable: caller is not the owner");
          expect(await protectionPool.connect(deployer).pause()).to.emit(
            protectionPool,
            "Paused"
          );
          const _paused: boolean = await protectionPool.paused();
          expect(_paused).to.eq(true);
        });
      });

      describe("unpause", () => {
        it("...should allow the owner to unpause contract", async () => {
          await expect(
            protectionPool.connect(owner).unpause()
          ).to.be.revertedWith("Ownable: caller is not the owner");
          expect(await protectionPool.connect(deployer).unpause()).to.emit(
            protectionPool,
            "Unpaused"
          );
          const _paused: boolean = await protectionPool.paused();
          expect(_paused).to.eq(false);
        });
      });

      describe("accruePremiumAndExpireProtections", async () => {
        it("...should NOT accrue premium", async () => {
          // no premium should be accrued because there is no new payment
          await expect(
            protectionPool.accruePremiumAndExpireProtections([])
          ).to.not.emit(protectionPool, "PremiumAccrued");
        });

        it("...should accrue premium, expire protections & update last accrual timestamp", async () => {
          expect((await protectionPool.getPoolDetails())[3]).to.eq(0);
          const _totalSTokenUnderlyingBefore = (
            await protectionPool.getPoolDetails()
          )[0];

          /// Time needs to be moved ahead by 31 days to apply payment to lending pool
          await moveForwardTimeByDays(31);

          // pay to lending pool
          await payToLendingPoolAddress(_lendingPool2, "100000", USDC);
          await payToLendingPoolAddress(_lendingPool1, "100000", USDC);

          // accrue premium
          expect(await protectionPool.accruePremiumAndExpireProtections([]))
            .to.emit(protectionPool, "PremiumAccrued")
            .to.emit(protectionPool, "ProtectionExpired");

          // 1599.26 + 707.59 + 410.23 + 641.89 = ~3358.97
          const _expectedPremiumLowerBound = parseUSDC("3358.90");
          expect((await protectionPool.getPoolDetails())[3])
            .to.be.gt(_expectedPremiumLowerBound)
            .and.to.be.lt(parseUSDC("3359"));

          expect(
            (await protectionPool.getPoolDetails())[0].sub(
              _totalSTokenUnderlyingBefore
            )
          )
            .to.be.gt(_expectedPremiumLowerBound)
            .and.to.be.lt(parseUSDC("3359"));

          expect(
            (await protectionPool.getLendingPoolDetail(_lendingPool2))[0]
          ).to.be.eq(
            await referenceLendingPools.getLatestPaymentTimestamp(_lendingPool2)
          );

          expect(
            (await protectionPool.getLendingPoolDetail(_lendingPool1))[0]
          ).to.be.eq(
            await referenceLendingPools.getLatestPaymentTimestamp(_lendingPool1)
          );
        });

        it("...should mark protections 2 & 3 expired", async () => {
          // 2nd & 3rd protections should be marked expired
          const allProtections = await protectionPool.getAllProtections();
          expect(allProtections.length).to.be.eq(4);
          expect(allProtections[1].expired).to.eq(true);
          expect(allProtections[2].expired).to.eq(true);

          expect(
            (
              await protectionPool.getActiveProtections(
                await _protectionBuyer2.getAddress()
              )
            ).length
          ).to.be.eq(0);
          expect(
            (
              await protectionPool.getActiveProtections(
                await _protectionBuyer3.getAddress()
              )
            ).length
          ).to.be.eq(0);

          expect(await getActiveProtections()).to.have.lengthOf(2);
          expect(allProtections[0].expired).to.eq(false);
          expect(allProtections[3].expired).to.eq(false);
          expect((await protectionPool.getPoolDetails())[1]).to.eq(
            parseUSDC("150000")
          );
        });
      });

      describe("deposit after buyProtection", async () => {
        // this unit test is successful but hardhat is failing to generate stacktrace to verify the revert reason
        xit("...fails if it breaches leverage ratio ceiling", async () => {
          expect((await protectionPool.getPoolDetails())[1]).to.eq(
            parseUSDC("150000")
          );

          const depositAmt: BigNumber = parseUSDC("50000");
          await transferAndApproveUsdcToPool(deployer, depositAmt);
          await expect(
            protectionPool
              .connect(deployer)
              .deposit(depositAmt, deployerAddress)
          ).to.be.revertedWith("PoolLeverageRatioTooHigh");
        });

        it("...succeeds if leverage ratio is below ceiling", async () => {
          const _depositAmount = "5000";
          const _underlyingDepositAmount = parseUSDC(_depositAmount);
          await transferAndApproveUsdcToPool(
            deployer,
            _underlyingDepositAmount
          );
          await protectionPool
            .connect(deployer)
            .deposit(_underlyingDepositAmount, deployerAddress);

          // previous deposits: 140K, 22 and new deposit: 5K
          expect(await calculateTotalSellerDeposit()).to.eq(
            parseUSDC("145022")
          );
        });
      });

      describe("buyProtection after deposit", async () => {
        it("...succeeds when total protection is higher than min requirement and leverage ratio higher than floor", async () => {
          // Buyer 1 buys protection of 10K USDC, so approve premium to be paid
          await transferAndApproveUsdcToPool(
            _protectionBuyer1,
            parseUSDC("500")
          );
          await protectionPool.connect(_protectionBuyer1).buyProtection(
            {
              lendingPoolAddress: _lendingPool2,
              // see: https://lark.market/tokenDetail?tokenId=590
              nftLpTokenId: 590, // this token has 420K principal for buyer 1
              protectionAmount: parseUSDC("10000"),
              protectionDurationInSeconds: getDaysInSeconds(15)
            },
            parseUSDC("10000")
          );

          expect(await getActiveProtections()).to.have.lengthOf(3);
          expect((await protectionPool.getPoolDetails())[1]).to.eq(
            parseUSDC("160000")
          ); // 100K + 50K + 10K
        });
      });

      describe("renewProtection", () => {
        const _newProtectionAmt = parseUSDC("40000");
        let _newProtectionDurationInSeconds: BigNumber;
        let _expiredProtection3: ProtectionInfoStructOutput;
        let _renewalProtection: ProtectionInfoStructOutput;

        before(async () => {
          _expiredProtection3 = (await protectionPool.getAllProtections())[2];
        });

        it("...should fail when buyer doesn't have expired protection for the lending position - different NFT token id", async () => {
          // expired protection for _protectionBuyer3: lendingPool2, nftLpTokenId: 579
          await expect(
            protectionPool.connect(_protectionBuyer3).renewProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 591,
                protectionAmount: parseUSDC("101"),
                protectionDurationInSeconds: getDaysInSeconds(10)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("NoExpiredProtectionToRenew");
        });

        it("...should fail when buyer doesn't have expired protection for the lending position - different buyer", async () => {
          // existing protection for _protectionBuyer1: lendingPool2, nftLpTokenId: 590
          await expect(
            protectionPool.connect(owner).renewProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 579,
                protectionAmount: parseUSDC("101"),
                protectionDurationInSeconds: getDaysInSeconds(10)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("NoExpiredProtectionToRenew");
        });

        it("...should fail when buyer doesn't have expired protection for the lending position - different lending pool", async () => {
          // expired protection for _protectionBuyer3: lendingPool2, nftLpTokenId: 579
          await expect(
            protectionPool.connect(_protectionBuyer3).renewProtection(
              {
                lendingPoolAddress: _lendingPool1,
                nftLpTokenId: 590,
                protectionAmount: parseUSDC("101"),
                protectionDurationInSeconds: getDaysInSeconds(10)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("NoExpiredProtectionToRenew");
        });

        it("...should fail when protection extension's duration is longer than next pool cycle's end", async () => {
          // Day 31: we are in day 1 of pool cycle 2, so next pool cycle's(cycle 3) end is at 90 days
          // expired protection's duration is 30 days,
          // so protection extension's with > 60 days duration should fail
          _newProtectionDurationInSeconds = getDaysInSeconds(60) + 1;
          await expect(
            protectionPool.connect(_protectionBuyer3).renewProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 579,
                protectionAmount: parseUSDC("101"),
                protectionDurationInSeconds: _newProtectionDurationInSeconds
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("ProtectionDurationTooLong");
        });

        it("...should fail when premium is higher than specified maxProtectionPremium", async () => {
          await expect(
            protectionPool.connect(_protectionBuyer3).renewProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 579,
                protectionAmount: parseUSDC("40000"),
                protectionDurationInSeconds: getDaysInSeconds(59)
              },
              parseUSDC("901")
            )
          ).to.be.revertedWith("PremiumExceedsMaxPremiumAmount");
        });

        it("...should succeed for expired protection within grace period", async () => {
          await transferAndApproveUsdcToPool(
            _protectionBuyer3,
            parseUSDC("2000")
          );

          // Day 31: we are in day 1 of pool cycle 2, so next pool cycle's(cycle 3) end is at 90 days
          // expired protection's duration is 30 days,
          // so protection renewal with < 60 days duration should succeed
          _newProtectionDurationInSeconds = getDaysInSeconds(59);
          await protectionPool.connect(_protectionBuyer3).renewProtection(
            {
              lendingPoolAddress: _lendingPool2,
              nftLpTokenId: 579,
              protectionAmount: _newProtectionAmt,
              protectionDurationInSeconds: _newProtectionDurationInSeconds
            },
            parseUSDC("10000")
          );

          expect(await getActiveProtections()).to.have.lengthOf(4);
          expect((await protectionPool.getPoolDetails())[1]).to.eq(
            parseUSDC("200000")
          ); // 100K + 50K + 10K + 40K extension

          _renewalProtection = (await getActiveProtections())[3];
        });

        it("...protection extension should have new protection amount and duration", async () => {
          expect(_renewalProtection.purchaseParams.protectionAmount).to.eq(
            _newProtectionAmt
          );
          expect(
            _renewalProtection.purchaseParams.protectionDurationInSeconds
          ).to.eq(_newProtectionDurationInSeconds);
        });

        it("...protection renewal should start now", async () => {
          expect(_renewalProtection.startTimestamp).to.eq(
            await getLatestBlockTimestamp()
          );
        });

        it("...protection renewal's lending position must be same as existing protection", async () => {
          expect(_renewalProtection.purchaseParams.lendingPoolAddress).to.eq(
            _expiredProtection3.purchaseParams.lendingPoolAddress
          );
          expect(_renewalProtection.purchaseParams.nftLpTokenId).to.eq(
            _expiredProtection3.purchaseParams.nftLpTokenId
          );
        });

        it("...should fail when expired protection's grace period is over", async () => {
          await moveForwardTimeByDays(15); // grace period is 14 days

          await expect(
            protectionPool.connect(_protectionBuyer3).renewProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 579,
                protectionAmount: parseUSDC("101"),
                protectionDurationInSeconds: getDaysInSeconds(10)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("CanNotRenewProtectionAfterGracePeriod");
        });
      });

      describe("...before 1st pool cycle is locked", async () => {
        before(async () => {
          // Revert the state of the pool before 1st deposit
          expect(
            await network.provider.send("evm_revert", [
              before1stDepositSnapshotId
            ])
          ).to.eq(true);
        });

        it("...pool cycle should be in open state", async () => {
          await verifyPoolState(currentPoolCycleIndex, 1); // 1 = Open
        });

        it("...can deposit & create withdrawal requests", async () => {
          // create withdrawal requests (cycle after next: 2)
          const _withdrawalAmt = parseEther("10000");

          // Seller1: deposit 20K USDC & request withdrawal of 10K sTokens
          const _depositAmount1 = parseUSDC("20000");
          await transferAndApproveUsdcToPool(seller, _depositAmount1);
          await depositAndRequestWithdrawal(
            seller,
            sellerAddress,
            _depositAmount1,
            _withdrawalAmt
          );

          // Seller2: deposit 40K USDC & request withdrawal of 10K sTokens
          const _depositAmount2 = parseUSDC("40000");
          await transferAndApproveUsdcToPool(owner, _depositAmount2);
          await depositAndRequestWithdrawal(
            owner,
            ownerAddress,
            _depositAmount2,
            _withdrawalAmt
          );

          // Seller3: deposit 40K USDC & request withdrawal of 10K sTokens
          const _depositAmount3 = parseUSDC("40000");
          await transferAndApproveUsdcToPool(account4, _depositAmount3);
          await depositAndRequestWithdrawal(
            account4,
            account4Address,
            _depositAmount3,
            _withdrawalAmt
          );
        });

        it("...can move pool phase to 2nd phase", async () => {
          // after revert, we need to movePoolPhase after initial deposits
          await protectionPool.connect(deployer).movePoolPhase();
          expect((await protectionPool.getPoolInfo()).currentPhase).to.eq(1);
        });

        it("...can buy protections", async () => {
          // Day 1 of Pool cycle 1
          // protection 1 after reset: buyer 4 has principal of 158K USDC with token id: 645 in pool
          await USDC.connect(_protectionBuyer4).approve(
            protectionPool.address,
            parseUSDC("10000")
          );
          await protectionPool.connect(_protectionBuyer4).buyProtection(
            {
              lendingPoolAddress: _lendingPool1,
              nftLpTokenId: 645,
              protectionAmount: parseUSDC("70000"),
              protectionDurationInSeconds: getDaysInSeconds(35)
            },
            parseUSDC("10000")
          );

          await USDC.connect(_protectionBuyer1).approve(
            protectionPool.address,
            parseUSDC("10000")
          );
          await protectionPool.connect(_protectionBuyer1).buyProtection(
            {
              lendingPoolAddress: _lendingPool2,
              nftLpTokenId: 590,
              protectionAmount: parseUSDC("50000"),
              protectionDurationInSeconds: getDaysInSeconds(20)
            },
            parseUSDC("10000")
          );

          expect((await protectionPool.getAllProtections()).length).to.be.eq(2);
          expect((await getActiveProtections()).length).to.eq(2);

          // 100K USDC = 70K + 50K
          expect((await protectionPool.getPoolDetails())[1]).to.eq(
            parseUSDC("120000")
          );
        });

        it("...has correct total requested withdrawal & total sToken underlying", async () => {
          const _withdrawalCycleIndex = currentPoolCycleIndex + 2;

          expect(
            await protectionPool.getTotalRequestedWithdrawalAmount(
              _withdrawalCycleIndex
            )
          ).to.eq(parseEther("30000"));

          expect((await protectionPool.getPoolDetails())[0]).to.be.eq(
            parseUSDC("100000")
          ); // 3 deposits = 20K + 40K + 40K = 100K USDC
        });
      });

      describe("...1st pool cycle is locked", async () => {
        before(async () => {
          // we need to movePoolPhase
          await protectionPool.connect(deployer).movePoolPhase();
          // Pool should be in OPEN phase
          expect((await protectionPool.getPoolInfo()).currentPhase).to.eq(2);

          // Move pool cycle(open period: 10 days, total duration: 30 days) past 10 days to locked state
          // day 11: 11th day of cycle 1 as state is reverted to before 1st deposit
          await moveForwardTimeByDays(11);
        });

        it("...pool cycle should be in locked state", async () => {
          await verifyPoolState(currentPoolCycleIndex, 2); // 2 = Locked
        });

        it("...deposit should succeed", async () => {
          const _underlyingAmount = parseUSDC("100");

          await transferAndApproveUsdcToPool(seller, _underlyingAmount);
          await expect(
            protectionPool
              .connect(seller)
              .deposit(_underlyingAmount, sellerAddress)
          )
            .to.emit(protectionPool, "ProtectionSold")
            .withArgs(sellerAddress, _underlyingAmount);
        });

        it("...withdraw should fail", async () => {
          await expect(
            protectionPool.withdraw(parseUSDC("1"), deployerAddress)
          ).to.be.revertedWith(`PoolIsNotOpen()`);
        });
      });
    });

    describe("...2nd pool cycle", async () => {
      const currentPoolCycleIndex = 1;

      before(async () => {
        // Move pool cycle(10 days open period, 30 days total duration) to open state of 2nd cycle
        // day 31(20 + 11): 1st day of cycle 2
        await moveForwardTimeByDays(20);
      });

      describe("calculateMaxAllowedProtectionDuration", () => {
        it("...should return correct duration", async () => {
          await verifyMaxAllowedProtectionDuration();
        });
      });

      describe("...open period but no withdrawal", async () => {
        it("...pool cycle should be in open state", async () => {
          await verifyPoolState(currentPoolCycleIndex, 1); // 1 = Open
        });

        it("...fails when withdrawal is not requested", async () => {
          await expect(
            protectionPool.withdraw(parseEther("1"), deployerAddress)
          ).to.be.revertedWith(
            `NoWithdrawalRequested("${deployerAddress}", ${currentPoolCycleIndex})`
          );
        });

        it("...fails when withdrawal is requested just 1 cycle before", async () => {
          await expect(
            protectionPool
              .connect(seller)
              .withdraw(parseEther("1"), sellerAddress)
          ).to.be.revertedWith(
            `NoWithdrawalRequested("${sellerAddress}", ${currentPoolCycleIndex})`
          );
        });
      });

      describe("...2nd pool cycle is locked", async () => {
        before(async () => {
          // Move 2nd pool cycle(10 days open period, 30 days total duration) to locked state
          // day 42(31 + 11): 12th day of cycle 2
          await moveForwardTimeByDays(11);
        });

        it("...pool cycle should be in locked state", async () => {
          await verifyPoolState(currentPoolCycleIndex, 2); // 2 = Locked
        });

        it("...deposit should succeed", async () => {
          const _underlyingAmount = parseUSDC("100");

          await transferAndApproveUsdcToPool(seller, _underlyingAmount);
          await expect(
            protectionPool
              .connect(seller)
              .deposit(_underlyingAmount, sellerAddress)
          )
            .to.emit(protectionPool, "ProtectionSold")
            .withArgs(sellerAddress, _underlyingAmount);
        });

        it("...withdraw should fail", async () => {
          await expect(
            protectionPool.withdraw(parseUSDC("1"), deployerAddress)
          ).to.be.revertedWith(`PoolIsNotOpen()`);
        });
      });

      describe("...after 2nd pool cycle is locked", async () => {
        it("...can create withdrawal requests for cycle after", async () => {
          // Seller1: deposited 20K USDC in 1st cycle & requested to withdraw 10K. Now request withdrawal of 1000 sTokens
          await protectionPool
            .connect(seller)
            .requestWithdrawal(parseEther("1000"));
          // Seller2: deposited 40K USDC in 1st cycle & requested to withdraw 10K, now request withdrawal of 2000 sTokens
          await protectionPool
            .connect(owner)
            .requestWithdrawal(parseEther("2000"));
          // Seller3: deposited 40K USDC in 1st cycle & requested to withdraw 10K, now request withdrawal of 1000 sTokens
          await protectionPool
            .connect(account4)
            .requestWithdrawal(parseEther("1000"));
        });

        it("...has correct total requested withdrawal", async () => {
          const _withdrawalCycleIndex = currentPoolCycleIndex + 2;

          expect(
            await protectionPool.getTotalRequestedWithdrawalAmount(
              _withdrawalCycleIndex
            )
          ).to.eq(parseEther("4000"));
        });
      });

      describe("claimUnlockedCapital", async () => {
        let lendingPool2: ITranchedPool;
        let _expectedLockedCapital: BigNumber;
        let _totalSTokenUnderlyingBefore: BigNumber;

        const getLatestLockedCapital = async (_lendingPool: string) => {
          return (
            await defaultStateManager.getLockedCapitals(
              protectionPool.address,
              _lendingPool
            )
          )[0];
        };

        async function claimAndVerifyUnlockedCapital(
          account: Signer,
          success: boolean
        ): Promise<BigNumber> {
          const _address = await account.getAddress();
          const _expectedBalance = (await protectionPool.balanceOf(_address))
            .mul(_expectedLockedCapital)
            .div(await protectionPool.totalSupply());

          const _balanceBefore = await USDC.balanceOf(_address);
          await protectionPool.connect(account).claimUnlockedCapital(_address);
          const _balanceAfter = await USDC.balanceOf(_address);

          const _actualBalance = _balanceAfter.sub(_balanceBefore);
          if (success) {
            expect(_actualBalance).to.eq(_expectedBalance);
          }

          return _actualBalance;
        }

        before(async () => {
          snapshotId2 = await network.provider.send("evm_snapshot", []);

          lendingPool2 = (await ethers.getContractAt(
            "ITranchedPool",
            _lendingPool2
          )) as ITranchedPool;
          _totalSTokenUnderlyingBefore = (
            await protectionPool.getPoolDetails()
          )[0];
          _expectedLockedCapital = parseUSDC("50000");

          // pay lending pool 1
          await payToLendingPoolAddress(_lendingPool1, "1000000", USDC);

          // Verify exchange rate is 1 to 1
          expect(
            await protectionPool.convertToUnderlying(parseEther("1"))
          ).to.eq(parseUSDC("1"));

          // time has moved forward by more than 30 days, so lending pool 2 is late for payment
          // and state should be transitioned to "Late" and capital should be locked
          await expect(defaultStateManager.assessStates())
            .to.emit(defaultStateManager, "PoolStatesAssessed")
            .to.emit(defaultStateManager, "LendingPoolLocked");
        });

        it("...buyProtection fails when lending pool is late for payment", async () => {
          // day 42: time has moved forward by more than 30 days, so lending pool is late for payment
          await expect(
            protectionPool.connect(_protectionBuyer1).buyProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 590,
                protectionAmount: parseUSDC("101"),
                protectionDurationInSeconds: getDaysInSeconds(20)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith(
            `LendingPoolHasLatePayment("0xd09a57127BC40D680Be7cb061C2a6629Fe71AbEf")`
          );
        });

        it("...should have locked capital for lending pool 2 after missing a payment", async () => {
          // verify that lending pool 2's capital is locked
          const _lockedCapitalLP2 = await getLatestLockedCapital(_lendingPool2);
          expect(_lockedCapitalLP2.locked).to.be.true;

          // verify that locked capital is equal to total protection bought from lending pool 2
          expect(_lockedCapitalLP2.amount).to.be.eq(_expectedLockedCapital);
        });

        it("...should reduce total sToken underlying by locked capital", async () => {
          expect(
            _totalSTokenUnderlyingBefore.sub(
              (await protectionPool.getPoolDetails())[0]
            )
          ).to.eq(_expectedLockedCapital);
        });

        it("...should reduce sToken exchange rate", async () => {
          // Verify exchange rate is < 1
          expect(
            await protectionPool.convertToUnderlying(parseEther("1"))
          ).to.be.lt(parseUSDC("1"));
        });

        it("...should NOT have locked capital for lending pool 1 before unlocking lending pool 2", async () => {
          // verify that lending pool 1's capital is NOT locked
          const _lockedCapitalLP1 = await getLatestLockedCapital(_lendingPool1);
          expect(_lockedCapitalLP1).to.be.undefined;
        });

        it("...should have unlocked capital after 2 consecutive payments for lending pool 2", async () => {
          // Make 2 consecutive payments to 2nd lending pool
          for (let i = 0; i < 2; i++) {
            await moveForwardTimeByDays(30);
            await payToLendingPool(lendingPool2, "300000", USDC);

            // keep paying lending pool 1
            await payToLendingPoolAddress(_lendingPool1, "300000", USDC);

            if (i === 0) {
              await defaultStateManager.assessStateBatch([
                protectionPool.address
              ]);

              // verify that lending pool 2 is still in late state
              expect(
                await defaultStateManager.getLendingPoolStatus(
                  protectionPool.address,
                  _lendingPool2
                )
              ).to.be.eq(3); // Late
            } else {
              // after second payment, 2nd lending pool should move from Late to Active state
              await expect(
                defaultStateManager.assessStateBatch([protectionPool.address])
              )
                .to.emit(defaultStateManager, "PoolStatesAssessed")
                .to.emit(defaultStateManager, "LendingPoolUnlocked");

              expect(
                await defaultStateManager.getLendingPoolStatus(
                  protectionPool.address,
                  _lendingPool2
                )
              ).to.be.eq(1);
            }
          }

          // verify that lending pool capital is unlocked
          const _unlockedCapital = await getLatestLockedCapital(_lendingPool2);
          expect(_unlockedCapital.locked).to.be.false;

          // verify that unlocked capital is same as previously locked capital
          expect(_unlockedCapital.amount).to.be.eq(_expectedLockedCapital);
        });

        it("...should NOT have locked capital for lending pool 1 after unlocking lending pool 2", async () => {
          // verify that lending pool 1's capital is NOT locked
          const _lockedCapitalLP1 = await getLatestLockedCapital(_lendingPool1);
          expect(_lockedCapitalLP1).to.be.undefined;
        });

        it("...deployer should  NOT be able to claim", async () => {
          expect(await claimAndVerifyUnlockedCapital(deployer, false)).to.be.eq(
            0
          );
        });

        it("...seller should be  able to claim his share of unlocked capital from pool 1", async () => {
          expect(await claimAndVerifyUnlockedCapital(seller, true)).to.be.gt(0);
        });

        it("...seller should  NOT be able to claim again", async () => {
          expect(await claimAndVerifyUnlockedCapital(seller, false)).to.be.eq(
            0
          );
        });

        it("...owner should be  able to claim his share of unlocked capital from pool 1", async () => {
          expect(await claimAndVerifyUnlockedCapital(owner, true)).to.be.gt(0);
        });

        it("...owner should  NOT be able to claim again", async () => {
          expect(await claimAndVerifyUnlockedCapital(owner, false)).to.be.eq(0);
        });

        it("...account 4 should be  able to claim his share of unlocked capital from pool 1", async () => {
          expect(await claimAndVerifyUnlockedCapital(account4, true)).to.be.gt(
            0
          );
        });

        it("...account 4 should  NOT be able to claim again", async () => {
          expect(await claimAndVerifyUnlockedCapital(account4, false)).to.be.eq(
            0
          );
        });

        it("...has correct total underlying amount", async () => {
          // 5 deposits = 20K + 40K + 40K + 100 + 100 - 50K of locked capital
          expect((await protectionPool.getPoolDetails())[0]).to.eq(
            parseUSDC("50200")
          );
        });
      });

      describe("buyProtection after lock/unlock", async () => {
        before(async () => {
          // revert to snapshot
          expect(
            await network.provider.send("evm_revert", [snapshotId2])
          ).to.be.eq(true);

          snapshotId2 = await network.provider.send("evm_snapshot", []);

          await payToLendingPoolAddress(_lendingPool1, "1000000", USDC);
          await payToLendingPoolAddress(_lendingPool2, "1000000", USDC);
        });

        it("...has correct total underlying amount", async () => {
          // 5 deposits = 20K + 40K + 40K + 100 + 100
          expect((await protectionPool.getPoolDetails())[0]).to.eq(
            parseUSDC("100200")
          );
        });

        it("...accrue premium and expire protections", async () => {
          // should expire 2 protections
          expect((await getActiveProtections()).length).to.eq(2);
          await protectionPool.accruePremiumAndExpireProtections([]);
          expect((await getActiveProtections()).length).to.eq(0);
        });

        it("...can buy protections", async () => {
          // Day 42: 12th day of Pool cycle 2
          // protection 4: buyer 4 has principal of 158K USDC with token id: 645 in pool
          await USDC.connect(_protectionBuyer4).approve(
            protectionPool.address,
            parseUSDC("10000")
          );
          await protectionPool.connect(_protectionBuyer4).buyProtection(
            {
              lendingPoolAddress: _lendingPool1,
              nftLpTokenId: 645,
              protectionAmount: parseUSDC("70000"),
              protectionDurationInSeconds: getDaysInSeconds(35)
            },
            parseUSDC("10000")
          );

          expect((await protectionPool.getAllProtections()).length).to.be.eq(3);
          expect((await getActiveProtections()).length).to.eq(1);
          expect((await protectionPool.getPoolDetails())[1]).to.eq(
            parseUSDC("70000")
          );
        });
      });

      describe("renewProtection after purchase limit", async () => {
        it("...renewProtection should fail when protection renewal's duration is longer than 3rd pool cycle's end", async () => {
          // we are in day 42: 12th day of pool cycle 2, so next(3rd) pool cycle's end is after 48 days at 90 days
          // expired protection's(protection after revert) duration is 35 days,
          // so protection renewal with > 13 days duration should fail
          const _newProtectionDurationInSeconds = getDaysInSeconds(13) + 1;
          await expect(
            protectionPool.connect(_protectionBuyer4).renewProtection(
              {
                lendingPoolAddress: _lendingPool1,
                nftLpTokenId: 645,
                protectionAmount: parseUSDC("101"),
                protectionDurationInSeconds: _newProtectionDurationInSeconds
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("ProtectionDurationTooLong");
        });

        it("...renewProtection should succeed when duration is less than 3rd pool cycle end", async () => {
          expect(
            (
              await protectionPool.getActiveProtections(
                await _protectionBuyer4.getAddress()
              )
            ).length
          ).to.be.eq(1);

          await protectionPool.connect(_protectionBuyer4).renewProtection(
            {
              lendingPoolAddress: _lendingPool1,
              nftLpTokenId: 645,
              protectionAmount: parseUSDC("20000"),
              protectionDurationInSeconds: getDaysInSeconds(13)
            },
            parseUSDC("10000")
          );

          expect(
            (
              await protectionPool.getActiveProtections(
                await _protectionBuyer4.getAddress()
              )
            ).length
          ).to.be.eq(2);
        });
      });
    });

    describe("...3rd pool cycle", async () => {
      const currentPoolCycleIndex = 2;

      before(async () => {
        // Move pool cycle(10 days open period, 30 days total duration) to open state (next pool cycle)
        // day 62(42 + 20): 2nd day of cycle 3
        await moveForwardTimeByDays(20);
      });

      describe("calculateMaxAllowedProtectionDuration", () => {
        it("...should return correct duration", async () => {
          await verifyMaxAllowedProtectionDuration();
        });
      });

      describe("...open period with withdrawal", async () => {
        it("...pool cycle should be in open state", async () => {
          await verifyPoolState(currentPoolCycleIndex, 1); // 1 = Open
        });

        it("...has correct total requested withdrawal amount", async () => {
          expect(
            await protectionPool.getTotalRequestedWithdrawalAmount(
              currentPoolCycleIndex
            )
          ).to.eq(parseEther("30000"));
        });

        it("...has correct total underlying amount", async () => {
          expect((await protectionPool.getPoolDetails())[0]).to.be.gt(
            parseUSDC("50200")
          ); // 5 deposits = 20K + 40K + 40K + 100 + 100 - 50K of locked capital + accrued premium
        });

        it("...fails when withdrawal amount is higher than requested amount", async () => {
          // Seller has requested 10K sTokens in 1st cycle
          const withdrawalAmt = parseEther("10001");
          await expect(
            protectionPool
              .connect(seller)
              .withdraw(withdrawalAmt, sellerAddress)
          ).to.be.revertedWith(
            `WithdrawalHigherThanRequested("${sellerAddress}", ${parseEther(
              "10000"
            ).toString()})`
          );
        });

        it("...is successful for 1st seller", async () => {
          // Seller has requested 10K sTokens in previous cycle
          const withdrawalAmt = parseEther("10000");
          await verifyWithdrawal(seller, withdrawalAmt);
        });

        it("...fails for second withdrawal by 1st seller", async () => {
          // Seller has withdrawn all requested tokens, so withdrawal request should be removed
          expect(
            await protectionPool
              .connect(seller)
              .getRequestedWithdrawalAmount(currentPoolCycleIndex)
          ).to.eq(0);
          await expect(
            protectionPool
              .connect(seller)
              .withdraw(parseEther("1"), sellerAddress)
          ).to.be.revertedWith(
            `NoWithdrawalRequested("${sellerAddress}", ${currentPoolCycleIndex})`
          );
        });

        it("...is successful for 2nd seller", async () => {
          // 2nd seller (Owner account) has requested 10K sTokens in 1st cycle
          const withdrawalAmt = parseEther("10000");
          await verifyWithdrawal(owner, withdrawalAmt);
        });

        it("...fails for second withdrawal by 2nd seller", async () => {
          // 2nd Seller(Owner account) has withdrawn all requested tokens, so withdrawal request should be removed
          expect(
            await protectionPool
              .connect(owner)
              .getRequestedWithdrawalAmount(currentPoolCycleIndex)
          ).to.eq(0);
          await expect(
            protectionPool
              .connect(owner)
              .withdraw(parseEther("1"), ownerAddress)
          ).to.be.revertedWith(
            `NoWithdrawalRequested("${ownerAddress}", ${currentPoolCycleIndex})`
          );
        });

        it("...is successful for 3rd seller with 2 transactions", async () => {
          const sTokenBalanceBefore = await protectionPool.balanceOf(
            account4Address
          );
          // 3rd seller (Account4) has requested total 10K sTokens in 1st cycle,
          // so partial withdrawal should be possible
          await verifyWithdrawal(account4, parseEther("6000"));
          await verifyWithdrawal(account4, parseEther("3000"));
        });

        it("...fails for third withdrawal by 3rd seller", async () => {
          // 3rd Seller(account4) has withdrawn 9000 out of 10K requested tokens,
          // so withdrawal request should exist with 1000 sTokens remaining
          expect(
            await protectionPool
              .connect(account4)
              .getRequestedWithdrawalAmount(currentPoolCycleIndex)
          ).to.eq(parseEther("1000"));
          // withdrawing more(1001) sTokens than remaining requested should fail
          await expect(
            protectionPool
              .connect(account4)
              .withdraw(parseEther("1001"), account4Address)
          ).to.be.revertedWith(
            `WithdrawalHigherThanRequested("${account4Address}", ${parseEther(
              "1000"
            )})`
          );
        });
      });

      describe("buyProtection after protection purchase limit", async () => {
        it("...should fail because of protection purchase limit for new buyer", async () => {
          // make lending pool payment current, so buyProtection should NOT fail for late payment,
          // but it should fail for NEW buyer because of protection purchase limit: past 60 days
          await payToLendingPoolAddress(_lendingPool2, "1000000", USDC);
          // protection 3: buyer 3 has principal of 63K USDC with token id: 579
          expect(
            (
              await protectionPool.getActiveProtections(
                await _protectionBuyer3.getAddress()
              )
            ).length
          ).to.be.eq(0);
          await expect(
            protectionPool.connect(_protectionBuyer3).buyProtection(
              {
                lendingPoolAddress: _lendingPool2,
                nftLpTokenId: 579,
                protectionAmount: parseUSDC("30000"),
                protectionDurationInSeconds: getDaysInSeconds(30)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("ProtectionPurchaseNotAllowed");
        });

        it("...should fail because of PoolLeverageRatioTooLow", async () => {
          // lending pool protection purchase limit is 90 days
          await payToLendingPoolAddress(_lendingPool1, "1000000", USDC);
          expect(
            (
              await protectionPool.getActiveProtections(
                await _protectionBuyer4.getAddress()
              )
            ).length
          ).to.be.eq(2);

          await expect(
            protectionPool.connect(_protectionBuyer4).buyProtection(
              {
                lendingPoolAddress: _lendingPool1,
                nftLpTokenId: 645,
                protectionAmount: parseUSDC("60000"),
                protectionDurationInSeconds: getDaysInSeconds(11)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("PoolLeverageRatioTooLow");
        });

        it("...deposit should succeed in open phase after lock/unlock", async () => {
          const _totalSTokenUnderlyingBefore = (
            await protectionPool.getPoolDetails()
          )[0];

          const _depositAmount = parseUSDC("10000");
          await transferAndApproveUsdcToPool(deployer, _depositAmount);
          await protectionPool
            .connect(deployer)
            .deposit(_depositAmount, deployerAddress);

          const _totalSTokenUnderlyingAfter = (
            await protectionPool.getPoolDetails()
          )[0];
          expect(
            _totalSTokenUnderlyingAfter.sub(_totalSTokenUnderlyingBefore)
          ).to.be.eq(_depositAmount);
        });
      });

      describe("buyProtection after after adding new lending pool", async () => {
        const _lendingPool3 = "0x89d7c618a4eef3065da8ad684859a547548e6169";
        const _protectionBuyerAddress =
          "0x3371E5ff5aE3f1979074bE4c5828E71dF51d299c";
        let _protectionBuyer: Signer;

        before(async () => {
          _protectionBuyer = await ethers.getImpersonatedSigner(
            _protectionBuyerAddress
          );

          // Ensure lending pool is current on payment
          await payToLendingPoolAddress(_lendingPool3, "3000000", USDC);
          await referenceLendingPools
            .connect(deployer)
            .addReferenceLendingPool(_lendingPool3, 0, 30);

          expect(
            (await referenceLendingPools.getLendingPools()).length
          ).to.be.eq(3);

          await defaultStateManager.assessStates();
        });

        it("...buyProtection in new pool should succeed", async () => {
          expect(
            (await protectionPool.getActiveProtections(_protectionBuyerAddress))
              .length
          ).to.be.eq(0);

          await deployer.sendTransaction({
            to: _protectionBuyerAddress,
            value: ethers.utils.parseEther("10")
          });

          await transferAndApproveUsdcToPool(
            _protectionBuyer,
            parseUSDC("1000")
          );
          await protectionPool.connect(_protectionBuyer).buyProtection(
            {
              lendingPoolAddress: _lendingPool3,
              nftLpTokenId: 717,
              protectionAmount: parseUSDC("30000"),
              protectionDurationInSeconds: getDaysInSeconds(30)
            },
            parseUSDC("10000")
          );

          expect(
            (await protectionPool.getActiveProtections(_protectionBuyerAddress))
              .length
          ).to.be.eq(1);
        });

        it("...buyProtection in new pool should fail when pool is in LateWithinGracePeriod state", async () => {
          // Ensure lending pool is late on payment
          const lastPaymentTimestamp =
            await referenceLendingPools.getLatestPaymentTimestamp(
              _lendingPool3
            );

          await setNextBlockTimestamp(
            lastPaymentTimestamp.add(getDaysInSeconds(30).add(60 * 60)) // late by 1 hour
          );

          await defaultStateManager.assessStates();
          await expect(
            protectionPool.connect(_protectionBuyer).buyProtection(
              {
                lendingPoolAddress: _lendingPool3,
                nftLpTokenId: 717,
                protectionAmount: parseUSDC("30000"),
                protectionDurationInSeconds: getDaysInSeconds(30)
              },
              parseUSDC("10000")
            )
          ).to.be.revertedWith("LendingPoolHasLatePayment");
        });
      });
    });

    describe("updateLeverageRatioParams", () => {
      const _newBuffer = parseEther("0.06");

      it("...should revert when called by non-owner", async () => {
        await expect(
          protectionPool
            .connect(account4)
            .updateLeverageRatioParams(_newFloor, _newCeiling, _newBuffer)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("...should be updatable by owner", async () => {
        await protectionPool
          .connect(deployer)
          .updateLeverageRatioParams(_newFloor, _newCeiling, _newBuffer);

        const poolInfo = await protectionPool.getPoolInfo();
        expect(poolInfo.params.leverageRatioFloor).to.eq(_newFloor);
        expect(poolInfo.params.leverageRatioCeiling).to.eq(_newCeiling);
        expect(poolInfo.params.leverageRatioBuffer).to.eq(_newBuffer);
      });
    });

    describe("updateRiskPremiumParams", () => {
      const _newCurvature = parseEther("0.06");
      const _newMinCarapaceRiskPremiumPercent = parseEther("0.04");
      const _newUnderlyingRiskPremiumPercent = parseEther("0.12");

      it("...should revert when called by non-owner", async () => {
        await expect(
          protectionPool
            .connect(account4)
            .updateRiskPremiumParams(
              _newCurvature,
              _newMinCarapaceRiskPremiumPercent,
              _newUnderlyingRiskPremiumPercent
            )
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("...should be updatable by owner", async () => {
        await protectionPool
          .connect(deployer)
          .updateRiskPremiumParams(
            _newCurvature,
            _newMinCarapaceRiskPremiumPercent,
            _newUnderlyingRiskPremiumPercent
          );

        const poolInfo = await protectionPool.getPoolInfo();
        expect(poolInfo.params.curvature).to.eq(_newCurvature);
        expect(poolInfo.params.minCarapaceRiskPremiumPercent).to.eq(
          _newMinCarapaceRiskPremiumPercent
        );
        expect(poolInfo.params.underlyingRiskPremiumPercent).to.eq(
          _newUnderlyingRiskPremiumPercent
        );
      });
    });

    describe("updateMinRequiredCapital", () => {
      const _newMinRequiredCapital = parseUSDC("110000");
      it("...should revert when called by non-owner", async () => {
        await expect(
          protectionPool
            .connect(account4)
            .updateMinRequiredCapital(_newMinRequiredCapital)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("...should be updatable by owner", async () => {
        await protectionPool
          .connect(deployer)
          .updateMinRequiredCapital(_newMinRequiredCapital);

        const poolInfo = await protectionPool.getPoolInfo();
        expect(poolInfo.params.minRequiredCapital).to.eq(
          _newMinRequiredCapital
        );
      });
    });

    describe("upgrade", () => {
      const LENDING_POOL_4 = "0x759f097f3153f5d62ff1c2d82ba78b6350f223e3";

      let upgradedPool: ProtectionPoolV2;
      let poolV2ImplementationAddress: string;
      let poolV2Factory: ContractFactory;

      before(async () => {
        poolV2Factory = await getPoolContractFactory("ProtectionPoolV2");

        // Forces the import of an existing proxy deployment to be used with hardhat upgrades plugin
        // because the proxy was deployed by ContractFactory and noy using the hardhat upgrades plugin
        await upgrades.forceImport(
          protectionPool.address,
          await getPoolContractFactory()
        );
      });

      it("...should revert when upgradeTo is called by non-owner", async () => {
        await expect(
          protectionPool
            .connect(account4)
            .upgradeTo("0xA18173d6cf19e4Cc5a7F63780Fe4738b12E8b781")
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("...should fail upon invalid upgrade", async () => {
        try {
          await upgrades.validateUpgrade(
            protectionPool.address,
            await ethers.getContractFactory("ProtectionPoolV2NotUpgradable"),
            {
              kind: "uups"
            }
          );
        } catch (e: any) {
          expect(e.message).includes(
            "Contract `contracts/test/ProtectionPoolV2.sol:ProtectionPoolV2NotUpgradable` is not upgrade safe"
          );
        }
      });

      it("...should be valid upgrade", async () => {
        await upgrades.validateUpgrade(protectionPool.address, poolV2Factory, {
          kind: "uups",
          unsafeAllowLinkedLibraries: true
        });
      });

      it("...should upgrade successfully", async () => {
        const poolV2Impl = await poolV2Factory.deploy();
        await poolV2Impl.deployed();
        poolV2ImplementationAddress = poolV2Impl.address;

        await protectionPool
          .connect(deployer)
          .upgradeTo(poolV2ImplementationAddress);

        // upgrade to v2
        upgradedPool = poolV2Factory.attach(
          protectionPool.address
        ) as ProtectionPoolV2;
      });

      it("...should have new implementation address after upgrade", async () => {
        expect(
          await upgrades.erc1967.getImplementationAddress(upgradedPool.address)
        ).to.be.equal(poolV2ImplementationAddress);
      });

      it("...should be able to call existing function in v1", async () => {
        expect((await protectionPool.getPoolDetails())[1]).to.equal(
          parseUSDC("120000")
        );
      });

      it("...should be able to retrieve from existing storage", async () => {
        expect(await upgradedPool.getAllProtections()).to.have.lengthOf(5);
      });

      it("...should be able to set/get new state variable in v2", async () => {
        expect(await upgradedPool.testMapping(LENDING_POOL_4)).to.eq(0);
        await upgradedPool.addToTestMapping(LENDING_POOL_4, 42);
        expect(await upgradedPool.testMapping(LENDING_POOL_4)).to.eq(42);
      });
    });

    after(async () => {
      // Revert the EVM state before pool cycle tests in "before 1st pool cycle is locked"
      // to revert the time forwarded in the tests

      expect(await network.provider.send("evm_revert", [snapshotId2])).to.be.eq(
        true
      );

      await protectionPool.accruePremiumAndExpireProtections([]);
    });
  });
};

export { testProtectionPool };
