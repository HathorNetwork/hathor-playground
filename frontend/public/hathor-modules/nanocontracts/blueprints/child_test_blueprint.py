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


# Custom error classes
class InvalidAction(NCFail):
    """Raised when an invalid token action is provided."""  
    pass


class ChildTestBlueprint(Blueprint):

    father: ContractId

    @public
    def initialize(self, ctx: Context, father: ContractId) -> None:
        self.father = father

    @public(allow_deposit=True)
    def deposit(self, ctx: Context) -> None:
        return

    @public(allow_withdrawal=True)
    def withdraw(self, ctx: Context) -> None:
        return
