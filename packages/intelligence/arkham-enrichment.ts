// Uses native global fetch (Node 18+ & Next.js native)

export interface ArkhamEntityProfile {
  walletAddress: string;
  arkhamEntityName?: string;
  arkhamEntityType: 'EXCHANGE' | 'WHALE' | 'VC' | 'SANCTIONED' | 'DEVELOPER' | 'UNKNOWN';
  riskPassportScore: number; // 0 - 100 (100 = safest, 0 = high risk / sanctioned)
  isCounterpartyBlocked: boolean;
  tags: string[];
  rawIntelligence: Record<string, unknown>;
}

export interface ArkhamIntelligenceDbAdapter {
  getArkhamProfile(walletAddress: string): Promise<ArkhamEntityProfile | null>;
  upsertArkhamProfile(profile: ArkhamEntityProfile): Promise<void>;
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

const defaultArkhamDb: ArkhamIntelligenceDbAdapter = {
  getArkhamProfile: async () => null,
  upsertArkhamProfile: async () => {},
  createAuditLog: async () => {},
};

export class ArkhamIntelligenceService {
  private apiBaseUrl: string;
  private apiKey: string;
  private db: ArkhamIntelligenceDbAdapter;

  constructor(
    apiKey?: string,
    db?: ArkhamIntelligenceDbAdapter,
    baseUrl?: string
  ) {
    this.apiKey = apiKey || process.env.ARKHAM_API_KEY || 'mock_arkham_api_key';
    this.db = db || defaultArkhamDb;
    this.apiBaseUrl = baseUrl || 'https://api.arkhamintelligence.com';
  }

  /**
   * Fetch Wallet Risk Profiling & Entity Intelligence from Arkham API (Out-of-Band Async Enrichment)
   */
  async profileWallet(walletAddress: string, requesterUserId: string): Promise<ArkhamEntityProfile> {
    const cached = await this.db.getArkhamProfile(walletAddress);
    if (cached) {
      return cached;
    }

    console.log(`[Arkham Intelligence] Fetching out-of-band profile for wallet ${walletAddress}...`);

    try {
      const res = await fetch(`${this.apiBaseUrl}/intelligence/address/${walletAddress}`, {
        headers: {
          'API-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        // Fallback profile if Arkham API is unavailable / rate-limited
        return this.createDefaultFallbackProfile(walletAddress);
      }

      const data = (await res.json()) as {
        entity?: { name?: string; type?: string };
        isSanctioned?: boolean;
        labels?: string[];
      };

      const arkhamEntityName = data.entity?.name || 'Unknown Entity';
      const entityTypeRaw = (data.entity?.type || 'UNKNOWN').toUpperCase();

      let arkhamEntityType: ArkhamEntityProfile['arkhamEntityType'] = 'UNKNOWN';
      let riskPassportScore = 80;
      let isCounterpartyBlocked = false;

      if (data.isSanctioned || entityTypeRaw.includes('SANCTION') || entityTypeRaw.includes('HACKER')) {
        arkhamEntityType = 'SANCTIONED';
        riskPassportScore = 0;
        isCounterpartyBlocked = true;
      } else if (entityTypeRaw.includes('EXCHANGE')) {
        arkhamEntityType = 'EXCHANGE';
        riskPassportScore = 95;
      } else if (entityTypeRaw.includes('WHALE')) {
        arkhamEntityType = 'WHALE';
        riskPassportScore = 75;
      } else if (entityTypeRaw.includes('VC') || entityTypeRaw.includes('FUND')) {
        arkhamEntityType = 'VC';
        riskPassportScore = 90;
      }

      const profile: ArkhamEntityProfile = {
        walletAddress,
        arkhamEntityName,
        arkhamEntityType,
        riskPassportScore,
        isCounterpartyBlocked,
        tags: data.labels || [],
        rawIntelligence: data as Record<string, unknown>,
      };

      await this.db.upsertArkhamProfile(profile);

      await this.db.createAuditLog(
        requesterUserId,
        'ARKHAM_INTELLIGENCE_PROFILED',
        undefined,
        `Profiled wallet ${walletAddress}: Score=${riskPassportScore}, Entity=${arkhamEntityName}`
      );

      return profile;
    } catch (error) {
      console.warn(`[Arkham Intelligence] API Error for wallet ${walletAddress}, returning fallback:`, error);
      return this.createDefaultFallbackProfile(walletAddress);
    }
  }

  private createDefaultFallbackProfile(walletAddress: string): ArkhamEntityProfile {
    return {
      walletAddress,
      arkhamEntityName: 'Unverified Wallet',
      arkhamEntityType: 'UNKNOWN',
      riskPassportScore: 70, // Default neutral-safe score
      isCounterpartyBlocked: false,
      tags: ['UNVERIFIED'],
      rawIntelligence: { status: 'FALLBACK_NEUTRAL' },
    };
  }
}
