"""In-memory stand-in for Firestore, used by ``--dry-run`` and the tests.

It applies the same REST ``Write`` objects the real client sends, with the
parts of Firestore semantics the gateway relies on: ``currentDocument``
preconditions, ``updateMask``, ``REQUEST_TIME`` and ``appendMissingElements``
transforms, atomic commits and equality queries. Nothing leaves the machine.

An optional ``validator`` is called for every write with
``(path, before, after, request_time)`` and may raise ``PermanentError`` -
the tests plug in an emulation of the device role in ``firestore.rules``.
"""
from __future__ import annotations

import copy
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple, Union

from .firebase_client import Document, PermanentError, Write, decode_fields, decode_value, describe_write, doc_path

log = logging.getLogger("smartroute.dryrun")

Validator = Callable[[str, Optional[Document], Document, datetime], None]


def _get(doc: Mapping[str, Any], segments: Sequence[str]) -> Tuple[bool, Any]:
    node: Any = doc
    for seg in segments:
        if not isinstance(node, Mapping) or seg not in node:
            return False, None
        node = node[seg]
    return True, node


def _set(doc: Dict[str, Any], segments: Sequence[str], value: Any) -> None:
    node = doc
    for seg in segments[:-1]:
        child = node.get(seg)
        if not isinstance(child, dict):
            child = node[seg] = {}
        node = child
    node[segments[-1]] = value


def _delete(doc: Dict[str, Any], segments: Sequence[str]) -> None:
    found, parent = _get(doc, segments[:-1])
    if found and isinstance(parent, dict):
        parent.pop(segments[-1], None)


def apply_write(before: Optional[Document], write: Write, request_time: datetime) -> Document:
    """Return the document after ``write`` (raises PermanentError on a failed precondition)."""
    exists = write.get("currentDocument", {}).get("exists")
    if exists is True and before is None:
        raise PermanentError("NOT_FOUND: no document to update", "NOT_FOUND", 404)
    if exists is False and before is not None:
        raise PermanentError("ALREADY_EXISTS: document already exists", "ALREADY_EXISTS", 409)

    data = decode_fields(write["update"].get("fields", {}))
    mask = write.get("updateMask")
    if mask is None:
        doc: Document = data
    else:
        doc = copy.deepcopy(before) if before else {}
        for path in mask.get("fieldPaths", []):
            segments = path.split(".")
            found, value = _get(data, segments)
            if found:
                _set(doc, segments, value)
            else:
                _delete(doc, segments)

    for transform in write.get("updateTransforms", []):
        segments = transform["fieldPath"].split(".")
        if transform.get("setToServerValue") == "REQUEST_TIME":
            _set(doc, segments, request_time)
        elif "appendMissingElements" in transform:
            found, current = _get(doc, segments)
            array = list(current) if found and isinstance(current, list) else []
            for raw in transform["appendMissingElements"].get("values", []):
                value = decode_value(raw)
                if value not in array:
                    array.append(value)
            _set(doc, segments, array)
        else:
            raise PermanentError(f"INVALID_ARGUMENT: unsupported transform {transform}", "INVALID_ARGUMENT", 400)
    return doc


class InMemoryFirestore:
    def __init__(
        self,
        database: str,
        docs: Optional[Mapping[str, Document]] = None,
        clock: Callable[[], float] = time.time,
        validator: Optional[Validator] = None,
        log_writes: bool = False,
    ) -> None:
        self.database = database
        #: ``"collection/id" -> fields``
        self.docs: Dict[str, Document] = copy.deepcopy(dict(docs or {}))
        #: Every successful commit, as sent (handy for assertions).
        self.commits: List[List[Write]] = []
        self._clock = clock
        self._validator = validator
        self._log_writes = log_writes

    @classmethod
    def from_fixture(cls, path: Union[str, Path], database: str, **kwargs: Any) -> "InMemoryFirestore":
        """Load ``{"collection": {"docId": {fields}}}`` JSON."""
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        docs = {f"{coll}/{doc_id}": fields for coll, items in raw.items() for doc_id, fields in items.items()}
        return cls(database, docs, **kwargs)

    def get_document(self, path: str) -> Optional[Document]:
        return copy.deepcopy(self.docs.get(path))

    def run_query(self, collection: str, equals: Mapping[str, Any], limit: Optional[int] = None) -> List[Tuple[str, Document]]:
        rows: List[Tuple[str, Document]] = []
        for path in sorted(self.docs):
            coll, _, doc_id = path.rpartition("/")
            data = self.docs[path]
            if coll == collection and all(k in data and data[k] == v for k, v in equals.items()):
                rows.append((doc_id, copy.deepcopy(data)))
                if limit and len(rows) >= limit:
                    break
        return rows

    def commit(self, writes: Sequence[Write]) -> None:
        request_time = datetime.fromtimestamp(self._clock(), tz=timezone.utc)
        staged = dict(self.docs)  # all-or-nothing, like a Firestore commit
        for write in writes:
            path = doc_path(write["update"]["name"])
            before = staged.get(path)
            after = apply_write(before, write, request_time)
            if self._validator:
                self._validator(path, before, after, request_time)
            staged[path] = after
        self.docs = staged
        self.commits.append(copy.deepcopy(list(writes)))
        if self._log_writes:
            for write in writes:
                log.info("DRY-RUN %s", describe_write(write))
