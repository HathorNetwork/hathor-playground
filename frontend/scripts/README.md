# Hathor Modules Scripts

This directory contains scripts for managing Hathor modules in the IDE.

## Scripts

### `download-hathor-modules.js`

Downloads all necessary Hathor modules from the GitHub repository.

**Usage:**
```bash
# Download version specified in package.json (recommended)
npm run download-modules

# Download specific tag
npm run download-modules v0.65.1  # Note: will override package.json setting

# Download specific commit hash (full or short)  
npm run download-modules 72500e4cd293f4ad1e63ff89f7de68e2bed12e11
npm run download-modules 72500e4

# Download specific branch
npm run download-modules master
npm run download-modules develop

# Or run directly (uses package.json reference if no argument)
node scripts/download-hathor-modules.js
node scripts/download-hathor-modules.js v0.65.1
node scripts/download-hathor-modules.js 72500e4
```

**Configuration:**
The script uses the `hathor-core-reference` field in `package.json` to determine which version to download by default:

```json
{
  "hathor-core-reference": "b2775beab"
}
```

**What it does:**
1. Reads the module list from `lib/hathor-modules.ts`
2. Uses reference from `package.json` or command line argument  
3. Downloads all modules from the specified reference (tag/commit/branch)
4. Saves files to `public/hathor-modules/`
5. Creates a download summary in `public/hathor-modules/download-summary.json`
6. Automatically runs compression after successful download

**Features:**
- ✅ Centralized version management through `package.json`
- ✅ Supports tags, commit hashes (full/short), and branches
- ✅ Smart reference type detection and validation
- ✅ Batch downloads with progress reporting
- ✅ Handles GitHub redirects and rate limiting
- ✅ Creates directory structure automatically
- ✅ Provides detailed error reporting
- ✅ Auto-runs compression after download

### `compress-hathor-modules.js`

Compresses all modules into a single gzipped file for efficient loading.

**Usage:**
```bash
npm run compress-modules
# or
node scripts/compress-hathor-modules.js
```

**What it does:**
1. Scans `public/hathor-modules/` directory
2. Combines all files into a JSON structure
3. Compresses with gzip (typically 80%+ compression)
4. Outputs to `public/hathor-modules.json.gz`

### `update-modules`

Combined script that downloads the latest modules and compresses them.

**Usage:**
```bash
# Download latest and compress
npm run update-modules

# This is equivalent to:
npm run download-modules && npm run compress-modules
```

## Output Structure

```
public/hathor-modules/
├── __init__.py
├── __main__.py
├── api_util.py
├── builder/
│   ├── __init__.py
│   └── builder.py
├── ...
├── download-summary.json     # Download metadata
└── hathor-modules.json.gz    # Compressed archive
```

## GitHub Repository

- **Repository**: `HathorNetwork/hathor-core`  
- **Raw files**: `https://raw.githubusercontent.com/HathorNetwork/hathor-core/{tag}/{path}`
- **API**: `https://api.github.com/repos/HathorNetwork/hathor-core/tags`

## Examples

```bash
# Update to latest version
npm run update-modules

# Download specific version tag
node scripts/download-hathor-modules.js v0.65.1

# Download from specific commit (useful for development/testing)
node scripts/download-hathor-modules.js 72500e4cd293f4ad1e63ff89f7de68e2bed12e11

# Download from short commit hash
node scripts/download-hathor-modules.js 72500e4

# Download from branch (useful for getting unreleased features)
node scripts/download-hathor-modules.js develop

# Just compress existing modules  
npm run compress-modules

# Check what was downloaded
cat public/hathor-modules/download-summary.json
```

## Reference Types

The script automatically detects what type of reference you're providing:

- **Version Tags**: `v0.65.1`, `v1.0.0-rc.1` → Downloads from tagged releases
- **Full Commit Hash**: `72500e4cd293f4ad1e63ff89f7de68e2bed12e11` → Downloads from specific commit
- **Short Commit Hash**: `72500e4`, `abc123f` → Downloads from specific commit (7+ characters)
- **Branch Names**: `master`, `main`, `develop`, `feature-xyz` → Downloads from branch HEAD

## Error Handling

The scripts handle various error conditions:
- Network failures with retry logic
- GitHub API rate limits
- Missing files or directories
- Invalid tags or repository access
- File system permissions

Check the download summary and console output for detailed error information.