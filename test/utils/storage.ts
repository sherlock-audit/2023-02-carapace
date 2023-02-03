import { BigNumber } from "@ethersproject/bignumber";
import { ethers } from "hardhat";

const toBytes32 = (bn: BigNumber): string => {
  return ethers.utils.hexlify(ethers.utils.zeroPad(bn.toHexString(), 32));
};

const setStorageAt = async (address: string, index: number, value: string) => {
  await ethers.provider.send("hardhat_setStorageAt", [
    address,
    ethers.utils.hexValue(index),
    value
  ]);
  await ethers.provider.send("evm_mine", []); // Just mines to the next block
};

const getStorageAt = async (contractAddress: string, slot: number) => {
  return await ethers.provider.getStorageAt(contractAddress, slot);
};

export { getStorageAt, setStorageAt, toBytes32 };
