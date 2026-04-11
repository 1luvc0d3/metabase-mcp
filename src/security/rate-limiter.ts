/**
 * Rate Limiter
 * Prevents abuse by limiting requests per time window
 */

import { RateLimitError } from '../utils/errors.js';

interface RateLimitConfig {
  requestsPerMinute: number;
}

interface RequestRecord {
  timestamp: number;
}

export class RateLimiter {
  private requests: RequestRecord[] = [];
  private readonly windowMs: number = 60 * 1000; // 1 minute window
  private readonly maxRequests: number;

  constructor(config: RateLimitConfig) {
    this.maxRequests = config.requestsPerMinute;
  }

  /**
   * Check if request is allowed and record it
   * @throws RateLimitError if limit exceeded
   */
  checkLimit(): void {
    this.cleanOldRequests();

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const retryAfterMs = oldestRequest
        ? (oldestRequest.timestamp + this.windowMs) - Date.now()
        : this.windowMs;

      throw new RateLimitError(Math.max(0, retryAfterMs));
    }

    // Record this request
    this.requests.push({ timestamp: Date.now() });
  }

  /**
   * Check if request would be allowed without recording it
   */
  wouldAllow(): boolean {
    this.cleanOldRequests();
    return this.requests.length < this.maxRequests;
  }

  /**
   * Get remaining requests in current window
   */
  getRemainingRequests(): number {
    this.cleanOldRequests();
    return Math.max(0, this.maxRequests - this.requests.length);
  }

  /**
   * Get time until rate limit resets (in ms)
   */
  getResetTime(): number {
    this.cleanOldRequests();
    if (this.requests.length === 0) {
      return 0;
    }
    const oldestRequest = this.requests[0];
    return Math.max(0, (oldestRequest.timestamp + this.windowMs) - Date.now());
  }

  /**
   * Remove requests outside the current window
   */
  private cleanOldRequests(): void {
    const cutoff = Date.now() - this.windowMs;
    this.requests = this.requests.filter(r => r.timestamp > cutoff);
  }

  /**
   * Reset the rate limiter (for testing)
   */
  reset(): void {
    this.requests = [];
  }

  /**
   * Get current stats
   */
  getStats(): {
    currentRequests: number;
    maxRequests: number;
    remainingRequests: number;
    resetInMs: number;
  } {
    this.cleanOldRequests();
    return {
      currentRequests: this.requests.length,
      maxRequests: this.maxRequests,
      remainingRequests: this.getRemainingRequests(),
      resetInMs: this.getResetTime(),
    };
  }
}

/**
 * Rate limiter with multiple tiers for different operation types
 */
export class TieredRateLimiter {
  private limiters: Map<string, RateLimiter> = new Map();

  constructor(
    tiers: Record<string, RateLimitConfig> = {
      read: { requestsPerMinute: 120 },
      write: { requestsPerMinute: 30 },
      nlq: { requestsPerMinute: 20 },
    }
  ) {
    for (const [tier, config] of Object.entries(tiers)) {
      this.limiters.set(tier, new RateLimiter(config));
    }
  }

  /**
   * Check limit for a specific tier
   */
  checkLimit(tier: string): void {
    const limiter = this.limiters.get(tier);
    if (limiter) {
      limiter.checkLimit();
    }
  }

  /**
   * Get remaining requests for a tier
   */
  getRemainingRequests(tier: string): number {
    const limiter = this.limiters.get(tier);
    return limiter ? limiter.getRemainingRequests() : 0;
  }

  /**
   * Get all tier stats
   */
  getAllStats(): Record<string, ReturnType<RateLimiter['getStats']>> {
    const stats: Record<string, ReturnType<RateLimiter['getStats']>> = {};
    for (const [tier, limiter] of this.limiters) {
      stats[tier] = limiter.getStats();
    }
    return stats;
  }
}
