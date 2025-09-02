#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const stat = promisify(fs.stat);

async function getAllFiles(dir, basePath = '') {
  const files = [];
  const items = await readdir(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const relativePath = path.join(basePath, item).replace(/\\/g, '/');
    const stats = await stat(fullPath);
    
    if (stats.isDirectory()) {
      const subFiles = await getAllFiles(fullPath, relativePath);
      files.push(...subFiles);
    } else {
      const content = await readFile(fullPath, 'utf8');
      files.push({
        path: relativePath,
        content: content
      });
    }
  }
  
  return files;
}

async function compressHathorModules() {
  const modulesDir = path.join(__dirname, '..', 'public', 'hathor-modules');
  const outputPath = path.join(__dirname, '..', 'public', 'hathor-modules.json.gz');
  
  console.log('🔍 Scanning Hathor modules directory...');
  const files = await getAllFiles(modulesDir);
  
  console.log(`📦 Found ${files.length} files`);
  
  // Create a JSON structure with all files
  const moduleData = {
    files: files.reduce((acc, file) => {
      acc[file.path] = file.content;
      return acc;
    }, {}),
    timestamp: new Date().toISOString(),
    totalFiles: files.length
  };
  
  const jsonString = JSON.stringify(moduleData);
  const originalSize = Buffer.byteLength(jsonString, 'utf8');
  
  console.log(`📊 Original size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
  
  // Compress with gzip
  const compressed = zlib.gzipSync(jsonString, { level: 9 });
  const compressedSize = compressed.length;
  
  console.log(`🗜️  Compressed size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`💾 Compression ratio: ${((1 - compressedSize / originalSize) * 100).toFixed(1)}%`);
  
  await writeFile(outputPath, compressed);
  
  console.log(`✅ Successfully created: ${outputPath}`);
  console.log(`📈 Reduced from ${files.length} requests to 1 request`);
}

// Run the compression
compressHathorModules().catch(console.error);