#!/usr/bin/env python3
"""Build a TD Snap import experiment from a native SPB and a TLA Board JSON.

This is an offline investigation tool, not the application's export feature.
The source SPB is opened read-only. Native metadata and sync hash algorithms
are unknown; only a real TD Snap import can establish compatibility.
"""

import argparse
import base64
import hashlib
import json
import re
import sqlite3
import tempfile
import time
import uuid
from pathlib import Path


ZERO_UUID = "00000000-0000-0000-0000-000000000000"
EXPECTED_COMMAND = {"$type": "1", "$values": [{"$type": "3", "MessageAction": 0}]}


def insert(connection, table, values):
    columns = ",".join('"' + key + '"' for key in values)
    placeholders = ",".join("?" for _ in values)
    cursor = connection.execute(
        f'INSERT INTO "{table}" ({columns}) VALUES ({placeholders})',
        list(values.values()),
    )
    return cursor.lastrowid


def record(connection, table, row_id):
    row = connection.execute(f'SELECT * FROM "{table}" WHERE Id=?', (row_id,)).fetchone()
    if row is None:
        raise ValueError(f"Missing native template record: {table} {row_id}")
    return {key: row[key] for key in row.keys() if key != "Id"}


def argb(color):
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError(f"Expected an RGB hex color, got {color!r}")
    return (0xFF000000 | int(color[1:], 16)) - 0x100000000


def png_data(cell, asset_root):
    source = cell.get("imageData", "")
    if source.startswith("data:image/png;base64,"):
        data = base64.b64decode(source.split(",", 1)[1], validate=True)
    else:
        # Prototype accepts only the local Sclera bank or an embedded PNG.
        if cell.get("source") != "sclera" or not isinstance(cell.get("pictogramId"), int):
            raise ValueError("Prototype needs an embedded PNG or a local Sclera pictogram")
        image = (asset_root / f'{cell["pictogramId"]}.png').resolve(strict=True)
        if image.parent != asset_root.resolve(strict=True):
            raise ValueError("Image path outside the supplied asset root")
        data = image.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Invalid PNG image")
    return data


def validate(connection, board, source):
    if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
        raise ValueError("SQLite integrity check failed")
    if connection.execute("PRAGMA foreign_key_check").fetchall():
        raise ValueError("SQLite foreign key check failed")
    cells = board["cells"]
    for table, expected in [("Page", 1), ("PageLayout", 2), ("Button", len(cells)),
                            ("ElementReference", len(cells)), ("CommandSequence", len(cells)),
                            ("ElementPlacement", 2 * len(cells)), ("ButtonPageLink", 0)]:
        actual = connection.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
        if actual != expected:
            raise ValueError(f"Unexpected {table} count: {actual}")
    for row in connection.execute("SELECT SerializedCommands FROM CommandSequence"):
        if json.loads(row[0]) != EXPECTED_COMMAND:
            raise ValueError("Unexpected command sequence")
    source_ids = {row[0] for table in ("Page", "Button", "PageSetProperties")
                  for row in source.execute(f'SELECT UniqueId FROM "{table}"')}
    output_ids = [row[0] for table in ("Page", "Button", "PageSetProperties")
                  for row in connection.execute(f'SELECT UniqueId FROM "{table}"')]
    if len(output_ids) != len(set(output_ids)) or source_ids.intersection(output_ids):
        raise ValueError("UUID collision")
    for value in output_ids:
        uuid.UUID(value)
    layouts = connection.execute("SELECT Id FROM PageLayout").fetchall()
    expected_positions = {(cell["column"], cell["row"]) for cell in cells}
    for (layout_id,) in layouts:
        positions = [tuple(map(int, row[0].split(","))) for row in connection.execute(
            "SELECT GridPosition FROM ElementPlacement WHERE PageLayoutId=?", (layout_id,))]
        if len(positions) != len(set(positions)) or set(positions) != expected_positions:
            raise ValueError("Invalid or overlapping placements")
    broken = connection.execute("""
        SELECT count(*) FROM Button b
        LEFT JOIN ElementReference e ON e.Id=b.ElementReferenceId
        LEFT JOIN Page p ON p.Id=e.PageId
        LEFT JOIN PageSetData d ON d.Id=b.PageSetImageId
        LEFT JOIN CommandSequence c ON c.ButtonId=b.Id
        WHERE e.Id IS NULL OR p.Id IS NULL OR d.Id IS NULL OR c.Id IS NULL
    """).fetchone()[0]
    if broken:
        raise ValueError("Broken button references")
    for data_id, identifier, data, refcount in connection.execute(
            "SELECT Id,Identifier,Data,RefCount FROM PageSetData"):
        expected_id = "IMG:" + base64.b64encode(hashlib.sha1(data).digest()).decode("ascii")
        references = connection.execute(
            "SELECT count(*) FROM Button WHERE PageSetImageId=?", (data_id,)).fetchone()[0]
        if identifier != expected_id or refcount != references:
            raise ValueError("Invalid media hash or reference count")
    actual = connection.execute("""
        SELECT ep.GridPosition,b.Label,er.BackgroundColor,d.Data
        FROM ElementPlacement ep JOIN ElementReference er ON er.Id=ep.ElementReferenceId
        JOIN Button b ON b.ElementReferenceId=er.Id
        JOIN PageSetData d ON d.Id=b.PageSetImageId
        WHERE ep.PageLayoutId=?
    """, (layouts[0][0],)).fetchall()
    by_position = {position: (label, color, data) for position, label, color, data in actual}
    for cell in cells:
        label, color, _ = by_position[f'{cell["column"]},{cell["row"]}']
        if label != cell["label"] or color != argb(cell["colorOverride"]):
            raise ValueError("Export does not match the supplied TLA")


