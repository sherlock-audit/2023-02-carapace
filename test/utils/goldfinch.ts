import { parseUSDC, impersonateCircle } from "../utils/usdc";
import { Contract, Signer } from "ethers";
import { ITranchedPool } from "../../typechain-types/contracts/external/goldfinch/ITranchedPool";
import { ethers } from "hardhat";

const payToLendingPool: Function = async (
  tranchedPool: ITranchedPool,
  amount: string,
  usdcContract: Contract
) => {
  const amountToPay = parseUSDC(amount);

  // Transfer USDC to lending pool's credit line
  await usdcContract
    .connect(await impersonateCircle())
    .transfer(await tranchedPool.creditLine(), amountToPay.toString());

  // assess lending pool
  await tranchedPool.assess();
};

const payToLendingPoolAddress: Function = async (
  tranchedPoolAddress: string,
  amount: string,
  usdcContract: Contract
) => {
  const tranchedPool = (await ethers.getContractAt(
    "ITranchedPool",
    tranchedPoolAddress
  )) as ITranchedPool;

  await payToLendingPool(tranchedPool, amount, usdcContract);
};

// 420K principal for token 590
const getGoldfinchLender1: Function = async (): Promise<Signer> => {
  return await ethers.getImpersonatedSigner(
    "0x008c84421da5527f462886cec43d2717b686a7e4"
  );
};

export { payToLendingPool, payToLendingPoolAddress, getGoldfinchLender1 };
