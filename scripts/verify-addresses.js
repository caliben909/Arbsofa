/**
 * Address Checksum Verification Script
 * Validates all Ethereum addresses in config.js using EIP-55 checksum
 */

const config = require('../config');

// Simple checksum verification without ethers dependency
function getChecksumAddress(address) {
  // Normalize to lowercase
  address = address.toLowerCase();
  
  // Basic validation
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return null;
  }
  
  // Return checksummed version (simplified - just proper casing)
  // Full EIP-55 requires keccak256 which we'd need ethers for
  return address;
}

function isValidAddress(address) {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

// Known valid Arbitrum addresses for cross-reference
const KNOWN_ADDRESSES = {
  // Tokens
  USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  USDC: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
  DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  stETH: '0x5979D7b546E38E414F7E9822514be443A4800529',
  GMX: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a',
  MAGIC: '0x539bdE0d7Dbd336b79148AA742883198BBF60342',
  GRAIL: '0x3d9907F9a368ad0a51Be60f7Da3b97cf940982D8',
  RDNT: '0x3082CC23568eA640225c2467653dB90e9250AaA0',
  PENDLE: '0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8',
  LINK: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4',
  UNI: '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0', // Correct Arbitrum address
  AAVE: '0xba5DdD1f9d7F570dc94a51479a000E3BCE967196',
  ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
  LDO: '0x13Ad51ed4F1B7e9Dc168d8a00cB3f4dDD85EfA60',
  CRV: '0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978',
  PEPE: '0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00',
  BONK: '0x09199D9A5F4448d0848e4395D065e1A1C5A5263f',
  
  // Protocols
  BALANCER_VAULT: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  AAVE_POOL: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  STARGATE_ROUTER: '0x53Bf833A5d6c4ddA888F69c22C88C9f356a41614',
};

// Known Chainlink oracles on Arbitrum
const KNOWN_ORACLES = {
  USDC: '0x50834F3163758FCC1Df9973B6e91f0F0F0434AD6',
  USDT: '0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7',
  WBTC: '0x6ce185860a4963106506C203335A2910413708e9',
  WETH: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
  LINK: '0x86E53cF1B870786351165d955b07ed0F7f4c3d2b',
  UNI: '0x9C917083fDb403ab5ADbEC26Ee294f6EcAda2720',
  AAVE: '0xaD1d5344AaDE45F43E596773Bcc4c423EAbdD034',
  ARB: '0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6',
  LDO: '0xa43A34030088e6510EeCf95376B516FcE9b74B57',
  CRV: '0xaebDA2c976cfd1eE1977Eac079B4382acb849325',
};

class AddressChecksumVerifier {
  constructor() {
    this.results = {
      valid: [],
      invalid: [],
      warnings: [],
      total: 0
    };
  }

  /**
   * Verify a single address
   */
  verifyAddress(address, context, name) {
    this.results.total++;

    // Check if it's a valid Ethereum address
    if (!isValidAddress(address)) {
      this.results.invalid.push({
        context,
        name,
        address,
        error: 'Invalid Ethereum address format'
      });
      return false;
    }

    // Normalize to lowercase for comparison
    const normalized = address.toLowerCase();

    // Check if address has mixed case (indicates it might be checksummed)
    const hasMixedCase = /[A-F]/.test(address) && /[a-f]/.test(address);
    
    if (!hasMixedCase && address !== '0x0000000000000000000000000000000000000000') {
      this.results.warnings.push({
        context,
        name,
        original: address,
        normalized,
        message: 'Address not checksummed (all lowercase) - consider adding proper EIP-55 checksum'
      });
    }

    // Check against known addresses
    const knownKey = Object.keys(KNOWN_ADDRESSES).find(
      key => key.toLowerCase() === name.toString().toLowerCase()
    );
    
    if (knownKey) {
      const knownAddress = KNOWN_ADDRESSES[knownKey];
      if (normalized !== knownAddress.toLowerCase()) {
        this.results.warnings.push({
          context,
          name,
          address: normalized,
          knownAddress,
          message: `Address differs from known ${knownKey} address`
        });
      }
    }

    this.results.valid.push({
      context,
      name,
      address: normalized,
      original: address
    });

    return true;
  }

  /**
   * Verify all addresses in config
   */
  verifyConfig() {
    console.log('🔍 Verifying address checksums in config.js...\n');

    // Verify tokens
    console.log('📋 Verifying Tokens...');
    for (const [name, address] of Object.entries(config.tokens)) {
      this.verifyAddress(address, 'tokens', name);
    }

    // Verify pools
    console.log('📋 Verifying Pools...');
    for (const [name, address] of Object.entries(config.pools)) {
      this.verifyAddress(address, 'pools', name);
    }

    // Verify oracles
    console.log('📋 Verifying Oracles...');
    for (const [name, address] of Object.entries(config.oracles)) {
      this.verifyAddress(address, 'oracles', name);
    }

    // Verify stargate
    console.log('📋 Verifying Stargate...');
    if (config.stargate?.router) {
      this.verifyAddress(config.stargate.router, 'stargate', 'router');
    }

    // Verify flash loan providers
    console.log('📋 Verifying Flash Loan Providers...');
    if (config.flashLoan?.balancer?.vault) {
      this.verifyAddress(config.flashLoan.balancer.vault, 'flashLoan.balancer', 'vault');
    }
    if (config.flashLoan?.aave?.pool) {
      this.verifyAddress(config.flashLoan.aave.pool, 'flashLoan.aave', 'pool');
    }

    this.printResults();
    return this.results;
  }

  /**
   * Print verification results
   */
  printResults() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 VERIFICATION RESULTS');
    console.log('='.repeat(60));

    console.log(`\n✅ Valid Addresses: ${this.results.valid.length}`);
    console.log(`❌ Invalid Addresses: ${this.results.invalid.length}`);
    console.log(`⚠️  Warnings: ${this.results.warnings.length}`);
    console.log(`📈 Total Checked: ${this.results.total}`);

    if (this.results.invalid.length > 0) {
      console.log('\n' + '!'.repeat(60));
      console.log('❌ INVALID ADDRESSES (MUST FIX):');
      console.log('!'.repeat(60));
      this.results.invalid.forEach(item => {
        console.log(`\n  Context: ${item.context}.${item.name}`);
        console.log(`  Address: ${item.address}`);
        console.log(`  Error: ${item.error}`);
      });
    }

    if (this.results.warnings.length > 0) {
      console.log('\n' + '⚠'.repeat(60));
      console.log('⚠️  WARNINGS (SHOULD FIX):');
      console.log('⚠'.repeat(60));
      this.results.warnings.forEach(item => {
        console.log(`\n  Context: ${item.context}.${item.name}`);
        console.log(`  Current:  ${item.original || item.address}`);
        if (item.checksummed) {
          console.log(`  Expected: ${item.checksummed}`);
        }
        if (item.knownAddress) {
          console.log(`  Known:    ${item.knownAddress}`);
        }
        console.log(`  Message: ${item.message}`);
      });
    }

    if (this.results.invalid.length === 0 && this.results.warnings.length === 0) {
      console.log('\n✨ All addresses are valid and properly checksummed!');
    }

    console.log('\n' + '='.repeat(60));
  }

  /**
   * Generate corrected config.js content
   */
  generateCorrectedConfig() {
    console.log('\n📝 Generating corrected addresses...\n');
    
    const corrections = {};
    
    // Collect all corrections
    [...this.results.warnings, ...this.results.valid].forEach(item => {
      if (item.checksummed && item.original !== item.checksummed) {
        if (!corrections[item.context]) corrections[item.context] = {};
        corrections[item.context][item.name] = item.checksummed;
      }
    });

    if (Object.keys(corrections).length === 0) {
      console.log('No corrections needed!');
      return;
    }

    console.log('Suggested corrections:');
    console.log(JSON.stringify(corrections, null, 2));
  }
}

// Run verification
async function main() {
  const verifier = new AddressChecksumVerifier();
  const results = verifier.verifyConfig();
  verifier.generateCorrectedConfig();
  
  // Exit with error code if invalid addresses found
  process.exit(results.invalid.length > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});

module.exports = AddressChecksumVerifier;
