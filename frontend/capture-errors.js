const puppeteer = require('puppeteer');

async function captureAllImportErrors() {
  const browser = await puppeteer.launch({ 
    headless: false,
    devtools: true,
    args: ['--disable-web-security', '--disable-features=VizDisplayCompositor'] 
  });
  
  const page = await browser.newPage();
  
  // Capture all console messages
  const allMessages = [];
  page.on('console', msg => {
    const text = msg.text();
    allMessages.push(text);
    if (text.includes('No module named') || text.includes('cannot import name') || text.includes('is not a package')) {
      console.log('🔍 Import Error:', text);
    }
  });
  
  // Navigate to the app
  console.log('🚀 Navigating to http://localhost:3001...');
  await page.goto('http://localhost:3001', { waitUntil: 'networkidle0' });
  
  // Wait for app to load
  await page.waitForTimeout(3000);
  
  // Try to trigger compilation by executing JavaScript directly
  const testContract = `
from hathor.nanocontracts import Blueprint
from hathor.nanocontracts.context import Context
from hathor.nanocontracts.types import public, view
from hathor.nanocontracts.utils import get_public_methods
from hathor.crypto.util import decode_address
from hathor.transaction import Transaction
from hathor.wallet import Wallet

class TestContract(Blueprint):
    @public
    def initialize(self, context: Context) -> None:
        pass
    
    @view
    def get_value(self) -> int:
        return 42

__blueprint__ = TestContract
`;

  try {
    // Try to access the pyodide runner directly and compile
    await page.evaluate(async (contract) => {
      console.log('🔄 Starting comprehensive import test...');
      
      // Try to get the pyodide runner from the window object
      if (window.pyodideRunner) {
        console.log('✅ Found pyodideRunner');
        try {
          await window.pyodideRunner.initialize();
          console.log('✅ PyodideRunner initialized');
          
          const result = await window.pyodideRunner.compileContract(contract, 'TestContract');
          console.log('📊 Compilation result:', result);
        } catch (error) {
          console.log('❌ Compilation error:', error.message);
        }
      } else {
        console.log('❌ PyodideRunner not found on window object');
      }
    }, testContract);
  } catch (error) {
    console.log('❌ Evaluation error:', error.message);
  }
  
  // Wait for all async operations to complete
  await page.waitForTimeout(15000);
  
  // Extract and analyze all import errors
  const importErrors = allMessages.filter(msg => 
    msg.includes('No module named') || 
    msg.includes('cannot import name') ||
    msg.includes('is not a package') ||
    msg.includes('has no attribute')
  );
  
  console.log('\n📋 All Import Errors Found:');
  const uniqueErrors = [...new Set(importErrors)];
  uniqueErrors.forEach((error, i) => {
    console.log(`${i + 1}. ${error}`);
  });
  
  // Extract missing modules systematically
  const missingModules = new Set();
  const missingAttributes = new Set();
  
  uniqueErrors.forEach(error => {
    // Match "No module named 'xxx'"
    const moduleMatch = error.match(/No module named '([^']+)'/);
    if (moduleMatch) {
      missingModules.add(moduleMatch[1]);
    }
    
    // Match "cannot import name 'xxx' from 'yyy'"
    const importMatch = error.match(/cannot import name '([^']+)' from '([^']+)'/);
    if (importMatch) {
      missingAttributes.add(`${importMatch[2]}.${importMatch[1]}`);
    }
    
    // Match "'xxx' is not a package"
    const packageMatch = error.match(/'([^']+)' is not a package/);
    if (packageMatch) {
      missingModules.add(packageMatch[1]);
    }
    
    // Match "has no attribute 'xxx'"
    const attrMatch = error.match(/module '([^']+)' has no attribute '([^']+)'/);
    if (attrMatch) {
      missingAttributes.add(`${attrMatch[1]}.${attrMatch[2]}`);
    }
  });
  
  console.log('\n🎯 Summary:');
  console.log(`📦 Missing Modules (${missingModules.size}):`);
  Array.from(missingModules).sort().forEach(module => {
    console.log(`  - ${module}`);
  });
  
  console.log(`\n🔗 Missing Attributes (${missingAttributes.size}):`);
  Array.from(missingAttributes).sort().forEach(attr => {
    console.log(`  - ${attr}`);
  });
  
  await browser.close();
  
  return {
    modules: Array.from(missingModules),
    attributes: Array.from(missingAttributes),
    errors: uniqueErrors
  };
}

// Run the capture
captureAllImportErrors().catch(console.error);