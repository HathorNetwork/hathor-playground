import { contractsApi } from '@/lib/api';

export interface Step {
  title: string;
  description: string;
  test: (ctx: { code: string; blueprintId: string }) => boolean | Promise<boolean>;
}

export const steps: Step[] = [
  {
    title: 'Define contract structure',
    description:
      'Create a Crowdfund blueprint with imports, class declaration, and basic state variables like owner, goal, and deadline.',
    test: async ({ code }) =>
      code.includes('class Crowdfund(Blueprint)') &&
      code.includes('owner: Address') &&
      code.includes('goal: int') &&
      code.includes('deadline: int'),
  },
  {
    title: 'Initialize campaign',
    description:
      'Add a @public initialize method that sets owner, goal, deadline and initializes storage for contributions.',
    test: async ({ blueprintId }) => {
      const init = await contractsApi.execute({
        contract_id: blueprintId,
        method_name: 'initialize',
        args: [100, 123456],
      });
      return init.success && Boolean(init.result?.contract_id);
    },
  },
  {
    title: 'Accept contributions',
    description:
      'Implement a @public(allow_deposit=True) contribute method that records deposits per address and updates the total raised.',
    test: async ({ blueprintId }) => {
      const init = await contractsApi.execute({
        contract_id: blueprintId,
        method_name: 'initialize',
        args: [100, 123456],
      });
      if (!init.success || !init.result?.contract_id) return false;
      const contribute = await contractsApi.execute({
        contract_id: init.result.contract_id,
        method_name: 'contribute',
        args: [],
      });
      return contribute.success || Boolean(contribute.error);
    },
  },
  {
    title: 'Finalize or refund',
    description:
      'Add a finalize method with @public(allow_withdrawal=True) that lets the owner withdraw when goal is reached or contributors refund otherwise.',
    test: async ({ blueprintId }) => {
      const init = await contractsApi.execute({
        contract_id: blueprintId,
        method_name: 'initialize',
        args: [100, 123456],
      });
      if (!init.success || !init.result?.contract_id) return false;
      const finalize = await contractsApi.execute({
        contract_id: init.result.contract_id,
        method_name: 'finalize',
        args: [],
      });
      return finalize.success || Boolean(finalize.error);
    },
  },
  {
    title: 'Expose views',
    description:
      'Provide view methods like get_total and get_contribution to query contract state.',
    test: async ({ blueprintId }) => {
      const init = await contractsApi.execute({
        contract_id: blueprintId,
        method_name: 'initialize',
        args: [100, 123456],
      });
      if (!init.success || !init.result?.contract_id) return false;
      const contractId = init.result.contract_id;
      const total = await contractsApi.execute({
        contract_id: contractId,
        method_name: 'get_total',
        method_type: 'view',
        args: [],
      });
      const contrib = await contractsApi.execute({
        contract_id: contractId,
        method_name: 'get_contribution',
        method_type: 'view',
        args: ['a1b2c3d4e5f6789012345678901234567890abcdef12345678'],
      });
      return total.success && typeof total.result === 'number' &&
        contrib.success && typeof contrib.result === 'number';
    },
  },
];
