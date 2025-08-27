import structlog
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional

logger = structlog.get_logger()
router = APIRouter()


class MethodParameter(BaseModel):
    name: str
    type: str


class MethodDefinition(BaseModel):
    name: str
    decorator: str
    description: str | None = None
    parameters: List[MethodParameter]
    return_type: Optional[str] = None


class PromptRequest(BaseModel):
    contract_name: str
    methods: List[MethodDefinition]


class PromptResponse(BaseModel):
    prompt: str


HATHOR_GUIDE = """
Frontend integration guide for Hathor:
1. Use WalletConnect to establish a session with a Hathor-compatible wallet (mobile or browser).
2. Once connected, send RPC requests through the provider. To execute `@public` nano-contract methods, call `htr_sendNanoContractTx` with the contract id, method name, arguments, and required tokens so the wallet can sign and broadcast the transaction.
3. For `@view` methods, invoke the appropriate read-only RPC without signing to query state.
4. Always handle token decimals (last two digits are decimals) and ensure IDs such as TokenUid or ContractId are 64 hex chars.
See the official documentation for details: https://docs.hathor.network/references/sdk/dapp/wallet-integration-development
"""


@router.post("/prompt", response_model=PromptResponse)
async def generate_frontend_prompt(req: PromptRequest) -> PromptResponse:
    parts: List[str] = []
    parts.append(
        f"You are an expert dApp frontend developer. Build a UI for the Hathor nano-contract blueprint \"{req.contract_name}\"."
    )
    parts.append("The blueprint exposes the following methods:")
    for m in req.methods:
        params = ", ".join(f"{p.name}: {p.type}" for p in m.parameters)
        ret = f" -> {m.return_type}" if m.return_type else ""
        parts.append(f"\n{m.decorator.upper()} {m.name}({params}){ret}")
        if m.description:
            parts.append(m.description)
    parts.append(
        "\nUse WalletConnect to integrate these methods with a Hathor wallet. Follow this guide:\n"
        + HATHOR_GUIDE
    )
    prompt = "\n".join(parts)
    logger.info("Generated frontend prompt", contract=req.contract_name)
    return PromptResponse(prompt=prompt)
