#!/usr/bin/env python3
"""Import experiment: update an existing personal TD Snap page in a copy.

No new page identity or licence metadata is generated. The native page, its
name, and its metadata are preserved. This experiment may replace that SAME
page when imported into TD Snap. An actual iPad test is still required.
"""

import argparse
import base64
import hashlib
import json
import sqlite3
import tempfile
import time
import uuid
from pathlib import Path


MEDIA_REFERENCES = [
    ("Button", "PageSetImageId"), ("Button", "MessageRecordingId"),
    ("ElementReference", "AudioCueRecordingId"), ("ScanGroup", "AudioCueRecordingId"),
    ("Page", "PageSetImageId"), ("PageSetProperties", "IconImageId"),
    ("Whiteboard", "ThumbnailImageId"), ("WhiteboardImage", "PageSetImageId"),
]


def readonly(path):
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def insert(connection, table, values):
    names = ",".join(f'"{key}"' for key in values)
    parameters = ",".join("?" for _ in values)
    return connection.execute(f'INSERT INTO "{table}" ({names}) VALUES ({parameters})',
                              list(values.values())).lastrowid


def without_id(row):
    return {key: row[key] for key in row.keys() if key != "Id"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main(native_path, donor_path, page_title, output):
    if output.exists():
        raise ValueError("Existing output preserved; choose a new filename")
    native_hash, donor_hash = digest(native_path), digest(donor_path)
    native, donor = readonly(native_path), readonly(donor_path)
    candidates = native.execute("SELECT * FROM Page WHERE Title=? AND PageType=1", (page_title,)).fetchall()
    if len(candidates) != 1:
        raise ValueError("Select exactly one existing personal page by title")
    native_page = candidates[0]
    page_id = native_page["Id"]
    native_element = native.execute(
        "SELECT * FROM ElementReference WHERE PageId=? AND ElementType=0 ORDER BY Id LIMIT 1",
        (page_id,)).fetchone()
    if native_element is None:
        raise ValueError("No ordinary native button element found on this page")
    native_button = native.execute("SELECT * FROM Button WHERE ElementReferenceId=?",
                                   (native_element["Id"],)).fetchone()
    native_command = native.execute("SELECT SerializedCommands FROM CommandSequence WHERE ButtonId=?",
                                    (native_button["Id"],)).fetchone()[0]
    expected_command = {"$type": "1", "$values": [{"$type": "3", "MessageAction": 0}]}
    if json.loads(native_command) != expected_command:
        raise ValueError("This experiment only supports a native ordinary message button")
    donor_pages = donor.execute("SELECT * FROM Page").fetchall()
    if len(donor_pages) != 1:
        raise ValueError("Donor must contain exactly one TLA page")
    dimension = donor_pages[0]["GridDimension"]
    columns, rows = map(int, dimension.split(","))
    donor_layout = donor.execute(
        "SELECT * FROM PageLayout WHERE PageId=? ORDER BY Id LIMIT 1",
        (donor_pages[0]["Id"],)).fetchone()
    records = donor.execute("""
        SELECT b.*,e.ForegroundColor,e.BackgroundColor,p.GridPosition,p.GridSpan,p.Visible
        FROM Button b JOIN ElementReference e ON e.Id=b.ElementReferenceId
        JOIN ElementPlacement p ON p.ElementReferenceId=e.Id
        WHERE p.PageLayoutId=? ORDER BY p.Id
    """, (donor_layout["Id"],)).fetchall()
    if not records:
        raise ValueError("No TLA buttons found")

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="native-page-", dir=output.parent) as directory:
        temporary = Path(directory) / "test.spb"
        target = sqlite3.connect(temporary)
        target.row_factory = sqlite3.Row
        native.backup(target)
        target.execute("PRAGMA secure_delete=ON")
        target.execute("""DELETE FROM CommandSequence WHERE ButtonId IN (
            SELECT b.Id FROM Button b JOIN ElementReference e ON e.Id=b.ElementReferenceId WHERE e.PageId=?)""", (page_id,))
        target.execute("""DELETE FROM ButtonPageLink WHERE ButtonId IN (
            SELECT b.Id FROM Button b JOIN ElementReference e ON e.Id=b.ElementReferenceId WHERE e.PageId=?)""", (page_id,))
        target.execute("DELETE FROM Button WHERE ElementReferenceId IN (SELECT Id FROM ElementReference WHERE PageId=?)", (page_id,))
        target.execute("DELETE FROM ElementPlacement WHERE PageLayoutId IN (SELECT Id FROM PageLayout WHERE PageId=?)", (page_id,))
        target.execute("DELETE FROM ScanGroup WHERE PageLayoutId IN (SELECT Id FROM PageLayout WHERE PageId=?)", (page_id,))
        target.execute("DELETE FROM ElementReference WHERE PageId=? AND ElementType=0", (page_id,))
        # Only page dimensions and its modification time change. The UUID,
        # title, SerializedMetadata and SyncHash are never replaced or forged.
        ticks = 621355968000000000 + time.time_ns() // 100
        target.execute("UPDATE Page SET GridDimension=?,Timestamp=? WHERE Id=?", (dimension, ticks, page_id))
        layout_ids = []
        for layout in target.execute("SELECT * FROM PageLayout WHERE PageId=?", (page_id,)).fetchall():
            settings = layout["PageLayoutSetting"].split(",")
            settings[0:2] = [str(columns), str(rows)]
            target.execute("UPDATE PageLayout SET PageLayoutSetting=? WHERE Id=?", (",".join(settings), layout["Id"]))
            layout_ids.append(layout["Id"])
        if not layout_ids:
            raise ValueError("The native page has no layout")
        for record in records:
            position = tuple(map(int, record["GridPosition"].split(",")))
            if not (0 <= position[0] < columns and 0 <= position[1] < rows):
                raise ValueError("TLA position outside its grid")
            media_id = 0
            if record["PageSetImageId"]:
                media = donor.execute("SELECT * FROM PageSetData WHERE Id=?", (record["PageSetImageId"],)).fetchone()
                expected_identifier = "IMG:" + base64.b64encode(hashlib.sha1(media["Data"]).digest()).decode("ascii")
                if media["Identifier"] != expected_identifier:
                    raise ValueError("Donor image integrity mismatch")
                existing = target.execute("SELECT Id,Data FROM PageSetData WHERE Identifier=?", (media["Identifier"],)).fetchone()
                if existing:
                    if existing["Data"] != media["Data"]:
                        raise ValueError("Image identifier collision")
                    media_id = existing["Id"]
                else:
                    media_id = insert(target, "PageSetData", {"Identifier": media["Identifier"], "Data": media["Data"], "RefCount": 0})
            element = without_id(native_element)
            element.update(PageId=page_id, ForegroundColor=record["ForegroundColor"], BackgroundColor=record["BackgroundColor"])
            element_id = insert(target, "ElementReference", element)
            button = without_id(native_button)
            for key in ("Label", "Message", "LabelOwnership", "ImageOwnership", "BorderColor", "BorderThickness",
                        "FontSize", "FontStyle", "FontFamily", "SmartSymLayout"):
                button[key] = record[key]
            button.update(UniqueId=str(uuid.uuid4()), ElementReferenceId=element_id,
                          PageSetImageId=media_id, LibrarySymbolId=0, SymbolColorDataId=0,
                          MessageRecordingId=0, UseMessageRecording=None, SerializedMessageSoundMetadata=None)
            button_id = insert(target, "Button", button)
            insert(target, "CommandSequence", {"SerializedCommands": native_command, "ButtonId": button_id})
            for layout_id in layout_ids:
                insert(target, "ElementPlacement", {"GridPosition": record["GridPosition"],
                       "GridSpan": record["GridSpan"], "Visible": record["Visible"],
                       "ElementReferenceId": element_id, "PageLayoutId": layout_id})
        for media in target.execute("SELECT Id FROM PageSetData").fetchall():
            references = sum(target.execute(f'SELECT count(*) FROM "{table}" WHERE "{column}"=?',
                                            (media["Id"],)).fetchone()[0]
                             for table, column in MEDIA_REFERENCES)
            if references:
                target.execute("UPDATE PageSetData SET RefCount=? WHERE Id=?", (references, media["Id"]))
            else:
                target.execute("DELETE FROM PageSetData WHERE Id=?", (media["Id"],))
        target.commit()
        target.execute("VACUUM")
        if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or target.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("SQLite verification failed")
        for original in native.execute("SELECT Id,UniqueId,Title,SerializedMetadata,SyncHash FROM Page"):
            actual = target.execute("SELECT Id,UniqueId,Title,SerializedMetadata,SyncHash FROM Page WHERE Id=?", (original["Id"],)).fetchone()
            if tuple(actual) != tuple(original):
                raise ValueError("Native page identity or metadata changed")
        if tuple(target.execute("SELECT * FROM PageSetProperties").fetchone()) != tuple(native.execute("SELECT * FROM PageSetProperties").fetchone()):
            raise ValueError("Native page set settings changed")
        expected_labels = [row["Label"] for row in records]
        actual_labels = [row[0] for row in target.execute("""
            SELECT b.Label FROM Button b JOIN ElementReference e ON e.Id=b.ElementReferenceId
            WHERE e.PageId=? ORDER BY b.Id
        """, (page_id,))]
        if actual_labels != expected_labels:
            raise ValueError("TLA content verification failed")
        for row in target.execute("SELECT SerializedCommands FROM CommandSequence"):
            if json.loads(row[0]) != expected_command:
                raise ValueError("Unexpected button action")
        target.close()
        if digest(native_path) != native_hash or digest(donor_path) != donor_hash:
            raise ValueError("An input file changed")
        temporary.rename(output)
    native.close()
    donor.close()
    print(json.dumps({"output": str(output), "page_to_update": page_title, "grid": dimension,
                      "buttons": len(records), "native_identity_and_metadata_preserved": True,
                      "input_files_unchanged": True, "sqlite_checks": "passed", "iPad_test": "required"}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native", type=Path, required=True)
    parser.add_argument("--donor", type=Path, required=True)
    parser.add_argument("--page", required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    main(arguments.native, arguments.donor, arguments.page, arguments.output)
