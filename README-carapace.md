# Carapace Documentation

- Whitepaper: https://www.carapace.finance/WhitePaper
- User Docs: https://www.carapace.finance/docs/

# Carapace Smart Contracts

- Overview of smart contracts and their interactions:
  https://docs.google.com/document/d/1RihHcf-jS45BorVufVm4aYdXdQ65CaOxtW6ljz8DCOs

# Local Development

## Setup

1. This project uses following technology stack:

- [Node](https://nodejs.org/en/download/) (version: 16.15)
- [NPM](https://docs.npmjs.com/about-npm) (version: 9.4)
- [Hardhat](https://hardhat.org/getting-started/) (version: 2.10)
- [Solidity](https://docs.soliditylang.org/en/v0.8.17/) (version: 0.8.17)
- [OpenZeppelin](https://docs.openzeppelin.com/contracts/4.x/) (version: 4.8)
- [Typescript](https://www.typescriptlang.org/) (version: 4.7)
- [Waffle](https://ethereum-waffle.readthedocs.io/en/latest/) (version: 3.4)
- [Ethers](https://docs.ethers.io/v5/) (Version: 5)

2. Clone this repo and npm install

```bash
$ git clone https://github.com/carapace-finance/credit-default-swaps-contracts
$ cd credit-default-swaps-contracts
$ npm install
```

3. Create an [Alchemy](https://www.alchemy.com/) account. You will need an API key to run tests.

4. Declare environment variables

We encourage you to declare environment variables in your `.bash_profile`(or .zprofile and others) to avoid sharing your credentials accidentally. You can also make `.env` file in the root of this repository although we do not recommend it.

```bash
export ALCHEMY_API_KEY = <alchemy_api_key>
export MNEMONIC_WORDS = <mnemonic_words>
export WALLET_INITIAL_INDEX = "0"
```

- We recommend obtaining your mnemonic words from MetaMask and storing in `MNEMONIC_WORDS` so that you can use the same account when you test a dapp. Each word should be divided by space.

- You can keep `ETHERSCAN_API_KEY` empty until you deploy to the mainnet.

You are ready to write code!

## Solidity Code Style

All smart contracts use mixedCase for state variable names and function names. All other variables are prefixed with an underscore.
This is done to easily spot the state variables.

## NPM Scripts

```bash
// compiles your contracts and generate artifacts and cache.
$ npm run compile

// runs the default network configured in the `hardhat.config.ts`.
$ npm run node

// deploys your contracts to the mirrored version of the mainnet in your local network.
$ npm run deploy:mainnet_forked

// runs test in the test directory.
$ npm run test

// generate a code coverage report for testing.
$ npm run cover

// generate a documentation from NatSpec comments.
$ npm run doc
```
