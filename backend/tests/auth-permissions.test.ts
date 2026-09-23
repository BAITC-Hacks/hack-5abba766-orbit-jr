import { describe, expect, it } from 'vitest';
import { requireEmployeeRead, requireEmployeeWrite, requireHr } from '../src/auth';
import type { SessionView } from '../src/types';

const employee: SessionView = { account_id: 'employee', role: 'employee', employee_id: 'E1', display_name: 'Employee' };
const hr: SessionView = { account_id: 'hr', role: 'hr', employee_id: null, display_name: 'HR' };

describe('employee and HR permissions', () => {
  it('lets an employee read and change only their own profile', () => {
    expect(() => requireEmployeeRead(employee, 'E1')).not.toThrow();
    expect(() => requireEmployeeWrite(employee, 'E1')).not.toThrow();
    expect(() => requireEmployeeRead(employee, 'E2')).toThrow(expect.objectContaining({ code: 'FORBIDDEN', status: 403 }));
    expect(() => requireEmployeeWrite(employee, 'E2')).toThrow(expect.objectContaining({ code: 'FORBIDDEN', status: 403 }));
    expect(() => requireHr(employee)).toThrow(expect.objectContaining({ code: 'FORBIDDEN', status: 403 }));
  });

  it('lets HR read employees and import data but never act as an employee, even with a linked employee id', () => {
    for (const actor of [hr, { ...hr, employee_id: 'E1' }]) {
      expect(() => requireEmployeeRead(actor, 'E1')).not.toThrow();
      expect(() => requireEmployeeRead(actor, 'E2')).not.toThrow();
      expect(() => requireHr(actor)).not.toThrow();
      expect(() => requireEmployeeWrite(actor, 'E1')).toThrow(expect.objectContaining({ code: 'FORBIDDEN', status: 403 }));
    }
  });
});
