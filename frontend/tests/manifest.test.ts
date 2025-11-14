import test from 'node:test';
import assert from 'node:assert/strict';

import { diffManifests } from '../lib/sync/manifest-utils';

test('diffManifests detects added, changed, and deleted files', () => {
  const previous = {
    '/dapp/app/page.tsx': { path: '/dapp/app/page.tsx', hash: 'aaa', size: 120 },
    '/dapp/app/layout.tsx': { path: '/dapp/app/layout.tsx', hash: 'bbb', size: 200 },
  };

  const current = {
    '/dapp/app/page.tsx': { path: '/dapp/app/page.tsx', hash: 'ccc', size: 140 },
    '/dapp/app/home.tsx': { path: '/dapp/app/home.tsx', hash: 'ddd', size: 50 },
  };

  const { addedOrChanged, deleted } = diffManifests(current, previous);

  assert.deepEqual(addedOrChanged.sort(), ['/dapp/app/home.tsx', '/dapp/app/page.tsx']);
  assert.deepEqual(deleted, ['/dapp/app/layout.tsx']);
});

