# Copyright 2025 Hathor Labs
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from sqlite3 import Time
from typing import Any, NamedTuple

from hathor.conf import settings
from hathor.nanocontracts.blueprint import Blueprint
from hathor.nanocontracts.context import Context
from hathor.nanocontracts.exception import NCFail
from hathor.nanocontracts.types import (
    Address,
    Amount,
    ContractId,
    BlueprintId,
    NCDepositAction,
    NCWithdrawalAction,
    Timestamp,
    TokenUid,
    NCAction,
    NCActionType,
    public,
    view,
)
import logging

logger = logging.getLogger(__name__)

HTR_UID = settings.HATHOR_TOKEN_UID

# Custom error classes
class ChildNotFound(NCFail):
    """Raised when trying to use a child that doesn't exist."""
    pass

class TokenNotFound(NCFail):
    """Raised when trying to use a token that doesn't exist."""
    pass

class FatherTestBlueprint(Blueprint):

    # list of children 
    children: list[ContractId]

    # child blueprint id
    child_blueprint_id: BlueprintId

    # list of tokens we have
    tokens: list[TokenUid]


    @public
    def initialize(self, ctx: Context, child_blueprint_id: BlueprintId) -> None:
        """Initialize the DozerPoolManager contract.

        Sets up the initial state for the contract.
        """
        self.child_blueprint_id = child_blueprint_id

    @public
    def create_child(self, ctx: Context) -> ContractId:
        child_id, _ = self.syscall.create_contract(self.child_blueprint_id,
                                     len(self.children).to_bytes(4, byteorder='big', signed=False),
                                     [], self.syscall.get_contract_id()
                                    )
        self.children.append(child_id)
        return child_id

    @view
    def get_children(self) -> list[ContractId]:
        return self.children

    @public(allow_deposit=True)
    def deposit(self, ctx: Context) -> None:
        return

    @public
    def create_token(self, ctx: Context, name: str, symbol: str, amount: int) -> TokenUid:
        token_id = self.syscall.create_token(name, symbol, amount)
        self.tokens.append(token_id)
        return token_id

    @public
    def mint_tokens(self, ctx: Context, token_id: TokenUid, amount: int) -> TokenUid:
        if token_id not in self.tokens:
            raise TokenNotFound

        self.syscall.mint_tokens(token_id, amount)

    @public
    def transfer_to_child(self, ctx: Context, child_id: ContractId, token_id: TokenUid, amount: int) -> None:
        if child_id not in self.children:
            raise ChildNotFound

        actions = [NCDepositAction(token_uid=token_id, amount=amount)]
        self.syscall.call_public_method(child_id, "deposit", actions)
