const { chromium } = require('playwright');

async function testImports() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Navigate to the app
  await page.goto('http://localhost:3001');
  
  // Wait for the page to load
  await page.waitForTimeout(2000);
  
  // Listen for console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
      console.log('❌ Error:', msg.text());
    }
  });
  
  // Try to compile a simple nano contract to trigger all imports
  const testContract = `
from hathor.nanocontracts import Blueprint
from hathor.nanocontracts.context import Context
from hathor.nanocontracts.types import public, view

class TestContract(Blueprint):
    @public
    def initialize(self, context: Context) -> None:
        pass
    
    @view
    def get_value(self) -> int:
        return 42

__blueprint__ = TestContract
`;
  
  console.log('🚀 Starting import test...');
  
  // Click on code editor and paste test contract
  await page.click('[data-testid="monaco-editor"]').catch(() => {
    console.log('Could not find monaco editor, trying alternative selector...');
  });
  
  // Try alternative ways to interact with the editor
  await page.keyboard.press('Control+a');
  await page.keyboard.type(testContract);
  
  // Wait a bit for the code to be processed
  await page.waitForTimeout(3000);
  
  // Try to compile the contract
  await page.click('button:has-text("Compile")').catch(() => {
    console.log('Could not find Compile button, trying alternative...');
    return page.click('button:has-text("compile")');
  }).catch(() => {
    console.log('Could not find any compile button');
  });
  
  // Wait for compilation to complete and capture errors
  await page.waitForTimeout(10000);
  
  console.log('\n📊 Summary of errors found:');
  const uniqueErrors = [...new Set(errors)];
  const importErrors = uniqueErrors.filter(err => 
    err.includes('No module named') || 
    err.includes('cannot import name') ||
    err.includes('is not a package')
  );
  
  console.log(`\n🔍 Found ${importErrors.length} import-related errors:`);
  importErrors.forEach((error, i) => {
    console.log(`${i + 1}. ${error}`);
  });
  
  // Extract missing modules
  const missingModules = new Set();
  importErrors.forEach(error => {
    const moduleMatch = error.match(/No module named '([^']+)'/);
    const importMatch = error.match(/cannot import name '([^']+)' from '([^']+)'/);
    const packageMatch = error.match(/'([^']+)' is not a package/);
    
    if (moduleMatch) {
      missingModules.add(moduleMatch[1]);
    }
    if (importMatch) {
      missingModules.add(`${importMatch[2]}.${importMatch[1]}`);
    }
    if (packageMatch) {
      missingModules.add(packageMatch[1]);
    }
  });
  
  console.log(`\n📋 Missing modules/imports to add:`)
  Array.from(missingModules).sort().forEach(module => {
    console.log(`- ${module}`);
  });
  
  await browser.close();
  
  return Array.from(missingModules);
}

// Run the test
testImports().catch(console.error);