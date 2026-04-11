/**
 * SQL Guardrails Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SQLGuardrails, createReadOnlyGuardrails } from '../../../src/security/sql-guardrails.js';
import { sqlInjectionPayloads, validSQLQueries } from '../../setup.js';

describe('SQLGuardrails', () => {
  let guardrails: SQLGuardrails;

  beforeEach(() => {
    guardrails = createReadOnlyGuardrails();
  });

  describe('validate', () => {
    describe('valid queries', () => {
      it('allows simple SELECT queries', () => {
        const result = guardrails.validate('SELECT * FROM users');
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('allows SELECT with WHERE clause', () => {
        const result = guardrails.validate('SELECT id, name FROM users WHERE active = true');
        expect(result.valid).toBe(true);
      });

      it('allows SELECT with JOIN', () => {
        const result = guardrails.validate(
          'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id'
        );
        expect(result.valid).toBe(true);
      });

      it('allows SELECT with GROUP BY', () => {
        const result = guardrails.validate(
          'SELECT status, COUNT(*) FROM orders GROUP BY status'
        );
        expect(result.valid).toBe(true);
      });

      it('allows SELECT with ORDER BY and LIMIT', () => {
        const result = guardrails.validate(
          'SELECT * FROM products ORDER BY price DESC LIMIT 100'
        );
        expect(result.valid).toBe(true);
      });

      it('allows CTE (WITH clause)', () => {
        const result = guardrails.validate(
          `WITH recent AS (SELECT * FROM orders WHERE created_at > '2024-01-01')
           SELECT * FROM recent`
        );
        expect(result.valid).toBe(true);
      });

      it('allows EXPLAIN queries', () => {
        const result = guardrails.validate('EXPLAIN SELECT * FROM users');
        expect(result.valid).toBe(true);
      });

      it.each(validSQLQueries)('allows valid query: %s', (sql) => {
        const result = guardrails.validate(sql);
        expect(result.valid).toBe(true);
      });
    });

    describe('blocked patterns', () => {
      it('blocks DROP statements', () => {
        const result = guardrails.validate('DROP TABLE users');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Blocked SQL pattern detected: DROP');
      });

      it('blocks DELETE statements', () => {
        const result = guardrails.validate('DELETE FROM users WHERE id = 1');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Blocked SQL pattern detected: DELETE');
      });

      it('blocks UPDATE statements', () => {
        const result = guardrails.validate('UPDATE users SET admin = true');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Blocked SQL pattern detected: UPDATE');
      });

      it('blocks INSERT statements', () => {
        const result = guardrails.validate("INSERT INTO users VALUES (1, 'test')");
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Blocked SQL pattern detected: INSERT');
      });

      it('blocks TRUNCATE statements', () => {
        const result = guardrails.validate('TRUNCATE TABLE users');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Blocked SQL pattern detected: TRUNCATE');
      });

      it('blocks ALTER statements', () => {
        const result = guardrails.validate('ALTER TABLE users ADD COLUMN password TEXT');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Blocked SQL pattern detected: ALTER');
      });

      it('blocks CREATE statements', () => {
        const result = guardrails.validate('CREATE TABLE hackers (id INT)');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Blocked SQL pattern detected: CREATE');
      });

      it('blocks GRANT statements', () => {
        const result = guardrails.validate('GRANT ALL ON users TO hacker');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Blocked SQL pattern detected: GRANT');
      });

      it('blocks REVOKE statements', () => {
        const result = guardrails.validate('REVOKE ALL ON users FROM admin');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Blocked SQL pattern detected: REVOKE');
      });

      it('blocks EXEC statements', () => {
        const result = guardrails.validate("EXEC sp_test 'param'");
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Blocked SQL pattern detected: EXEC');
      });
    });

    describe('SQL injection prevention', () => {
      it.each(sqlInjectionPayloads)('blocks injection payload: %s', (payload) => {
        const result = guardrails.validate(payload);
        expect(result.valid).toBe(false);
      });

      it('blocks UNION SELECT injection', () => {
        const result = guardrails.validate(
          'SELECT * FROM users UNION SELECT * FROM passwords'
        );
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Potentially dangerous SQL pattern detected');
      });

      it('blocks SQL comments (line)', () => {
        const result = guardrails.validate("SELECT * FROM users -- comment");
        expect(result.valid).toBe(false);
      });

      it('blocks SQL comments (block)', () => {
        const result = guardrails.validate('SELECT * FROM users /* comment */');
        expect(result.valid).toBe(false);
      });

      it('blocks multiple statements', () => {
        const result = guardrails.validate('SELECT 1; SELECT 2');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Multiple SQL statements are not allowed');
      });

      it('blocks INTO OUTFILE', () => {
        const result = guardrails.validate("SELECT * INTO OUTFILE '/tmp/test' FROM users");
        expect(result.valid).toBe(false);
      });

      it('blocks LOAD_FILE', () => {
        const result = guardrails.validate("SELECT LOAD_FILE('/etc/passwd')");
        expect(result.valid).toBe(false);
      });

      it('blocks SLEEP (time-based injection)', () => {
        const result = guardrails.validate('SELECT * FROM users WHERE SLEEP(5)');
        expect(result.valid).toBe(false);
      });

      it('blocks BENCHMARK (time-based injection)', () => {
        const result = guardrails.validate("SELECT BENCHMARK(1000000, SHA1('test'))");
        expect(result.valid).toBe(false);
      });

      it('blocks INFORMATION_SCHEMA access', () => {
        const result = guardrails.validate('SELECT * FROM INFORMATION_SCHEMA.TABLES');
        expect(result.valid).toBe(false);
      });
    });

    describe('query must start with allowed pattern', () => {
      it('rejects queries not starting with SELECT/WITH/EXPLAIN', () => {
        const result = guardrails.validate('SHOW TABLES');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Query must start with: SELECT or WITH or EXPLAIN');
      });
    });

    describe('warnings', () => {
      it('warns about missing LIMIT', () => {
        const result = guardrails.validate('SELECT * FROM users');
        expect(result.warnings).toContain('No LIMIT clause detected — LIMIT 1000 will be enforced automatically');
      });

      it('does not warn when LIMIT is present', () => {
        const result = guardrails.validate('SELECT * FROM users LIMIT 100');
        expect(result.warnings).not.toContain('No LIMIT clause detected — LIMIT 1000 will be enforced automatically');
      });

      it('warns about SELECT *', () => {
        const result = guardrails.validate('SELECT * FROM users');
        expect(result.warnings).toContain('Consider selecting specific columns instead of *');
      });

      it('warns about leading wildcard in LIKE', () => {
        const result = guardrails.validate("SELECT * FROM users WHERE name LIKE '%test'");
        expect(result.warnings).toContain('Leading wildcard in LIKE may cause slow queries');
      });

      it('warns about CROSS JOIN', () => {
        const result = guardrails.validate('SELECT * FROM users CROSS JOIN orders');
        expect(result.warnings).toContain('CROSS JOIN can produce very large result sets');
      });
    });
  });

  describe('sanitize', () => {
    it('removes line comments', () => {
      const result = guardrails.validate("SELECT * FROM users -- comment\nLIMIT 10");
      // Even though this will be invalid due to comment detection, check sanitized output
      expect(result.sanitizedSQL).not.toContain('--');
    });

    it('removes block comments', () => {
      const result = guardrails.validate('SELECT /* comment */ * FROM users');
      expect(result.sanitizedSQL).not.toContain('/*');
      expect(result.sanitizedSQL).not.toContain('*/');
    });

    it('takes only first statement before semicolon', () => {
      const result = guardrails.validate('SELECT 1; SELECT 2');
      expect(result.sanitizedSQL).toBe('SELECT 1 LIMIT 1000');
    });

    it('normalizes whitespace', () => {
      const result = guardrails.validate('SELECT   *   FROM   users');
      expect(result.sanitizedSQL).toBe('SELECT * FROM users LIMIT 1000');
    });
  });

  describe('isAllowed', () => {
    it('returns true for valid queries', () => {
      expect(guardrails.isAllowed('SELECT * FROM users LIMIT 10')).toBe(true);
    });

    it('returns false for invalid queries', () => {
      expect(guardrails.isAllowed('DROP TABLE users')).toBe(false);
    });
  });

  describe('addBlockedPattern', () => {
    it('adds custom blocked pattern', () => {
      guardrails.addBlockedPattern('CUSTOM_DANGEROUS');
      const result = guardrails.validate('SELECT CUSTOM_DANGEROUS FROM users');
      expect(result.valid).toBe(false);
    });
  });

  describe('addAllowedPattern', () => {
    it('adds custom allowed pattern', () => {
      guardrails.addAllowedPattern('DESCRIBE');
      const result = guardrails.validate('DESCRIBE users');
      expect(result.valid).toBe(true);
    });
  });

  describe('custom configuration', () => {
    it('respects custom allowed patterns', () => {
      const customGuardrails = new SQLGuardrails({
        allowedSqlPatterns: ['SHOW'],
        blockedPatterns: [],
        rateLimit: { requestsPerMinute: 60 },
      });

      expect(customGuardrails.validate('SHOW TABLES').valid).toBe(true);
      expect(customGuardrails.validate('SELECT * FROM users').valid).toBe(false);
    });

    it('respects custom blocked patterns', () => {
      const customGuardrails = new SQLGuardrails({
        allowedSqlPatterns: ['SELECT'],
        blockedPatterns: ['USERS'],
        rateLimit: { requestsPerMinute: 60 },
      });

      expect(customGuardrails.validate('SELECT * FROM users').valid).toBe(false);
    });
  });
});
