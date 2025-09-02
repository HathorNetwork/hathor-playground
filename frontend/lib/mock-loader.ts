/**
 * Mock loader for Hathor modules
 * Provides mock Python code for browser compatibility
 */

import { rocksdbSetupMock } from './mocks/rocksdb';
import { cryptographySetupMock } from './mocks/cryptography';
import { twistedSetupMock } from './mocks/twisted';
import { zopeSetupMock } from './mocks/zope';
import { pycoinSetupMock } from './mocks/pycoin';

import { reactorMock } from './mocks/reactor';
import { versionMock } from './mocks/version';
import { settingsMock } from './mocks/settings';
import { onChainBlueprintMock } from './mocks/on-chain-blueprint';
import { transactionStorageMock } from './mocks/transaction-storage';
import { utilsMock } from './mocks/utils';
import { rngMock } from './mocks/rng';


export class MockLoader {
  private static mocks: Record<string, string> = {
    version: versionMock,
    reactor: reactorMock,
    settings: settingsMock,
    on_chain_blueprint: onChainBlueprintMock,
    transaction_storage: transactionStorageMock,
    utils: utilsMock,
    rng: rngMock,
  };

  private static setupMocks: Record<string, string> = {
    twisted: twistedSetupMock,
    zope: zopeSetupMock,
    rocksdb: rocksdbSetupMock,
    cryptography: cryptographySetupMock,
    pycoin: pycoinSetupMock,
  };

  /**
   * Load a mock file by name
   */
  static loadMock(mockName: string): string {
    return this.mocks[mockName] || `# Stub module for browser compatibility\npass`;
  }

  /**
   * Get mock setup code for initializing complex mock modules
   */
  static getSetupMock(mockName: string): string {
    return this.setupMocks[mockName] || '';
  }

  /**
   * Get all setup mocks as a single script
   */
  static getAllSetupMocks(): string {
    return Object.values(this.setupMocks).join('\n\n');
  }

  /**
   * Get mock content for a specific Hathor module path
   */
  static getMockForPath(filePath: string): string | null {
    if (filePath === 'hathor/version.py') {
      return this.loadMock('version');
    }
    
    if (filePath.includes('hathor/nanocontracts/utils.py')) {
      return this.loadMock('utils');
    }
    
    if (filePath.includes('hathor/nanocontracts/rng.py')) {
      return this.loadMock('rng');
    }
    
    if (filePath.includes('hathor/reactor/reactor.py')) {
      return this.loadMock('reactor');
    }
    
    // on_chain_blueprint is now loaded as real module since we have cryptography
    // if (filePath.includes('hathor/nanocontracts/on_chain_blueprint.py')) {
    //   return this.loadMock('on_chain_blueprint');
    // }
    
    if (filePath.includes('hathor/transaction/storage/transaction_storage.py')) {
      return this.loadMock('transaction_storage');
    }
    
    //if (filePath.includes('hathor/conf/settings.py')) {
    //  return this.loadMock('settings');
    //}

    return null; // No mock needed for this path
  }

  /**
   * Check if a file path needs mocking
   */
  static needsMocking(filePath: string): boolean {
    const problematicModules = [
      'hathor/cli/run_node.py', // Uses twisted reactor
      'hathor/p2p/protocol.py', // Uses twisted
      'hathor/reactor/reactor.py', // Uses twisted
      'hathor/websocket/factory.py', // Uses twisted
      'hathor/stratum/stratum.py', // Uses twisted
      'hathor/nanocontracts/rng.py', // Uses cryptography
      'hathor/nanocontracts/utils.py', // Uses cryptography and pycoin - create proper stub
      'hathor/transaction/storage/transaction_storage.py', // Uses threading, RocksDB
    ];

    return problematicModules.some(mod => filePath.includes(mod));
  }
}
