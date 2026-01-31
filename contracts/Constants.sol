// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Shared constants for ArbEmpire contracts
library Constants {
    // Uniswap V3 Infra
    address constant UNI_V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    bytes32 constant POOL_INIT_CODE_HASH = 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54;
    address constant ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address constant POS_MGR = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
    address constant QUOTER = 0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6;

    // Stargate
    address constant STARGATE = 0x53Bf833A5d6c4ddA888F69c22C88C9f356a41614;
    uint16 constant BSC_CHAIN_ID = 102;
    uint256 constant ETH_POOL_ID = 1;
    uint256 constant BNB_POOL_ID = 2;

    // Aave
    address constant AAVE_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD; // Aave V3 Pool on Arbitrum

    // ARBITRUM MAINNET ADDRESSES
    address constant USDC = 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8;
    address constant USDT = 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9;
    address constant DAI = 0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1;
    address constant USDC_E = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant FRAX = 0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F;
    address constant MIM = 0xFEa7a6a0B346362BF88A9e4A88416B77a57D6c2A;

    address constant WETH = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
    address constant WBTC = 0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f;
    address constant wstETH = 0x5979D7b546E38E414F7E9822514be443A4800529;

    address constant ARB = 0x912CE59144191C1204E64559FE8253a0e49E6548;
    address constant LINK = 0xf97f4df75117a78c1A5a0DBb814Af92458539FB4;
    address constant UNI = 0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0;
    address constant SUSHI = 0xd4d42F0b6DEF4CE0383636770eF773390d85c61A;
    address constant GMX = 0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a;
    address constant LDO = 0x13ad51ed4F1b7e9Dc168D8a00cB3f4ddD85Eff60;

    address constant MAGIC = 0x539bdE0d7Dbd336b79148AA742883198BBF60342;
    address constant GRAIL = 0x3d9907F9a368ad0a51Be60f7Da3b97cf940982D8;
    address constant PENDLE = 0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8;
    address constant DPX = 0x6C2c06790B3E3e3c40e1586e93c219220f539B01;
    address constant RDNT = 0x0C4681e6C0235179ec3D4F4fc4DF3d14FDD96017;

    address constant AAVE = 0xba5DdD1f9d7F570dc94a51479a000E3BCE967196;
    address constant CRV = 0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978;
    address constant PEPE = 0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00;
    address constant BONK = 0x09199D9A5F4448d0848e4395D065e1A1C5A5263f;
    address constant STETH = 0x5979D7b546E38E414F7E9822514be443A4800529;
    address constant SXAU = 0x9D5f8C42F21d0234eFF8274de832C6E123c2B46a;

    // XAU/USD Gold Token and Oracle
    address constant XAU_USD_ORACLE = 0x214FD7E4A9733E4F08C1a4a9f19A7CE7A9C5b8d9;
    address constant XAU_TOKEN = 0x2BA8349123de45E941a136e6D766c90b288B3D09; // PAXG on Arbitrum

    // Fees and Limits
    uint256 constant DEV_FEE_BPS = 500; // 5%
    uint256 constant MIN_PROFIT_BP = 100; // 1% minimum
    uint256 constant SLIPPAGE_BP = 50; // 0.5%
    uint256 constant STALE_SEC = 3600; // 1 hour

    // Pool Fees
    uint24 constant FEE_001 = 100;  // 0.01%
    uint24 constant FEE_005 = 500;  // 0.05%
    uint24 constant FEE_030 = 3000; // 0.3%

    // Oracles (Arbitrum Chainlink)
    function getOracle(address token) internal pure returns (address) {
        if (token == USDC) return 0x50834f3163758fCC1Df9973B6e91f0f0f0434AD6;
        if (token == USDT) return 0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7;
        if (token == WBTC) return 0x6ce185860a4963106506C203335A2910413708e9;
        if (token == WETH) return 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612;
        if (token == LINK) return 0x86E53cF1B870786351165d955b07ed0F7f4c3d2b;
        if (token == UNI)  return 0x9C917083fDb403ab5ADbEC26Ee294f6EcAda2720;
        if (token == AAVE) return 0xaD1d5344AaDE45F43E596773Bcc4c423EAbdD034;
        if (token == ARB)  return 0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6;
        if (token == LDO)  return 0xa43A34030088e6510EeCf95376B516FcE9b74B57;
        if (token == CRV)  return 0xaebDA2c976cfd1eE1977Eac079B4382acb849325;
        if (token == STETH)return 0x07D91F22e0Bf718E8110C96b1d7EA6b465c4997a;
        if (token == SXAU) return 0x8F383361A85268365259F3a8824c3f1d9BC4f9A0;
        if (token == XAU_TOKEN) return XAU_USD_ORACLE;
        return address(0); // No oracle
    }

    // Pool Fees
    function getFee(address tokenA, address tokenB) internal pure returns (uint24) {
        bytes32 key = keccak256(abi.encodePacked(tokenA < tokenB ? tokenA : tokenB, tokenA < tokenB ? tokenB : tokenA));
        if (key == keccak256(abi.encodePacked(USDC, USDT))) return FEE_001;
        if (key == keccak256(abi.encodePacked(USDC, DAI))) return FEE_001;
        if (key == keccak256(abi.encodePacked(USDT, DAI))) return FEE_001;
        if (key == keccak256(abi.encodePacked(USDC, USDC_E))) return FEE_001;
        if (key == keccak256(abi.encodePacked(USDC, FRAX))) return FEE_001;
        if (key == keccak256(abi.encodePacked(USDC, MIM))) return FEE_001;
        // Add more stable pairs
        if (key == keccak256(abi.encodePacked(WBTC, WETH))) return FEE_030;
        if (key == keccak256(abi.encodePacked(WETH, ARB))) return FEE_030;
        if (key == keccak256(abi.encodePacked(WETH, LINK))) return FEE_030;
        // Default
        return FEE_005;
    }

    // Pool Addresses (Arbitrum Uniswap V3)
    function getPool(address tokenA, address tokenB) internal pure returns (address) {
        bytes32 key = keccak256(abi.encodePacked(tokenA < tokenB ? tokenA : tokenB, tokenA < tokenB ? tokenB : tokenA));
        if (key == keccak256(abi.encodePacked(USDC, USDT))) return 0x6c60E6Ab82D73491e345FC3333D3C875211e5f3F; // 0.01%
        if (key == keccak256(abi.encodePacked(USDC, WETH))) return 0x03f73225F2a68e94F23752F8384D9e5A1E5A1A98; // 0.05%
        if (key == keccak256(abi.encodePacked(WBTC, WETH))) return 0x2f5e87C9312fa29aed5c179E456625D79015299c; // 0.3%
        if (key == keccak256(abi.encodePacked(LINK, WETH))) return 0x4A5A2a152E985078e1a4Aa9C3362c7B8ae3D1a5f; // 0.3%
        if (key == keccak256(abi.encodePacked(ARB, WETH)))  return 0x0d4D12115904c50e02333028B4D8d75A76247315; // 0.3%
        if (key == keccak256(abi.encodePacked(DAI, USDC)))  return 0xbE3aD6a5669Dc0B8b12FeBC03608860C31E2eef6; // 0.01%
        return address(0);
    }
}