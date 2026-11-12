"""Reader interface shared by the CHAFON, line-based and simulated backends."""
from __future__ import annotations

import abc
from typing import List


class ReaderError(Exception):
    """The reader could not complete an inventory round (unplugged, no response...)."""


class Reader(abc.ABC):
    @abc.abstractmethod
    def open(self) -> None:
        """Connect to the reader. Raises ReaderError if it is unreachable."""

    @abc.abstractmethod
    def close(self) -> None:
        """Release the port. Safe to call when already closed."""

    @property
    @abc.abstractmethod
    def is_open(self) -> bool: ...

    @abc.abstractmethod
    def inventory(self) -> List[str]:
        """Run one inventory round and return the EPCs read (hex; duplicates allowed).

        An empty list means "the reader answered and saw no tags". Raise
        ReaderError when the reader did not answer at all - the gateway must
        not mistake a dead reader for an empty cargo area.
        """
