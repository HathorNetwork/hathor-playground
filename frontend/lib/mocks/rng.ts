export const rngMock = `# Stub module for browser compatibility
import random
from typing import Sequence, TypeVar

T = TypeVar('T')

class NanoRNG:
    """Mock implementation of deterministic RNG for browser compatibility."""
    
    def __init__(self, seed: bytes) -> None:
        self.__seed = seed
        # Use Python's random with a deterministic seed derived from the input
        seed_int = int.from_bytes(seed[:8], byteorder='little') if len(seed) >= 8 else 0
        self._rng = random.Random(seed_int)
    
    @property
    def seed(self):
        """Return the seed used to create the RNG."""
        return self.__seed
    
    def randbytes(self, size: int) -> bytes:
        """Return a random string of bytes."""
        return bytes([self._rng.randint(0, 255) for _ in range(size)])
    
    def randbits(self, bits: int) -> int:
        """Return a random integer in the range [0, 2**bits)."""
        return self._rng.getrandbits(bits)
    
    def randbelow(self, n: int) -> int:
        """Return a random integer in the range [0, n)."""
        return self._rng.randrange(n)
    
    def randrange(self, start: int, stop: int, step: int = 1) -> int:
        """Return a random integer in the range [start, stop) with a given step."""
        return self._rng.randrange(start, stop, step)
    
    def randint(self, a: int, b: int) -> int:
        """Return a random integer in the range [a, b]."""
        return self._rng.randint(a, b)
    
    def choice(self, seq: Sequence[T]) -> T:
        """Choose a random element from a non-empty sequence."""
        return self._rng.choice(seq)
    
    def random(self) -> float:
        """Return a random float in the range [0, 1)."""
        return self._rng.random()`;

