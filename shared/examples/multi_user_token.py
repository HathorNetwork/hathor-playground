"""
Multi-User Token Contract - A sophisticated nano contract demonstrating multiple caller interactions
Supports minting, transferring, approvals, and address-specific balances
"""
from hathor.nanocontracts import Blueprint
from hathor.nanocontracts.context import Context
from hathor.nanocontracts.types import public, view, Address, Amount


class MultiUserToken(Blueprint):
    """
    A token contract that supports multiple users with different permissions
    Features: minting, transfers, approvals, balance tracking per address
    """

    # Contract state
    name: str
    symbol: str
    total_supply: Amount
    owner: bytes
    balances: dict[bytes, Amount]
    # owner -> spender -> amount
    allowances: dict[bytes, dict[bytes, Amount]]

    @public
    def initialize(self, ctx: Context, name: str, symbol: str, initial_supply: Amount) -> None:
        """Initialize the token contract"""
        self.name = name
        self.symbol = symbol
        self.total_supply = initial_supply
        self.owner = ctx.vertex.hash  # Contract creator becomes owner (bytes)
        # Initialize owner's balance - use field methods instead of direct assignment
        self.balances[self.owner] = initial_supply

    @view
    def get_balance(self, address: bytes) -> Amount:
        """Get token balance of an address"""
        return self.balances.get(address, Amount(0))

    @view
    def get_total_supply(self) -> Amount:
        """Get total token supply"""
        return self.total_supply

    @view
    def get_owner(self) -> bytes:
        """Get contract owner address"""
        return self.owner

    @view
    def get_allowance(self, owner: Address, spender: Address) -> Amount:
        """Get approved amount that spender can transfer from owner"""
        return self.allowances.get(owner, {}).get(spender, Amount(0))

    @public
    def mint(self, ctx: Context, to_address: Address, amount: Amount) -> None:
        """Mint new tokens (only owner can mint)"""
        caller = Address(ctx.vertex.hash)

        if caller != self.owner:
            raise ValueError("Only owner can mint tokens")

        if amount <= 0:
            raise ValueError("Amount must be positive")

        # Update balances and total supply
        current_balance = self.balances.get(to_address, Amount(0))
        self.balances[to_address] = current_balance + amount
        self.total_supply += amount

    @public
    def transfer(self, ctx: Context, to_address: Address, amount: Amount) -> None:
        """Transfer tokens from caller to another address"""
        caller = Address(ctx.vertex.hash)

        if amount <= 0:
            raise ValueError("Amount must be positive")

        caller_balance = self.balances.get(caller, Amount(0))
        if caller_balance < amount:
            raise ValueError(f"Insufficient balance. Have {
                             caller_balance}, need {amount}")

        # Update balances
        self.balances[caller] = caller_balance - amount
        to_balance = self.balances.get(to_address, Amount(0))
        self.balances[to_address] = to_balance + amount

    @public
    def approve(self, ctx: Context, spender: Address, amount: Amount) -> None:
        """Approve spender to transfer tokens on behalf of caller"""
        caller = Address(ctx.vertex.hash)

        if amount < 0:
            raise ValueError("Amount cannot be negative")

        # Initialize nested dicts if needed
        if caller not in self.allowances:
            self.allowances[caller] = {}

        self.allowances[caller][spender] = amount

    @public
    def transfer_from(self, ctx: Context, from_address: Address, to_address: Address, amount: Amount) -> None:
        """Transfer tokens from one address to another using allowance"""
        caller = Address(ctx.vertex.hash)

        if amount <= 0:
            raise ValueError("Amount must be positive")

        # Check allowance
        allowed_amount = self.allowances.get(
            from_address, {}).get(caller, Amount(0))
        if allowed_amount < amount:
            raise ValueError(f"Insufficient allowance. Allowed {
                             allowed_amount}, need {amount}")

        # Check balance
        from_balance = self.balances.get(from_address, Amount(0))
        if from_balance < amount:
            raise ValueError(f"Insufficient balance. Have {
                             from_balance}, need {amount}")

        # Update allowance
        self.allowances[from_address][caller] = allowed_amount - amount

        # Update balances
        self.balances[from_address] = from_balance - amount
        to_balance = self.balances.get(to_address, Amount(0))
        self.balances[to_address] = to_balance + amount

    @public
    def send_to_addresses(self, ctx: Context, addresses: list[Address], amount: Amount) -> None:
        """Send specified amount to given addresses"""
        caller = Address(ctx.vertex.hash)

        if amount <= 0:
            raise ValueError("Amount must be positive")

        # Check if caller has enough balance to send
        caller_balance = self.balances.get(caller, Amount(0))
        total_amount_to_send = amount * len(addresses)
        if caller_balance < total_amount_to_send:
            raise ValueError(f"Insufficient balance to send {
                             total_amount_to_send} tokens to addresses")

        # Update balances
        self.balances[caller] = caller_balance - total_amount_to_send
        for address in addresses:
            self.balances[address] = self.balances.get(
                address, Amount(0)) + amount

    @view
    def get_all_balances(self) -> dict[Address, Amount]:
        """Get all non-zero balances (for debugging)"""
        return {addr: balance for addr, balance in self.balances.items() if balance > 0}


# This is the blueprint that will be deployed
__blueprint__ = MultiUserToken
