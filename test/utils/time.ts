import { BigNumber } from "@ethersproject/bignumber";
import { ethers, network } from "hardhat";
import { SECONDS_PER_DAY } from "./constants";

const getUnixTimestampOfSomeMonthAhead: Function = async (
  months: number
): Promise<number> => {
  let _expirationTime: number;
  let _date: Date = new Date();
  // Set the date to some months later
  _date.setMonth(_date.getMonth() + months);
  // Zero the time component
  _date.setHours(0, 0, 0, 0);
  // Get the time value in milliseconds and convert to seconds
  _expirationTime = _date.getTime() / 1000;
  return _expirationTime;
};

/**
 * Returns future timestamp by adding specified number of days to the current timestamp in seconds
 * @param days
 * @returns
 */
const getUnixTimestampAheadByDays: Function = async (
  days: number
): Promise<number> => {
  return (await getLatestBlockTimestamp()) + days * SECONDS_PER_DAY;
};

/**
 * Moves forward time by specified number of seconds and mines the block
 * @param _seconds in seconds
 */
const moveForwardTime: Function = async (_seconds: BigNumber) => {
  await network.provider.send("evm_increaseTime", [_seconds.toNumber()]);
  await network.provider.send("evm_mine", []);
};

/**
 * Moves forward time by specified number of days and mines the block
 * @param _days in seconds
 */
const moveForwardTimeByDays: Function = async (_days: number) => {
  await moveForwardTime(getDaysInSeconds(_days));
};

const getDaysInSeconds: Function = (days: number): BigNumber => {
  return BigNumber.from(days * SECONDS_PER_DAY);
};

const getLatestBlockTimestamp: Function = async (): Promise<number> => {
  return (await ethers.provider.getBlock("latest")).timestamp;
};

// set next block timestamp
const setNextBlockTimestamp: Function = async (timestamp: BigNumber) => {
  await network.provider.send("evm_setNextBlockTimestamp", [
    timestamp.toNumber()
  ]);
  await network.provider.send("evm_mine", []);
};

export {
  getUnixTimestampOfSomeMonthAhead,
  getUnixTimestampAheadByDays,
  moveForwardTime,
  getDaysInSeconds,
  getLatestBlockTimestamp,
  moveForwardTimeByDays,
  setNextBlockTimestamp
};
