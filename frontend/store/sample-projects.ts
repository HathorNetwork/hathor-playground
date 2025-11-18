import { Project, File } from './ide-store';

// Sample projects to initialize the IDE with
function makeProjectId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export const SAMPLE_PROJECTS: Project[] = [
  {
    id: makeProjectId('counter-dapp'),
    name: 'Counter dApp',
    description: 'A simple counter contract with increment/reset functionality',
    created: Date.now(),
    lastModified: Date.now(),
    files: [
      {
        id: 'counter-contract',
        name: 'SimpleCounter.py',
        language: 'python',
        path: '/contracts/SimpleCounter.py',
        type: 'contract',
        content: `from hathor import Blueprint, Context, NCFail, export, public, view

@export
class SimpleCounter(Blueprint):
    """A simple counter that can be incremented and read"""

    # Contract state
    count: int

    @public
    def initialize(self, ctx: Context) -> None:
        """Initialize the counter"""
        self.count = 0

    @public
    def increment(self, ctx: Context, amount: int) -> None:
        """Increment the counter by the specified amount"""
        if amount <= 0:
            raise NegativeIncrement("Amount must be positive")

        self.count += amount

    @view
    def get_count(self) -> int:
        """Get the current counter value"""
        return self.count

    @public
    def reset(self, ctx: Context) -> None:
        """Reset the counter to zero"""
        self.count = 0


class NegativeIncrement(NCFail):
    pass`,
      },
      {
        id: 'counter-test',
        name: 'test_simple_counter.py',
        language: 'python',
        path: '/tests/test_simple_counter.py',
        type: 'test',
        content: `from hathor.nanocontracts.nc_types import make_nc_type_for_arg_type as make_nc_type


COUNTER_NC_TYPE = make_nc_type(int)


class CounterTestCase(BlueprintTestCase):
    def setUp(self):
        super().setUp()

        self.blueprint_id = self.gen_random_blueprint_id()
        self.contract_id = self.gen_random_contract_id()
        self.address = self.gen_random_address()

        self.nc_catalog.blueprints[self.blueprint_id] = SimpleCounter
        self.tx = self.get_genesis_tx()


    def test_lifecycle(self) -> None:
        context = self.create_context(
            vertex=self.tx,
            caller_id=self.address,
            timestamp=self.now
        )

        # Create a contract.
        self.runner.create_contract(
            self.contract_id,
            self.blueprint_id,
            context,
        )

        self.nc_storage = self.runner.get_storage(self.contract_id)

        self.assertEqual(0, self.nc_storage.get_obj(b'count', COUNTER_NC_TYPE))

        # increment
        AMOUNT = 3
        self.runner.call_public_method(self.contract_id, 'increment', context, AMOUNT)
        self.assertEqual(AMOUNT, self.nc_storage.get_obj(b'count', COUNTER_NC_TYPE))

        # call get_count
        ret = self.runner.call_view_method(self.contract_id, 'get_count')
        self.assertEqual(AMOUNT, ret)

        with self.assertRaises(NegativeIncrement):
            self.runner.call_public_method(self.contract_id, 'increment', context, -2)

        # reset
        self.runner.call_public_method(self.contract_id, 'reset', context)
        self.assertEqual(0, self.nc_storage.get_obj(b'count', COUNTER_NC_TYPE))`,
      },
      // Starter dApp file for testing Beam integration
      {
        id: 'counter-dapp-starter',
        name: 'page.tsx',
        language: 'typescriptreact',
        path: '/dapp/page.tsx',
        type: 'component',
        content: `export default function CounterDApp() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Counter dApp - Coming Soon</h1>
      <p>This is a starter file for testing Beam integration.</p>
      <p>The LLM will generate the full dApp interface here.</p>
    </div>
  );
}
`,
      },
    ],
  },
  {
    id: makeProjectId('defi-dapp'),
    name: 'DeFi dApp',
    description: 'Liquidity pool and token swap contracts',
    created: Date.now(),
    lastModified: Date.now(),
    files: [
      {
        id: 'liquidity-pool-contract',
        name: 'LiquidityPool.py',
        language: 'python',
        path: '/contracts/LiquidityPool.py',
        type: 'contract',
        content: `"""
Liquidity Pool Contract - Demonstrates Hathor Blueprint SDK types and patterns
A simple DEX liquidity pool for token swapping with proper Hathor constraints
"""
from hathor.nanocontracts.blueprint import Blueprint
from hathor.nanocontracts.context import Context
from hathor.nanocontracts.types import public, view, TokenUid, VertexId, Amount


class LiquidityPool(Blueprint):
    """A simple liquidity pool contract for two tokens
    Demonstrates proper use of Hathor Blueprint SDK types
    """

    # Contract state - all fields must be initialized in initialize()
    token_a: TokenUid
    token_b: TokenUid
    owner: VertexId  # Using VertexId instead of Address for IDE compatibility
    fee_rate: int
    total_liquidity: Amount

    @public
    def initialize(self, ctx: Context, token_a: TokenUid, token_b: TokenUid, fee_rate: int) -> None:
        """Initialize the liquidity pool contract"""
        self.token_a = token_a
        self.token_b = token_b
        self.owner = ctx.vertex.hash  # This is a 32-byte VertexId
        self.fee_rate = fee_rate  # Fee in basis points (e.g., 30 = 0.3%)
        self.total_liquidity = 0

    @view
    def get_tokens(self) -> tuple[TokenUid, TokenUid]:
        """Get the two tokens in this pool"""
        return (self.token_a, self.token_b)

    @view
    def get_owner(self) -> VertexId:
        """Get contract owner ID"""
        return self.owner

    @view
    def get_fee_rate(self) -> int:
        """Get fee rate in basis points"""
        return self.fee_rate

    @view
    def get_total_liquidity(self) -> Amount:
        """Get total liquidity in the pool"""
        return self.total_liquidity

    @view
    def get_pool_info(self) -> dict[str, str]:
        """Get pool information"""
        return {
            "token_a": self.token_a.hex(),
            "token_b": self.token_b.hex(),
            "owner": self.owner.hex(),
            "fee_rate": str(self.fee_rate),
            "total_liquidity": str(self.total_liquidity)
        }

    @public
    def set_fee_rate(self, ctx: Context, new_fee_rate: int) -> None:
        """Set new fee rate (only owner)"""
        if ctx.vertex.hash != self.owner:
            raise ValueError("Only owner can set fee rate")

        if new_fee_rate < 0 or new_fee_rate > 1000:  # Max 10%
            raise ValueError("Fee rate must be between 0 and 1000 basis points")

        self.fee_rate = new_fee_rate

    @public
    def add_liquidity(self, ctx: Context, amount: Amount) -> None:
        """Add liquidity to the pool (simplified version)"""
        if amount <= 0:
            raise ValueError("Amount must be positive")

        # This is a simplified version - in a real DEX you'd handle
        # token deposits via actions and calculate LP tokens
        self.total_liquidity += amount

    @view
    def calculate_swap_output(self, input_amount: Amount, input_token: TokenUid) -> Amount:
        """Calculate output amount for a swap (simplified)"""
        if input_token != self.token_a and input_token != self.token_b:
            raise ValueError("Invalid input token")

        if input_amount <= 0:
            raise ValueError("Input amount must be positive")

        # Simplified calculation - real DEX would use constant product formula
        fee = (input_amount * self.fee_rate) // 10000
        output_amount = input_amount - fee

        return output_amount


# This is the blueprint that will be deployed
__blueprint__ = LiquidityPool`,
      },
      {
        id: 'swap-demo-contract',
        name: 'SwapDemo.py',
        language: 'python',
        path: '/contracts/SwapDemo.py',
        type: 'contract',
        content: `from hathor.nanocontracts.blueprint import Blueprint
from hathor.nanocontracts.context import Context
from hathor.nanocontracts.exception import NCFail
from hathor.nanocontracts.types import NCDepositAction, NCWithdrawalAction, TokenUid, public, view


class SwapDemo(Blueprint):
    """Blueprint to execute swaps between tokens.
    This blueprint is here just as a reference for blueprint developers, not for real use.
    """

    # TokenA identifier and quantity multiplier.
    token_a: TokenUid
    multiplier_a: int

    # TokenB identifier and quantity multiplier.
    token_b: TokenUid
    multiplier_b: int

    # Count number of swaps executed.
    swaps_counter: int

    @public(allow_deposit=True)
    def initialize(
        self,
        ctx: Context,
        token_a: TokenUid,
        token_b: TokenUid,
        multiplier_a: int,
        multiplier_b: int
    ) -> None:
        """Initialize the contract."""

        if token_a == token_b:
            raise NCFail

        if set(ctx.actions.keys()) != {token_a, token_b}:
            raise InvalidTokens

        self.token_a = token_a
        self.token_b = token_b
        self.multiplier_a = multiplier_a
        self.multiplier_b = multiplier_b
        self.swaps_counter = 0

    @public(allow_deposit=True, allow_withdrawal=True)
    def swap(self, ctx: Context) -> None:
        """Execute a token swap."""

        if set(ctx.actions.keys()) != {self.token_a, self.token_b}:
            raise InvalidTokens

        action_a = ctx.get_single_action(self.token_a)
        action_b = ctx.get_single_action(self.token_b)

        if not (
            (isinstance(action_a, NCDepositAction) and isinstance(action_b, NCWithdrawalAction))
            or (isinstance(action_a, NCWithdrawalAction) and isinstance(action_b, NCDepositAction))
        ):
            raise InvalidActions

        if not self.is_ratio_valid(action_a.amount, action_b.amount):
            raise InvalidRatio

        # All good! Let's accept the transaction.
        self.swaps_counter += 1

    @view
    def is_ratio_valid(self, qty_a: int, qty_b: int) -> bool:
        """Check if the swap quantities are valid."""
        return (self.multiplier_a * qty_a == self.multiplier_b * qty_b)


class InvalidTokens(NCFail):
    pass


class InvalidActions(NCFail):
    pass


class InvalidRatio(NCFail):
    pass

__blueprint__ = SwapDemo`,
      },
      {
        id: 'swap-test',
        name: 'test_swap.py',
        language: 'python',
        path: '/tests/test_swap.py',
        type: 'test',
        content: `from hathor.nanocontracts.nc_types import make_nc_type_for_arg_type as make_nc_type
from hathor.nanocontracts.storage.contract_storage import Balance
from hathor.nanocontracts.types import NCDepositAction, NCWithdrawalAction, TokenUid


SWAP_NC_TYPE = make_nc_type(int)


class SwapDemoTestCase(BlueprintTestCase):
    def setUp(self):
        super().setUp()

        self.blueprint_id = self.gen_random_blueprint_id()
        self.contract_id = self.gen_random_contract_id()

        self.nc_catalog.blueprints[self.blueprint_id] = SwapDemo

        # Test doubles:
        self.token_a = self.gen_random_token_uid()
        self.token_b = self.gen_random_token_uid()
        self.token_c = self.gen_random_token_uid()
        self.address = self.gen_random_address()
        self.tx = self.get_genesis_tx()

    def _initialize(
        self,
        init_token_a: tuple[TokenUid, int, int],
        init_token_b: tuple[TokenUid, int, int]
    ) -> None:
        # Arrange:
        token_a, multiplier_a, amount_a = init_token_a
        token_b, multiplier_b, amount_b = init_token_b
        deposit_a = NCDepositAction(token_uid=token_a, amount=amount_a)
        deposit_b = NCDepositAction(token_uid=token_b, amount=amount_b)
        context = self.create_context(
            actions=[deposit_a, deposit_b],
            vertex=self.tx,
            caller_id=self.address,
            timestamp=self.now
        )

        # Act:
        self.runner.create_contract(
            self.contract_id,
            self.blueprint_id,
            context,
            token_a,
            token_b,
            multiplier_a,
            multiplier_b,
        )
        self.nc_storage = self.runner.get_storage(self.contract_id)

    def _swap(
        self,
        amount_a: tuple[int, TokenUid],
        amount_b: tuple[int, TokenUid]
    ) -> None:
        # Arrange:
        value_a, token_a = amount_a
        value_b, token_b = amount_b
        action_a_type = self.get_action_type(value_a)
        action_b_type = self.get_action_type(value_b)
        swap_a = action_a_type(token_uid=token_a, amount=abs(value_a))
        swap_b = action_b_type(token_uid=token_b, amount=abs(value_b))
        context = self.create_context(
            actions=[swap_a, swap_b],
            vertex=self.tx,
            caller_id=self.address,
            timestamp=self.now
        )

        # Act:
        self.runner.call_public_method(self.contract_id, 'swap', context)

    def test_lifecycle(self) -> None:
        # Create a contract.
        # Arrange and act within:
        self._initialize((self.token_a, 1, 100_00), (self.token_b, 1, 100_00))

        # Assert:
        self.assertEqual(
            Balance(value=100_00, can_mint=False, can_melt=False), self.nc_storage.get_balance(self.token_a)
        )
        self.assertEqual(
            Balance(value=100_00, can_mint=False, can_melt=False), self.nc_storage.get_balance(self.token_b)
        )
        self.assertEqual(0, self.nc_storage.get_obj(b'swaps_counter', SWAP_NC_TYPE))

        # Make a valid swap.
        # Arrange and act within:
        self._swap((20_00, self.token_a), (-20_00, self.token_b))
        # Assert:
        self.assertEqual(
            Balance(value=120_00, can_mint=False, can_melt=False), self.nc_storage.get_balance(self.token_a)
        )
        self.assertEqual(
            Balance(value=80_00, can_mint=False, can_melt=False), self.nc_storage.get_balance(self.token_b)
        )
        self.assertEqual(1, self.nc_storage.get_obj(b'swaps_counter', SWAP_NC_TYPE))

        # Make multiple invalid swaps raising all possible exceptions.
        with self.assertRaises(InvalidTokens):
            self._swap((-20_00, self.token_a), (20_00, self.token_c))
        with self.assertRaises(InvalidActions):
            self._swap((20_00, self.token_a), (40_00, self.token_b))
        with self.assertRaises(InvalidRatio):
            self._swap((20_00, self.token_a), (-40_00, self.token_b))

    def get_action_type(self, amount: int) -> type[NCDepositAction] | type[NCWithdrawalAction]:
        if amount >= 0:
            return NCDepositAction
        else:
            return NCWithdrawalAction`,
      },
      // Starter dApp file for testing Beam integration
      {
        id: 'defi-dapp-starter',
        name: 'page.tsx',
        language: 'typescriptreact',
        path: '/dapp/page.tsx',
        type: 'component',
        content: `export default function DeFiDApp() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>DeFi dApp - Coming Soon</h1>
      <p>This is a starter file for testing Beam integration.</p>
      <p>The LLM will generate the full DEX interface here.</p>
    </div>
  );
}
`,
      },
    ],
  },
];
