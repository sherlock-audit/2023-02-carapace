import { Contract, Signer } from "ethers";
import { BigNumber } from "@ethersproject/bignumber";
import { formatUnits, parseUnits } from "ethers/lib/utils";
import {
  CIRCLE_ACCOUNT_ADDRESS,
  USDC_NUM_OF_DECIMALS,
  USDC_ADDRESS,
  USDC_ABI
} from "../utils/constants";
import { ethers } from "hardhat";

const formatUSDC: Function = (usdcAmt: BigNumber): string => {
  return formatUnits(usdcAmt, USDC_NUM_OF_DECIMALS);
};

const parseUSDC: Function = (usdcAmtText: string): BigNumber => {
  return parseUnits(usdcAmtText, USDC_NUM_OF_DECIMALS);
};

const getUsdcContract: Function = (signer: Signer) => {
  return new Contract(USDC_ADDRESS, USDC_ABI, signer);
};

const impersonateCircle: Function = async (): Promise<Signer> => {
  return await ethers.getImpersonatedSigner(CIRCLE_ACCOUNT_ADDRESS);
};

const transferAndApproveUsdc = async (
  _approver: Signer,
  _amount: BigNumber,
  _receiver: string
) => {
  const _circleAccount = await impersonateCircle();
  const _usdcContract = getUsdcContract(_circleAccount);

  await _usdcContract.transfer(await _approver.getAddress(), _amount);
  await _usdcContract.connect(_approver).approve(_receiver, _amount);
};

export {
  formatUSDC,
  parseUSDC,
  getUsdcContract,
  impersonateCircle,
  transferAndApproveUsdc
};
