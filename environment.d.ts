declare namespace NodeJS {
  export interface ProcessEnv {
    ALCHEMY_API_KEY: string;
    INFURA_API_KEY: string;
    TENDERLY_ETH_MAINNET_FORK_URL: string;
    DEPLOYMENT_ACCOUNT_PRIVATE_KEY: string;
    MNEMONIC_WORDS: string;
    WALLET_INITIAL_INDEX: string;
    ETHERSCAN_API_KEY: string;
    FIRST_POOL_SALT: string;
    SECOND_POOL_SALT: string;
  }
}