def build(template, board_path, output, asset_root):
    if output.exists():
        raise ValueError("Choose a new output path; existing files are never overwritten")
    source_hash = hashlib.sha256(template.read_bytes()).hexdigest()
    source = sqlite3.connect(template.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    source.row_factory = sqlite3.Row
    board = json.loads(board_path.read_text(encoding="utf-8"))
    columns, rows = board["columns"], board["rows"]
    if not isinstance(columns, int) or not isinstance(rows, int) or not (1 <= columns <= 10 and 1 <= rows <= 8):
        raise ValueError("Invalid prototype grid dimensions")
    positions = [(cell["column"], cell["row"]) for cell in board["cells"]]
    if len(set(positions)) != len(positions) or any(
            not (0 <= col < columns and 0 <= row < rows) for col, row in positions):
        raise ValueError("Invalid TLA cell positions")
    if len(positions) != columns * rows or any(not cell.get("label", "").strip() for cell in board["cells"]):
        raise ValueError("Prototype requires a full grid of labelled cells")
    properties = record(source, "PageSetProperties", 1)
    if properties["SchemaVersion"] != "4.13":
        raise ValueError("Prototype only investigated for native schema 4.13")
    native = source.execute("""
        SELECT b.Id,b.ElementReferenceId FROM Button b
        JOIN CommandSequence c ON c.ButtonId=b.Id
        WHERE b.CommandFlags=8 AND b.Message IS NULL
        ORDER BY b.Id LIMIT 1
    """).fetchone()
    if native is None:
        raise ValueError("Native speaking button template not found")
    button = record(source, "Button", native["Id"])
    element = record(source, "ElementReference", native["ElementReferenceId"])
    page = record(source, "Page", element["PageId"])
    command = source.execute("SELECT SerializedCommands FROM CommandSequence WHERE ButtonId=?",
                             (native["Id"],)).fetchone()[0]
    if json.loads(command) != EXPECTED_COMMAND:
        raise ValueError("Unexpected native command template")
    page_uuid = str(uuid.uuid4())
    ticks = 621355968000000000 + time.time_ns() // 100
    dimension = f"{columns},{rows}"
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="td-snap-", dir=output.parent) as temporary:
        path = Path(temporary) / "prototype.spb"
        connection = sqlite3.connect(path)
        connection.execute(f'PRAGMA page_size={source.execute("PRAGMA page_size").fetchone()[0]}')
        for schema in source.execute("""
            SELECT sql FROM sqlite_master
            WHERE type IN ('table','index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
            ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name
        """):
            connection.execute(schema[0])
        # Keep unknown native metadata and hashes exactly as supplied. They are
        # NOT recalculated or claimed valid after edits; an iPad import is needed.
        page.update(UniqueId=page_uuid, Title=board["title"], Language="fr_FR",
                    Timestamp=ticks, LibrarySymbolId=0, PageSetImageId=0,
                    SymbolColorDataId=0, GridDimension=dimension)
        page_id = insert(connection, "Page", page)
        for key in ("DefaultKeyboardPageUniqueId", "ToolBarUniqueId", "DashboardUniqueId", "MessageBarUniqueId"):
            properties[key] = ZERO_UUID
        properties.update(UniqueId=str(uuid.uuid4()), FriendlyName=board["title"],
                          Description="Prototype TLA Flash. Pictogrammes : www.sclera.be — CC BY-NC 2.0 BE. Import iPad à valider.",
                          Language="fr_FR", Timestamp=ticks, DefaultHomePageUniqueId=page_uuid,
                          GridDimension=dimension, SerializedPreferredGridDimensions=dimension,
                          IconImageId=0)
        insert(connection, "PageSetProperties", properties)
        synchronization = record(source, "Synchronization", 1)
        synchronization.update(SyncServerIdentifier=None, PageSetTimestamp=ticks)
        insert(connection, "Synchronization", synchronization)
        layout_ids = [insert(connection, "PageLayout", {
            "PageLayoutSetting": f"{dimension},{flag},0", "PageId": page_id,
        }) for flag in ("False", "True")]
        for cell in board["cells"]:
            data = png_data(cell, asset_root)
            identifier = "IMG:" + base64.b64encode(hashlib.sha1(data).digest()).decode("ascii")
            existing = connection.execute("SELECT Id FROM PageSetData WHERE Identifier=?", (identifier,)).fetchone()
            if existing:
                image_id = existing[0]
                connection.execute("UPDATE PageSetData SET RefCount=RefCount+1 WHERE Id=?", (image_id,))
            else:
                image_id = insert(connection, "PageSetData", {"Identifier": identifier, "Data": data, "RefCount": 1})
            element_values = dict(element, PageId=page_id, BackgroundColor=argb(cell["colorOverride"]),
                                  ForegroundColor=argb("#1c1d1e"), AudioCue=None,
                                  UseAudioCueRecording=None, AudioCueRecordingId=0,
                                  SerializedAudioCueSoundMetadata=None, SerializedAccessSettingOverrides=None)
            element_id = insert(connection, "ElementReference", element_values)
            button_values = dict(button, UniqueId=str(uuid.uuid4()), Label=cell["label"], Message=None,
                                 LabelOwnership=3, ImageOwnership=3, LibrarySymbolId=0,
                                 PageSetImageId=image_id, SymbolColorDataId=0,
                                 MessageRecordingId=0, UseMessageRecording=None,
                                 SerializedMessageSoundMetadata=None, ElementReferenceId=element_id,
                                 FontSize=1.5, BorderThickness=1.0, BorderColor=argb("#1c1d1e"))
            button_id = insert(connection, "Button", button_values)
            insert(connection, "CommandSequence", {"SerializedCommands": command, "ButtonId": button_id})
            for layout_id in layout_ids:
                insert(connection, "ElementPlacement", {
                    "GridPosition": f'{cell["column"]},{cell["row"]}', "GridSpan": "1,1",
                    "Visible": 1, "ElementReferenceId": element_id, "PageLayoutId": layout_id,
                })
        connection.commit()
        validate(connection, board, source)
        connection.close()
        if hashlib.sha256(template.read_bytes()).hexdigest() != source_hash:
            raise ValueError("The source file changed during analysis")
        path.rename(output)
    source.close()
    print(json.dumps({"output": str(output), "pages": 1, "buttons": len(board["cells"]),
                      "layouts": 2, "bytes": output.stat().st_size,
                      "source_unchanged": True, "sqlite_and_reference_checks": "passed",
                      "td_snap_import": "not tested"}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--board", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-root", type=Path, required=True)
    arguments = parser.parse_args()
    build(arguments.template, arguments.board, arguments.output, arguments.asset_root)
