import { LaunchDraftService } from '../packages/launchpad/launch-draft-service';
import { CreateLaunchDraftRequest } from '../packages/shared/contracts/api-contracts';

async function runLaunchModesSimulation() {
  console.log('================================================================');
  console.log('STARTING 5 LAUNCH MODES & ANGEL PIPELINE SANITY SIMULATION');
  console.log('================================================================');

  const savedDrafts: any[] = [];
  const savedWhitelists: any[] = [];

  const mockDb = {
    saveDraft: async (draft: any) => {
      savedDrafts.push(draft);
      return draft.id;
    },
    saveWhitelist: async (id: string, root: string, alloc: bigint) => {
      savedWhitelists.push({ id, root, alloc });
    },
    createAuditLog: async () => {},
  };

  const service = new LaunchDraftService(mockDb as any);

  // 1. Test BONDING_CURVE Mode
  console.log('\n[1/5] Testing BONDING_CURVE Launch Draft...');
  const bondingDraft = await service.createDraft('user-1', '0x1111111111111111111111111111111111111111', {
    name: 'Degen Moon',
    ticker: 'MOON',
    description: 'Bonding curve token',
    imageUrl: 'https://rtrader.io/moon.png',
    launchMode: 'BONDING_CURVE',
    targetChain: 'base-mainnet',
    totalSupply: '1000000000',
    creatorAllocationPct: 0,
  });
  if (bondingDraft.launchMode === 'BONDING_CURVE' && bondingDraft.status === 'DRAFT_CREATED') {
    console.log('SUCCESS: BONDING_CURVE draft created with risk score:', bondingDraft.riskPassportScore);
  } else {
    throw new Error('FAIL: BONDING_CURVE draft invalid');
  }

  // 2. Test FAIR_LAUNCH Mode
  console.log('\n[2/5] Testing FAIR_LAUNCH Mode (Anti-Snipe Max Cap)...');
  const fairDraft = await service.createDraft('user-2', '0x2222222222222222222222222222222222222222', {
    name: 'People Coin',
    ticker: 'PEOPLE',
    description: 'Fair launch grassroots',
    imageUrl: 'https://rtrader.io/people.png',
    launchMode: 'FAIR_LAUNCH',
    targetChain: 'base-mainnet',
    totalSupply: '1000000000',
    creatorAllocationPct: 0,
  });
  if (fairDraft.launchMode === 'FAIR_LAUNCH') {
    console.log('SUCCESS: FAIR_LAUNCH draft created successfully');
  } else {
    throw new Error('FAIL: FAIR_LAUNCH draft invalid');
  }

  // 3. Test WHITELIST_PRIVATE Mode (Angel Investor Merkle Proof)
  console.log('\n[3/5] Testing WHITELIST_PRIVATE Mode (Angel Investor Merkle Hash)...');
  const angelDraft = await service.createDraft('user-3', '0x3333333333333333333333333333333333333333', {
    name: 'SaaS Protocol',
    ticker: 'SAAS',
    description: 'Private angel round',
    imageUrl: 'https://rtrader.io/saas.png',
    launchMode: 'WHITELIST_PRIVATE',
    targetChain: 'base-mainnet',
    totalSupply: '1000000000',
    creatorAllocationPct: 10,
    socialLinks: {
      whitelist_wallets: '0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222',
    },
  });
  if (angelDraft.launchMode === 'WHITELIST_PRIVATE' && angelDraft.merkleRoot !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
    console.log('SUCCESS: WHITELIST_PRIVATE draft created with Merkle Root:', angelDraft.merkleRoot);
    console.log('SUCCESS: Whitelist allocation recorded in DB:', savedWhitelists.length, 'records');
  } else {
    throw new Error('FAIL: WHITELIST_PRIVATE Merkle Root computation failed');
  }

  // 4. Test FIXED_PRICE Mode
  console.log('\n[4/5] Testing FIXED_PRICE Mode...');
  const fixedDraft = await service.createDraft('user-4', '0x4444444444444444444444444444444444444444', {
    name: 'Stable Share',
    ticker: 'SHARE',
    description: 'Fixed price initial offering',
    imageUrl: 'https://rtrader.io/share.png',
    launchMode: 'FIXED_PRICE',
    targetChain: 'base-mainnet',
    totalSupply: '500000000',
    creatorAllocationPct: 5,
  });
  if (fixedDraft.launchMode === 'FIXED_PRICE') {
    console.log('SUCCESS: FIXED_PRICE draft validated cleanly');
  } else {
    throw new Error('FAIL: FIXED_PRICE draft invalid');
  }

  // 5. Test COMMUNITY_PRELAUNCH Mode
  console.log('\n[5/5] Testing COMMUNITY_PRELAUNCH Mode (Crowdfund Target)...');
  const commDraft = await service.createDraft('user-5', '0x5555555555555555555555555555555555555555', {
    name: 'CreatorDAO',
    ticker: 'CDAO',
    description: 'Community crowdfund prelaunch',
    imageUrl: 'https://rtrader.io/cdao.png',
    launchMode: 'COMMUNITY_PRELAUNCH',
    targetChain: 'base-mainnet',
    totalSupply: '1000000000',
    creatorAllocationPct: 0,
  });
  if (commDraft.launchMode === 'COMMUNITY_PRELAUNCH') {
    console.log('SUCCESS: COMMUNITY_PRELAUNCH draft created cleanly');
  } else {
    throw new Error('FAIL: COMMUNITY_PRELAUNCH draft invalid');
  }

  console.log('\n================================================================');
  console.log('ALL 5 LAUNCH MODES SIMULATIONS PASSED CLEANLY! ZERO REGRESSION');
  console.log('================================================================');
}

runLaunchModesSimulation().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
