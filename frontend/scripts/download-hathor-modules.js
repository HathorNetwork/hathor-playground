#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const https = require('https');

// Get the module list by parsing the TypeScript file
function getModulesList() {
  try {
    const hathorModulesPath = path.join(__dirname, '..', 'lib', 'hathor-modules.ts');
    const content = require('fs').readFileSync(hathorModulesPath, 'utf8');
    
    // Extract the HATHOR_MODULES array from the TypeScript file
    const arrayMatch = content.match(/export const HATHOR_MODULES = \[([\s\S]*?)\] as const;/);
    if (!arrayMatch) {
      throw new Error('Could not find HATHOR_MODULES array in hathor-modules.ts');
    }
    
    // Parse the array content to extract module paths
    const arrayContent = arrayMatch[1];
    const modules = [];
    
    // Match all quoted strings in the array
    const moduleMatches = arrayContent.match(/'([^']+)'/g);
    if (moduleMatches) {
      moduleMatches.forEach(match => {
        const modulePath = match.slice(1, -1); // Remove quotes
        modules.push(modulePath);
      });
    }
    
    console.log(`📋 Found ${modules.length} modules in hathor-modules.ts`);
    return modules;
  } catch (error) {
    console.error('❌ Failed to get modules list:', error.message);
    process.exit(1);
  }
}

function determineRefType(ref) {
  // Check if it's a full SHA-1 commit hash (40 hex characters)
  if (/^[a-f0-9]{40}$/i.test(ref)) {
    return 'commit hash (full)';
  }
  
  // Check if it's a short commit hash (7-40 hex characters)
  if (/^[a-f0-9]{7,39}$/i.test(ref)) {
    return 'commit hash (short)';
  }
  
  // Check if it's a tag (starts with 'v' followed by version number)
  if (/^v\d+\.\d+\.\d+/.test(ref)) {
    return 'version tag';
  }
  
  // Check if it's a common branch name
  if (['master', 'main', 'develop', 'dev'].includes(ref)) {
    return 'branch';
  }
  
  // Default assumption
  return 'tag/branch';
}

async function getLatestTag() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/HathorNetwork/hathor-core/tags',
      method: 'GET',
      headers: {
        'User-Agent': 'Hathor-IDE-Downloader'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const tags = JSON.parse(data);
          if (Array.isArray(tags) && tags.length > 0) {
            resolve(tags[0].name);
          } else {
            reject(new Error('No tags found in repository'));
          }
        } catch (error) {
          reject(new Error('Failed to parse GitHub API response'));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

async function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow redirect
        return downloadFile(res.headers.location, outputPath)
          .then(resolve)
          .catch(reject);
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }

      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', async () => {
        try {
          // Ensure directory exists
          const dir = path.dirname(outputPath);
          await fs.mkdir(dir, { recursive: true });
          
          // Write file
          await fs.writeFile(outputPath, data, 'utf8');
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

async function downloadHathorModules(ref = null) {
  console.log('🔍 Starting Hathor modules download...');
  
  // Get the reference to use (tag, commit hash, or branch)
  let targetRef = ref;
  if (!targetRef) {
    // Try to read from package.json first
    try {
      const packageJsonPath = path.join(__dirname, '..', 'package.json');
      const packageJson = JSON.parse(require('fs').readFileSync(packageJsonPath, 'utf8'));
      if (packageJson['hathor-core-reference']) {
        targetRef = packageJson['hathor-core-reference'];
        const refType = determineRefType(targetRef);
        console.log(`📋 Using reference from package.json (${refType}): ${targetRef}`);
      }
    } catch (error) {
      console.warn('⚠️  Failed to read reference from package.json:', error.message);
    }
    
    // If still no reference, fetch latest tag
    if (!targetRef) {
      console.log('🏷️  No reference specified, fetching latest tag...');
      try {
        targetRef = await getLatestTag();
        console.log(`📌 Latest tag: ${targetRef}`);
      } catch (error) {
        console.warn('⚠️  Failed to fetch latest tag, using master branch');
        targetRef = 'master';
      }
    }
  } else {
    // Determine if it's a tag, commit hash, or branch
    const refType = determineRefType(targetRef);
    console.log(`📌 Using specified ${refType}: ${targetRef}`);
  }

  // Get the list of modules to download
  const modules = getModulesList();
  
  // Prepare download directory
  const outputDir = path.join(__dirname, '..', 'public', 'hathor-modules');
  
  console.log(`📂 Output directory: ${outputDir}`);
  console.log(`🌐 Repository: HathorNetwork/hathor-core@${targetRef}`);
  console.log(`📦 Downloading ${modules.length} modules...`);
  
  let downloaded = 0;
  let failed = 0;
  const errors = [];

  // Process modules in batches to avoid overwhelming GitHub
  const BATCH_SIZE = 10;
  const batches = [];
  
  for (let i = 0; i < modules.length; i += BATCH_SIZE) {
    batches.push(modules.slice(i, i + BATCH_SIZE));
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    
    const batchPromises = batch.map(async (modulePath) => {
      try {
        // Remove 'hathor/' prefix for the output path
        const relativePath = modulePath.replace('hathor/', '');
        const outputPath = path.join(outputDir, relativePath);
        
        // Construct GitHub raw URL
        const githubUrl = `https://raw.githubusercontent.com/HathorNetwork/hathor-core/${targetRef}/${modulePath}`;
        
        await downloadFile(githubUrl, outputPath);
        downloaded++;
        
      } catch (error) {
        failed++;
        const errorMsg = `Failed to download ${modulePath}: ${error.message}`;
        errors.push(errorMsg);
        console.warn(`⚠️  ${errorMsg}`);
      }
    });
    
    await Promise.all(batchPromises);
    
    // Progress update
    const progress = Math.round(((batchIndex + 1) / batches.length) * 100);
    console.log(`📊 Progress: ${progress}% - Downloaded ${downloaded}/${modules.length} modules`);
    
    // Small delay between batches to be nice to GitHub
    if (batchIndex < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`\n✅ Download complete!`);
  console.log(`📈 Results: ${downloaded} downloaded, ${failed} failed`);
  
  if (errors.length > 0) {
    console.log(`\n❌ Failed downloads:`);
    errors.slice(0, 10).forEach(error => console.log(`   ${error}`));
    if (errors.length > 10) {
      console.log(`   ... and ${errors.length - 10} more`);
    }
  }

  // Create a summary file
  const summaryPath = path.join(outputDir, 'download-summary.json');
  const summary = {
    ref: targetRef,
    refType: determineRefType(targetRef),
    timestamp: new Date().toISOString(),
    total: modules.length,
    downloaded,
    failed,
    errors: errors.length > 0 ? errors : undefined
  };
  
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`📋 Summary saved to: ${summaryPath}`);
  
  // Run compression after successful download
  if (downloaded > 0) {
    console.log(`\n🗜️  Running compression...`);
    try {
      const { spawn } = require('child_process');
      const compressProcess = spawn('node', ['scripts/compress-hathor-modules.js'], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });
      
      compressProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Compression completed successfully`);
        } else {
          console.warn(`⚠️  Compression exited with code ${code}`);
        }
      });
      
    } catch (error) {
      console.warn(`⚠️  Failed to run compression: ${error.message}`);
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const ref = args[0]; // Optional reference argument (tag, commit hash, or branch)

// Run the download
downloadHathorModules(ref).catch((error) => {
  console.error('❌ Download failed:', error);
  process.exit(1);
});