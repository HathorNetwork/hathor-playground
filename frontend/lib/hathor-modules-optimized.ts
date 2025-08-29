/**
 * Optimized Hathor modules list for nano contract execution only
 * Reduced from 488 to ~150 modules (70% reduction)
 * Excludes: CLI, P2P, Wallet, WebSocket, Mining, API endpoints, etc.
 */

// Get all nanocontract modules from the original list
import { HATHOR_MODULES } from './hathor-modules';

// Core essential modules
const CORE_MODULES = [
  'hathor/__init__.py',
  'hathor/types.py', 
  'hathor/version.py',
  'hathor/exception.py',
  'hathor/util.py',
  'hathor/log.py',
];

// Transaction handling essentials
const TRANSACTION_MODULES = [
  'hathor/transaction/__init__.py',
  'hathor/transaction/base_transaction.py',
  'hathor/transaction/transaction.py',
  'hathor/transaction/types.py',
  'hathor/transaction/util.py',
  'hathor/transaction/vertex_parser.py',
  'hathor/transaction/scripts/__init__.py',
  'hathor/transaction/scripts/base_script.py',
  'hathor/transaction/scripts/script.py',
  'hathor/transaction/scripts/p2pkh.py',
  'hathor/transaction/scripts/multisig.py',
  'hathor/transaction/scripts/nano_contract_execute.py',
  'hathor/transaction/scripts/nano_contract_match_values.py',
];

// Configuration essentials  
const CONFIG_MODULES = [
  'hathor/conf/__init__.py',
  'hathor/conf/get_settings.py',
  'hathor/conf/mainnet.yml',
  'hathor/conf/testnet.yml',
];

// Crypto essentials
const CRYPTO_MODULES = [
  'hathor/crypto/__init__.py',
  'hathor/crypto/util.py',
];

// Verification essentials
const VERIFICATION_MODULES = [
  'hathor/verification/__init__.py',
  'hathor/verification/vertex_verifier.py',
  'hathor/verification/verification_service.py',
];

// Get all nanocontracts modules (all are needed)
const NANOCONTRACT_MODULES = HATHOR_MODULES.filter(module => 
  module.includes('nanocontracts')
);

// Get all serialization modules (all are needed for data handling)
const SERIALIZATION_MODULES = HATHOR_MODULES.filter(module => 
  module.includes('serialization')
);

// Get all utils modules (lightweight utility functions)
const UTILS_MODULES = HATHOR_MODULES.filter(module => 
  module.includes('utils/')
);

// Combine all essential modules
export const NANO_CONTRACT_MODULES = [
  ...CORE_MODULES,
  ...TRANSACTION_MODULES, 
  ...CONFIG_MODULES,
  ...CRYPTO_MODULES,
  ...VERIFICATION_MODULES,
  ...NANOCONTRACT_MODULES,
  ...SERIALIZATION_MODULES,
  ...UTILS_MODULES,
].filter((module, index, array) => 
  // Remove duplicates and ensure all modules exist in original list
  array.indexOf(module) === index && HATHOR_MODULES.includes(module)
);
