// ============================================================================
// AI TWEET QUALITY & SENTIMENT SCORER (BOUNTY QUALITY GATE)
// ============================================================================

export interface TweetQualityAuditResult {
  qualityScore: number; // 0 - 100
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  isSpamOrBot: boolean;
  passedQualityGate: boolean;
  detectedHashtags: string[];
  auditReasons: string[];
}

export class TweetQualityScorer {
  private static readonly SPAM_PATTERNS = [
    /send\s+(?:eth|sol|btc|usdt)\s+to\s+receive/i,
    /double\s+your\s+crypto/i,
    /claim\s+airdrop\s+now\s+at\s+https?:\/\//i,
    /whatsapp\s+\+?[0-9\s-]{8,}/i,
    /telegram\s+t\.me\/[a-z0-9_]+/i,
    /guaranteed\s+1000x\s+profit/i,
    /free\s+crypto\s+giveaway/i,
    /dm\s+for\s+pump\s+signals/i,
  ];

  private static readonly POSITIVE_KEYWORDS = [
    'bullish',
    'revolutionary',
    'innovative',
    'gem',
    'excited',
    'solid',
    'lfg',
    'moon',
    'great team',
    'alpha',
    'game changer',
    'utility',
    'strong community',
  ];

  private static readonly NEGATIVE_FUD_KEYWORDS = [
    'scam',
    'rugpull',
    'honeypot',
    'dumping',
    'worthless',
    'avoid',
    'stay away',
    'fake project',
    'exploit',
    'thieves',
    'ponzi',
  ];

  /**
   * Audit tweet content before approving bounty claim
   */
  static auditTweet(tweetText: string, requiredHashtag: string): TweetQualityAuditResult {
    const reasons: string[] = [];
    const lowerText = tweetText.toLowerCase();

    // 1. Extract hashtags
    const hashtagMatches = tweetText.match(/#[a-zA-Z0-9_]+/g) || [];
    const cleanHashtags = hashtagMatches.map((h) => h.toLowerCase());
    const targetHashtag = requiredHashtag.toLowerCase();

    const hasRequiredHashtag =
      cleanHashtags.includes(targetHashtag) || lowerText.includes(targetHashtag);

    if (!hasRequiredHashtag) {
      reasons.push(`Required campaign hashtag ${requiredHashtag} was not found`);
    }

    // 2. Check Spam & Bot signatures
    let isSpam = false;
    for (const pattern of TweetQualityScorer.SPAM_PATTERNS) {
      if (pattern.test(tweetText)) {
        isSpam = true;
        reasons.push('Detected suspicious spam/phishing bot pattern');
        break;
      }
    }

    // 3. Length & Effort verification
    const cleanWords = tweetText.trim().split(/\s+/).filter(Boolean);
    if (cleanWords.length < 5) {
      reasons.push('Tweet is too brief or lacks meaningful commentary (< 5 words)');
    }

    // 4. Sentiment Analysis
    let positiveCount = 0;
    let negativeCount = 0;

    for (const pos of TweetQualityScorer.POSITIVE_KEYWORDS) {
      if (lowerText.includes(pos)) positiveCount++;
    }

    for (const neg of TweetQualityScorer.NEGATIVE_FUD_KEYWORDS) {
      if (lowerText.includes(neg)) negativeCount++;
    }

    let sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' = 'NEUTRAL';
    if (negativeCount > 0 && negativeCount >= positiveCount) {
      sentiment = 'NEGATIVE';
      reasons.push('Detected hostile or negative FUD sentiment towards the token');
    } else if (positiveCount > 0) {
      sentiment = 'POSITIVE';
    }

    // 5. Calculate Quality Score (0 - 100)
    let score = 50; // Base score
    if (hasRequiredHashtag) score += 20;
    if (sentiment === 'POSITIVE') score += 20;
    if (sentiment === 'NEGATIVE') score -= 40;
    if (cleanWords.length >= 10) score += 10;
    if (cleanWords.length < 5) score -= 20;
    if (isSpam) score -= 50;

    score = Math.max(0, Math.min(100, score));

    // Quality gate: require >= 65 score, valid hashtag, non-spam, non-negative sentiment
    const passedQualityGate =
      score >= 65 && hasRequiredHashtag && !isSpam && sentiment !== 'NEGATIVE';

    return {
      qualityScore: score,
      sentiment,
      isSpamOrBot: isSpam,
      passedQualityGate,
      detectedHashtags: cleanHashtags,
      auditReasons: reasons,
    };
  }
}
