/**
 * Rate Limiter Unit Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter, TieredRateLimiter } from '../../../src/security/rate-limiter.js';
import { RateLimitError } from '../../../src/utils/errors.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ requestsPerMinute: 5 });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkLimit', () => {
    it('allows requests within limit', () => {
      expect(() => limiter.checkLimit()).not.toThrow();
      expect(() => limiter.checkLimit()).not.toThrow();
      expect(() => limiter.checkLimit()).not.toThrow();
    });

    it('throws RateLimitError when limit exceeded', () => {
      // Make 5 requests (the limit)
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit();
      }

      // 6th request should fail
      expect(() => limiter.checkLimit()).toThrow(RateLimitError);
    });

    it('includes retry time in error', () => {
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit();
      }

      try {
        limiter.checkLimit();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as RateLimitError).retryAfterMs).toBeGreaterThan(0);
        expect((error as RateLimitError).retryAfterMs).toBeLessThanOrEqual(60000);
      }
    });

    it('resets after time window passes', () => {
      // Max out the limit
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit();
      }

      // Should be rate limited
      expect(() => limiter.checkLimit()).toThrow(RateLimitError);

      // Advance time by 1 minute
      vi.advanceTimersByTime(60001);

      // Should be allowed again
      expect(() => limiter.checkLimit()).not.toThrow();
    });

    it('uses sliding window', () => {
      // Make 3 requests
      limiter.checkLimit();
      limiter.checkLimit();
      limiter.checkLimit();

      // Advance 30 seconds
      vi.advanceTimersByTime(30000);

      // Make 2 more requests
      limiter.checkLimit();
      limiter.checkLimit();

      // Should be at limit now
      expect(() => limiter.checkLimit()).toThrow(RateLimitError);

      // Advance another 31 seconds (first 3 requests expire)
      vi.advanceTimersByTime(31000);

      // Should be able to make 3 more requests
      expect(() => limiter.checkLimit()).not.toThrow();
      expect(() => limiter.checkLimit()).not.toThrow();
      expect(() => limiter.checkLimit()).not.toThrow();
    });
  });

  describe('wouldAllow', () => {
    it('returns true when under limit', () => {
      expect(limiter.wouldAllow()).toBe(true);
      limiter.checkLimit();
      expect(limiter.wouldAllow()).toBe(true);
    });

    it('returns false when at limit', () => {
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit();
      }
      expect(limiter.wouldAllow()).toBe(false);
    });

    it('does not record a request', () => {
      // Call wouldAllow multiple times
      for (let i = 0; i < 10; i++) {
        limiter.wouldAllow();
      }
      // Should still allow actual requests
      expect(limiter.getRemainingRequests()).toBe(5);
    });
  });

  describe('getRemainingRequests', () => {
    it('returns correct remaining count', () => {
      expect(limiter.getRemainingRequests()).toBe(5);
      limiter.checkLimit();
      expect(limiter.getRemainingRequests()).toBe(4);
      limiter.checkLimit();
      expect(limiter.getRemainingRequests()).toBe(3);
    });

    it('returns 0 when exhausted', () => {
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit();
      }
      expect(limiter.getRemainingRequests()).toBe(0);
    });
  });

  describe('getResetTime', () => {
    it('returns 0 when no requests made', () => {
      expect(limiter.getResetTime()).toBe(0);
    });

    it('returns time until oldest request expires', () => {
      limiter.checkLimit();
      const resetTime = limiter.getResetTime();
      expect(resetTime).toBeGreaterThan(59000);
      expect(resetTime).toBeLessThanOrEqual(60000);
    });

    it('decreases as time passes', () => {
      limiter.checkLimit();
      const initialReset = limiter.getResetTime();

      vi.advanceTimersByTime(10000);
      const laterReset = limiter.getResetTime();

      expect(laterReset).toBeLessThan(initialReset);
      expect(initialReset - laterReset).toBeCloseTo(10000, -2);
    });
  });

  describe('reset', () => {
    it('clears all recorded requests', () => {
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit();
      }
      expect(limiter.getRemainingRequests()).toBe(0);

      limiter.reset();

      expect(limiter.getRemainingRequests()).toBe(5);
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      limiter.checkLimit();
      limiter.checkLimit();

      const stats = limiter.getStats();

      expect(stats.currentRequests).toBe(2);
      expect(stats.maxRequests).toBe(5);
      expect(stats.remainingRequests).toBe(3);
      expect(stats.resetInMs).toBeGreaterThan(0);
    });
  });
});

describe('TieredRateLimiter', () => {
  let tieredLimiter: TieredRateLimiter;

  beforeEach(() => {
    tieredLimiter = new TieredRateLimiter({
      read: { requestsPerMinute: 10 },
      write: { requestsPerMinute: 5 },
      nlq: { requestsPerMinute: 3 },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkLimit', () => {
    it('tracks different tiers independently', () => {
      // Use up read limit
      for (let i = 0; i < 10; i++) {
        tieredLimiter.checkLimit('read');
      }

      // Read should be limited
      expect(() => tieredLimiter.checkLimit('read')).toThrow(RateLimitError);

      // Write should still work
      expect(() => tieredLimiter.checkLimit('write')).not.toThrow();

      // NLQ should still work
      expect(() => tieredLimiter.checkLimit('nlq')).not.toThrow();
    });

    it('respects different limits per tier', () => {
      // NLQ has lowest limit (3)
      tieredLimiter.checkLimit('nlq');
      tieredLimiter.checkLimit('nlq');
      tieredLimiter.checkLimit('nlq');
      expect(() => tieredLimiter.checkLimit('nlq')).toThrow(RateLimitError);

      // Write has medium limit (5)
      for (let i = 0; i < 5; i++) {
        tieredLimiter.checkLimit('write');
      }
      expect(() => tieredLimiter.checkLimit('write')).toThrow(RateLimitError);

      // Read has highest limit (10)
      for (let i = 0; i < 10; i++) {
        tieredLimiter.checkLimit('read');
      }
      expect(() => tieredLimiter.checkLimit('read')).toThrow(RateLimitError);
    });

    it('silently ignores unknown tiers', () => {
      expect(() => tieredLimiter.checkLimit('unknown')).not.toThrow();
    });
  });

  describe('getRemainingRequests', () => {
    it('returns correct count per tier', () => {
      tieredLimiter.checkLimit('read');
      tieredLimiter.checkLimit('read');

      expect(tieredLimiter.getRemainingRequests('read')).toBe(8);
      expect(tieredLimiter.getRemainingRequests('write')).toBe(5);
      expect(tieredLimiter.getRemainingRequests('nlq')).toBe(3);
    });

    it('returns 0 for unknown tier', () => {
      expect(tieredLimiter.getRemainingRequests('unknown')).toBe(0);
    });
  });

  describe('getAllStats', () => {
    it('returns stats for all tiers', () => {
      tieredLimiter.checkLimit('read');
      tieredLimiter.checkLimit('write');

      const stats = tieredLimiter.getAllStats();

      expect(stats.read).toBeDefined();
      expect(stats.write).toBeDefined();
      expect(stats.nlq).toBeDefined();

      expect(stats.read.currentRequests).toBe(1);
      expect(stats.write.currentRequests).toBe(1);
      expect(stats.nlq.currentRequests).toBe(0);
    });
  });

  describe('default tiers', () => {
    it('uses default configuration when not specified', () => {
      const defaultLimiter = new TieredRateLimiter();
      const stats = defaultLimiter.getAllStats();

      expect(stats.read).toBeDefined();
      expect(stats.write).toBeDefined();
      expect(stats.nlq).toBeDefined();
    });
  });
});
