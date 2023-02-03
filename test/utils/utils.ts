import { Signer } from "ethers";
import { ethers } from "hardhat";
import { deployer } from "../../utils/deploy";

export const impersonateSignerWithEth = async (
  address: string,
  ethValue: string
): Promise<Signer> => {
  const signer = await ethers.getImpersonatedSigner(address);
  // send ethValue to address
  await transferEth(deployer, address, ethValue);
  return signer;
};

export const transferEth = async (
  sender: Signer,
  receiverAddress: string,
  ethValue: string
) => {
  await sender.sendTransaction({
    to: receiverAddress,
    value: ethers.utils.parseEther(ethValue)
  });
};
