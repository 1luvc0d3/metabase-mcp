/**
 * Tool Gate Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { createToolGate } from '../../../src/security/tool-gate.js';

describe('createToolGate', () => {
  it('allows everything when no lists are provided', () => {
    const gate = createToolGate();
    expect(gate('execute_query')).toBe(true);
    expect(gate('create_card')).toBe(true);
  });

  it('allows everything when lists are empty', () => {
    const gate = createToolGate([], []);
    expect(gate('execute_query')).toBe(true);
  });

  it('denies tools on the deny list', () => {
    const gate = createToolGate(undefined, ['execute_query', 'delete_card']);
    expect(gate('execute_query')).toBe(false);
    expect(gate('delete_card')).toBe(false);
    expect(gate('list_dashboards')).toBe(true);
  });

  it('only allows tools on a non-empty allow list', () => {
    const gate = createToolGate(['list_dashboards', 'get_dashboard']);
    expect(gate('list_dashboards')).toBe(true);
    expect(gate('get_dashboard')).toBe(true);
    expect(gate('execute_query')).toBe(false);
    expect(gate('create_card')).toBe(false);
  });

  it('deny wins over allow', () => {
    const gate = createToolGate(['execute_query', 'list_dashboards'], ['execute_query']);
    expect(gate('execute_query')).toBe(false);
    expect(gate('list_dashboards')).toBe(true);
  });

  it('matches tool names exactly (case-sensitive)', () => {
    const gate = createToolGate(undefined, ['execute_query']);
    expect(gate('EXECUTE_QUERY')).toBe(true);
    expect(gate('execute_query')).toBe(false);
  });
});
