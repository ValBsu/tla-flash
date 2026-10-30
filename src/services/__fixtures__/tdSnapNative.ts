import type { Database, SqlJsStatic, SqlValue } from 'sql.js'

export const speak = '{"$type":"1","$values":[{"$type":"3","MessageAction":0}]}'
export const pageUuid = '11111111-1111-4111-8111-111111111111'
export const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
export const png = Uint8Array.from(atob(pngBase64), (value) => value.charCodeAt(0))
export const pngData = `data:image/png;base64,${pngBase64}`

const add = (db: Database, table: string, values: Record<string, SqlValue>) => {
  db.run(`INSERT INTO "${table}" (${Object.keys(values).map((key) => `"${key}"`).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`, Object.values(values))
}

/** Real DDL, invented records. No personal or licensed page is shipped as a template. */
export const makeNativeTemplate = async (SQL: SqlJsStatic, schema: string) => {
  const db = new SQL.Database()
  db.run(schema)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', png))
  const identifier = `IMG:${btoa(String.fromCharCode(...hash))}`
  add(db, 'PageSetProperties', {
    Id: 6, SchemaVersion: '4.20', UniqueId: 'native-pageset', FriendlyName: 'Mes pages', Language: 'fr_FR',
    DefaultHomePageUniqueId: pageUuid, DashboardUniqueId: 'dashboard', MessageBarUniqueId: 'message-bar',
    ToolBarUniqueId: 'toolbar-absent', DefaultKeyboardPageUniqueId: 'keyboard-absent', GridDimension: '9,7',
    ContentIdentifier: null, IconImageId: 14, SerializedPageSetDefaults: '{"native":"preserved"}',
  })
  db.run('UPDATE PageSetProperties SET Timestamp=638970000000000123,SyncHash=572499137025216022')
  for (const [id, uniqueId, title, type] of [[2, 'dashboard', 'Tableau de bord', 1], [3, 'message-bar', 'Barre des messages', 4], [4, pageUuid, 'Ma page personnelle', 1], [7, 'another-page', 'Autre page', 1]] as const) {
    add(db, 'Page', { Id: id, UniqueId: uniqueId, Title: title, PageType: type, Language: 'fr_FR', GridDimension: null,
      SerializedMetadata: '{\n  "ContentIdentifier": ""\n}SYNTHETIC-NATIVE-METADATA', PageSetImageId: 0 })
  }
  db.run('UPDATE Page SET Timestamp=638970000000000123,SyncHash=572499137025216022')
  for (const [id, pageId, settings] of [[2, 2, '7,4,True,0'], [3, 3, '8,1,False,0'], [9, 4, '9,7,False,0'], [10, 4, '9,7,True,0'], [11, 7, '9,7,False,0']] as const) {
    add(db, 'PageLayout', { Id: id, PageId: pageId, PageLayoutSetting: settings })
  }
  add(db, 'ElementReference', { Id: 1, PageId: 3, ElementType: 1, ForegroundColor: -1, BackgroundColor: -2 })
  add(db, 'MessageWindowElement', { Id: 1, ElementReferenceId: 1, UseSymbols: 1 })
  add(db, 'ElementPlacement', { Id: 1, ElementReferenceId: 1, PageLayoutId: 3, GridPosition: '0,0', GridSpan: '8,1', Visible: 1 })
  for (const [buttonId, elementId, pageId, imageId] of [[41, 25, 4, 0], [42, 26, 4, 11], [43, 27, 4, 12], [51, 35, 7, 11]]) {
    add(db, 'ElementReference', { Id: elementId, PageId: pageId, ElementType: 0, Language: 'fr_FR',
      ForegroundColor: -14273742, BackgroundColor: -1, AudioCueRecordingId: pageId === 7 ? 13 : 0 })
    add(db, 'Button', { Id: buttonId, UniqueId: `button-${buttonId}`, ElementReferenceId: elementId,
      Label: `Natif ${buttonId}`, LabelOwnership: 3, ImageOwnership: imageId ? 3 : 0,
      PageSetImageId: imageId, LibrarySymbolId: 0, SymbolColorDataId: 0, MessageRecordingId: 0,
      FontFamily: 'Cambridge', FontSize: 1.5, FontStyle: 1, SmartSymLayout: 1,
      BorderColor: -14273742, BorderThickness: 1, CommandFlags: buttonId === 41 ? 0 : 8,
      ContentType: 6, ActiveContentType: 0 })
    add(db, 'CommandSequence', { ButtonId: buttonId, SerializedCommands: buttonId === 41 ? '{"$type":"1","$values":[{"$type":"5"}]}' : speak })
    for (const layoutId of pageId === 4 ? [9, 10] : [11]) {
      add(db, 'ElementPlacement', { ElementReferenceId: elementId, PageLayoutId: layoutId,
        GridPosition: `${elementId % 3},0`, GridSpan: '1,1', Visible: 1 })
    }
  }
  add(db, 'ButtonPageLink', { ButtonId: 41, PageUniqueId: 'another-page' })
  add(db, 'ButtonPageLink', { ButtonId: 51, PageUniqueId: pageUuid })
  for (const [id, identifierValue, data, count] of [[11, identifier, png, 2], [12, 'old-target-image', new Uint8Array([1, 2]), 1], [13, 'recording', new Uint8Array([3]), 1], [14, 'icon', new Uint8Array([4]), 1], [15, 'thumbnail', new Uint8Array([5]), 1], [16, 'drawing', new Uint8Array([6]), 1]] as const) {
    add(db, 'PageSetData', { Id: id, Identifier: identifierValue, Data: data, RefCount: count })
  }
  add(db, 'Whiteboard', { Id: 1, UniqueId: 'whiteboard', ThumbnailImageId: 15 })
  add(db, 'WhiteboardImage', { Id: 1, UniqueId: 'drawing', PageSetImageId: 16, WhiteboardId: 1 })
  add(db, 'ScanGroup', { Id: 1, PageLayoutId: 9, SerializedGridPositions: '0,0', AudioCueRecordingId: 0 })
  add(db, 'Synchronization', { Id: 1, SyncServerIdentifier: 'native-sync', PageSetTimestamp: 123, PageSetSyncHash: 456 })
  const bytes = db.export()
  db.close()
  return new Uint8Array(bytes)
}
