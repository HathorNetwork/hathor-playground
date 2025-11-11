"""
Environment detection module for unified agent.

Automatically detects whether the user is working with:
- Blueprints (Hathor nano contracts in Python)
- dApps (Next.js applications)
- Mixed projects (both blueprints and dApps)
"""

from enum import Enum
from typing import Dict, Tuple
import structlog

logger = structlog.get_logger()


class EnvironmentType(Enum):
    """Type of development environment"""
    BLUEPRINT = "blueprint"
    DAPP = "dapp"
    MIXED = "mixed"
    EMPTY = "empty"


class EnvironmentContext:
    """Context about the detected environment"""

    def __init__(
        self,
        env_type: EnvironmentType,
        confidence: float,
        blueprint_files: list[str],
        dapp_files: list[str],
        reason: str
    ):
        self.env_type = env_type
        self.confidence = confidence
        self.blueprint_files = blueprint_files
        self.dapp_files = dapp_files
        self.reason = reason

    def __repr__(self):
        return f"EnvironmentContext(type={self.env_type.value}, confidence={self.confidence:.2f})"


def detect_environment(
    files: Dict[str, str],
    message: str = ""
) -> EnvironmentContext:
    """
    Detect the development environment based on project files and user message.

    Uses multiple heuristics:
    1. File path analysis (highest confidence)
    2. File content analysis (medium confidence)
    3. Message intent analysis (lowest confidence)

    Args:
        files: Dictionary mapping file paths to content
        message: User's message (optional, for intent analysis)

    Returns:
        EnvironmentContext with detected type and confidence score
    """
    logger.info("Detecting environment", file_count=len(files))

    # Categorize files by path
    blueprint_files = [
        path for path in files.keys()
        if (path.startswith('/blueprints/') or path.startswith('/contracts/')) and path.endswith('.py')
    ]

    dapp_files = [
        path for path in files.keys()
        if path.startswith('/dapp/')
    ]

    # === Heuristic 1: File Path Analysis (95% confidence) ===

    has_blueprints = len(blueprint_files) > 0
    has_dapps = len(dapp_files) > 0

    if has_blueprints and has_dapps:
        logger.info(
            "Mixed project detected",
            blueprints=len(blueprint_files),
            dapp_files=len(dapp_files)
        )
        return EnvironmentContext(
            env_type=EnvironmentType.MIXED,
            confidence=0.95,
            blueprint_files=blueprint_files,
            dapp_files=dapp_files,
            reason=f"Found {len(blueprint_files)} blueprint(s) and {len(dapp_files)} dApp file(s)"
        )

    if has_blueprints:
        logger.info("Blueprint project detected", count=len(blueprint_files))
        return EnvironmentContext(
            env_type=EnvironmentType.BLUEPRINT,
            confidence=0.95,
            blueprint_files=blueprint_files,
            dapp_files=[],
            reason=f"Found {len(blueprint_files)} blueprint file(s) in /blueprints/"
        )

    if has_dapps:
        logger.info("dApp project detected", count=len(dapp_files))
        return EnvironmentContext(
            env_type=EnvironmentType.DAPP,
            confidence=0.95,
            blueprint_files=[],
            dapp_files=dapp_files,
            reason=f"Found {len(dapp_files)} dApp file(s) in /dapp/"
        )

    # === Heuristic 2: File Content Analysis (85% confidence) ===

    if not files:
        logger.info("Empty project detected")
        return EnvironmentContext(
            env_type=EnvironmentType.EMPTY,
            confidence=0.95,
            blueprint_files=[],
            dapp_files=[],
            reason="No files in project"
        )

    # Check file content for Hathor imports or Next.js patterns
    blueprint_indicators = 0
    dapp_indicators = 0

    for path, content in files.items():
        # Blueprint indicators
        if any(indicator in content for indicator in [
            'from hathor.nanocontracts',
            'import hathor',
            '@public',
            '@view',
            '__blueprint__',
            'Blueprint',
            'Context'
        ]):
            blueprint_indicators += 1

        # dApp indicators
        if any(indicator in content for indicator in [
            'next.config',
            'package.json',
            'tailwind.config',
            'tsconfig.json',
            'import React',
            'export default',
            'use client',
            'use server'
        ]):
            dapp_indicators += 1

    if blueprint_indicators > 0 and dapp_indicators > 0:
        logger.info(
            "Mixed project detected via content",
            blueprint_indicators=blueprint_indicators,
            dapp_indicators=dapp_indicators
        )
        return EnvironmentContext(
            env_type=EnvironmentType.MIXED,
            confidence=0.85,
            blueprint_files=list(files.keys()),  # All files could be relevant
            dapp_files=list(files.keys()),
            reason="Found both Hathor and Next.js indicators in file content"
        )

    if blueprint_indicators > 0:
        logger.info("Blueprint detected via content", indicators=blueprint_indicators)
        return EnvironmentContext(
            env_type=EnvironmentType.BLUEPRINT,
            confidence=0.85,
            blueprint_files=list(files.keys()),
            dapp_files=[],
            reason=f"Found Hathor indicators in {blueprint_indicators} file(s)"
        )

    if dapp_indicators > 0:
        logger.info("dApp detected via content", indicators=dapp_indicators)
        return EnvironmentContext(
            env_type=EnvironmentType.DAPP,
            confidence=0.85,
            blueprint_files=[],
            dapp_files=list(files.keys()),
            reason=f"Found Next.js indicators in {dapp_indicators} file(s)"
        )

    # === Heuristic 3: Message Intent Analysis (70% confidence) ===

    if message:
        message_lower = message.lower()

        # Blueprint keywords
        blueprint_keywords = [
            'blueprint', 'contract', 'nano contract', '@public', '@view',
            'compile', 'hathor', 'initialize', 'method', 'ctx', 'context'
        ]

        # dApp keywords
        dapp_keywords = [
            'dapp', 'd-app', 'frontend', 'next.js', 'nextjs', 'react',
            'component', 'page', 'button', 'ui', 'interface', 'style',
            'tailwind', 'app router', 'bootstrap'
        ]

        blueprint_matches = sum(1 for kw in blueprint_keywords if kw in message_lower)
        dapp_matches = sum(1 for kw in dapp_keywords if kw in message_lower)

        if blueprint_matches > 0 and dapp_matches > 0:
            logger.info(
                "Mixed intent detected in message",
                blueprint_keywords=blueprint_matches,
                dapp_keywords=dapp_matches
            )
            return EnvironmentContext(
                env_type=EnvironmentType.MIXED,
                confidence=0.70,
                blueprint_files=[],
                dapp_files=[],
                reason=f"Message mentions both blueprint ({blueprint_matches}) and dApp ({dapp_matches}) keywords"
            )

        if blueprint_matches > dapp_matches and blueprint_matches > 0:
            logger.info("Blueprint intent detected in message", matches=blueprint_matches)
            return EnvironmentContext(
                env_type=EnvironmentType.BLUEPRINT,
                confidence=0.70,
                blueprint_files=[],
                dapp_files=[],
                reason=f"Message mentions {blueprint_matches} blueprint-related keyword(s)"
            )

        if dapp_matches > blueprint_matches and dapp_matches > 0:
            logger.info("dApp intent detected in message", matches=dapp_matches)
            return EnvironmentContext(
                env_type=EnvironmentType.DAPP,
                confidence=0.70,
                blueprint_files=[],
                dapp_files=[],
                reason=f"Message mentions {dapp_matches} dApp-related keyword(s)"
            )

    # === Default: Empty/Unknown ===

    logger.info("Could not determine environment, defaulting to EMPTY")
    return EnvironmentContext(
        env_type=EnvironmentType.EMPTY,
        confidence=0.50,
        blueprint_files=[],
        dapp_files=[],
        reason="No clear indicators found, empty project"
    )


def should_enable_blueprint_tools(context: EnvironmentContext) -> bool:
    """Determine if blueprint tools should be enabled"""
    return context.env_type in [
        EnvironmentType.BLUEPRINT,
        EnvironmentType.MIXED,
        EnvironmentType.EMPTY  # Allow creating blueprints in empty projects
    ]


def should_enable_dapp_tools(context: EnvironmentContext) -> bool:
    """Determine if dApp tools should be enabled"""
    return context.env_type in [
        EnvironmentType.DAPP,
        EnvironmentType.MIXED,
        EnvironmentType.EMPTY  # Allow creating dApps in empty projects
    ]
