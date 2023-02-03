import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@solidstate/hardhat-bytecode-exporter";
import "@tenderly/hardhat-tenderly";
import "@typechain/ethers-v5";
import "@typechain/hardhat";
import "solidity-coverage";
import "@primitivefi/hardhat-dodoc";
import "dotenv/config";
import "hardhat-abi-exporter";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import "hardhat-storage-layout";
import "@openzeppelin/hardhat-upgrades";

const { ALCHEMY_API_KEY, ETHERSCAN_API_KEY } = process.env;

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
        // url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
        // 09/23/2022: We are pinning to this block number to avoid goldfinch pool & token position changes
        blockNumber: 15598870
      },
      gas: "auto", // gasLimit
      gasPrice: 259000000000, // check the latest gas price market in https://www.ethgasstation.info/
      allowUnlimitedContractSize: false
    },
    mainnet: {
      url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
      gas: "auto", // gasLimit
      gasPrice: 41000000000 // check the latest gas price market in https://www.ethgasstation.info/
      // inject: false, // optional. If true, it will EXPOSE your mnemonic in your frontend code. Then it would be available as an "in-page browser wallet" / signer which can sign without confirmation.
      // accounts: [`0x${DEPLOYMENT_ACCOUNT_PRIVATE_KEY}`]
    }
  },
  solidity: {
    version: "0.8.17",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000
      },
      outputSelection: {
        "*": {
          "*": ["storageLayout"]
        }
      }
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: 2000000
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY
  },
  dodoc: {
    runOnCompile: false,
    debugMode: true
  },
  gasReporter: {
    enabled: false
  },
  abiExporter: {
    flat: true,
    format: "json"
  },
  bytecodeExporter: {
    path: "./bytecode",
    flat: true
  }
};

export default config;
